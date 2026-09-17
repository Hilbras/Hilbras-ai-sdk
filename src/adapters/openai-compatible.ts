/**
 * @hilbras/sdk — Generic OpenAI-Compatible Adapter
 *
 * A reusable adapter for any provider that exposes an OpenAI-compatible
 * `/chat/completions` endpoint. Most modern LLM providers (Mistral,
 * DeepSeek, xAI, Together, Fireworks, Perplexity, Cerebras, DeepInfra,
 * etc.) use this wire format.
 *
 * Provider-specific adapters are thin wrappers around this class that
 * only override the `id` and optionally headers or body transforms.
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk, TextChunk, ToolCallChunk, FinishChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";
import { TextToolCallParser } from "./text-tool-call-parser.js";

export type GenericOpenAIAdapterConfig = AdapterConfig;

/**
 * Options for customizing the generic adapter's behavior.
 * Provider-specific adapters pass these to the constructor.
 */
export interface GenericOpenAIAdapterOptions {
  /** Adapter ID (e.g. "mistral", "deepseek") */
  adapterId: string;
  /** Override the endpoint path (default: "/chat/completions") */
  endpoint?: string;
  /** Additional headers to merge into requests */
  extraHeaders?: Record<string, string>;
  /** Transform the request body before sending (e.g. add provider-specific fields) */
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Whether the provider supports native tool calling (default: true) */
  supportsNativeTools?: boolean;
}

/**
 * GenericOpenAIAdapter — works with any OpenAI-compatible chat completions API.
 *
 * Handles:
 * - Streaming SSE with `data:` lines
 * - Tool call deltas accumulated by index
 * - Reasoning tag detection (`<thinking>`, `<reasoning>`)
 * - Text-embedded tool call parsing (for providers without native tool support)
 * - Usage chunk tracking
 * - Max tokens degradation (400 → retry without max_tokens)
 */
export class GenericOpenAIAdapter implements AIProvider {
  readonly id: string;
  protected _provider: ProviderConfig;
  protected _transport: Transport;
  protected _reasoningNormalizer = new ReasoningNormalizer();
  private _endpoint: string;
  private _extraHeaders: Record<string, string>;
  private _transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  private _supportsNativeTools: boolean;

  constructor(config: GenericOpenAIAdapterConfig, options?: GenericOpenAIAdapterOptions) {
    this.id = options?.adapterId ?? "openai-compatible";
    this._provider = config.provider;
    this._transport = config.transport;
    this._endpoint = options?.endpoint ?? "/chat/completions";
    this._extraHeaders = options?.extraHeaders ?? {};
    this._transformBody = options?.transformBody;
    this._supportsNativeTools = options?.supportsNativeTools ?? true;
  }

  protected _headers(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      ...this._extraHeaders,
      ...extraHeaders,
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["Authorization"] = `Bearer ${auth.apiKey}`;
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
  }

  protected _buildBody(params: {
    model: string;
    messages: Message[];
    temperature: number;
    maxTokens?: number;
    tools?: Tool[];
    stream: boolean;
    extra?: Record<string, unknown>;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      temperature: params.temperature,
      stream: params.stream,
    };

    if (params.maxTokens != null && params.maxTokens > 0) {
      body.max_tokens = params.maxTokens;
    }

    if (params.stream) {
      body.stream_options = { include_usage: true };
    }

    if (this._supportsNativeTools && params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    if (params.extra) {
      for (const [k, v] of Object.entries(params.extra)) {
        body[k] = v;
      }
    }

    if (this._transformBody) {
      return this._transformBody(body);
    }

    return body;
  }

  async *stream(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamChunk> {
    const url = `${this._provider.baseUrl}${this._endpoint}`;
    const doRequest = (maxTokens?: number) => {
      const body = this._buildBody({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        maxTokens,
        tools: params.tools,
        stream: true,
        extra: params.extra,
      });
      return this._transport.request(url, {
        method: "POST",
        headers: this._headers(this._provider.extraHeaders),
        body: JSON.stringify(body),
        signal: params.signal,
      });
    };

    let res = await doRequest(params.maxTokens);

    if (res.status === 400) {
      const errorBody = await res.text().catch(() => "");
      if (/max_tokens|max completion|max_tokens.*(?:exceed|too large|must be)|context length/i.test(errorBody)) {
        res = await doRequest(undefined);
      } else {
        throw new ProviderRequestError(400, errorBody, this._provider.name);
      }
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    if (!res.body) {
      throw new ProviderRequestError(500, "Response body is null", this._provider.name);
    }

    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const textToolCalls = new TextToolCallParser();
    const emitTextToolCallItems = function* (items: ReturnType<TextToolCallParser["feed"]>) {
      for (const item of items) {
        if (item.kind === "text") {
          yield { type: "text", text: item.text } satisfies TextChunk;
        } else {
          yield {
            type: "tool_call",
            id: `call_text_${textToolCalls.emittedCalls}`,
            name: item.name,
            argumentsDelta: JSON.stringify(item.input),
            index: 1000 + textToolCalls.emittedCalls,
            done: true,
          } satisfies ToolCallChunk;
        }
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let rawData = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) rawData = line.slice(6).trim();
          }
          if (!rawData || rawData === "[DONE]") continue;

          let data: Record<string, unknown>;
          try { data = JSON.parse(rawData); } catch { continue; }

          if (data.usage) {
            const usage = data.usage as Record<string, number>;
            yield {
              type: "usage",
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
              totalTokens: usage.total_tokens ?? 0,
            };
          }

          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          if (!choices?.length) continue;
          const choice = choices[0];

          const finishReason = choice.finish_reason as string | undefined;
          if (finishReason) {
            yield { type: "finish", reason: finishReason } satisfies FinishChunk;
          }

          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const reasoningContent = (delta.reasoning_content ?? delta.thinking) as string | undefined;
          if (reasoningContent) {
            yield ReasoningNormalizer.native(reasoningContent);
            continue;
          }

          const content = delta.content as string | undefined;
          if (content) {
            const reasoning = this._reasoningNormalizer.feedText(content);
            if (reasoning) {
              yield reasoning;
            } else if (!ReasoningNormalizer.looksLikeReasoningTag(content)) {
              if (this._supportsNativeTools) {
                yield* emitTextToolCallItems(textToolCalls.feed(content));
              } else {
                yield { type: "text", text: content };
              }
            }
            continue;
          }

          if (this._supportsNativeTools) {
            const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const idx = (tc.index as number) ?? 0;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, {
                    id: (tc.id as string) ?? `call_${idx}`,
                    name: ((tc.function as Record<string, unknown>)?.name as string) ?? "",
                    arguments: "",
                  });
                }
                const pending = pendingToolCalls.get(idx)!;
                if (tc.id) pending.id = tc.id as string;
                const fn = tc.function as Record<string, unknown> | undefined;
                if (fn?.name) pending.name = fn.name as string;
                if (fn?.arguments) pending.arguments += fn.arguments as string;
              }
            }

            if (finishReason === "tool_calls") {
              for (const [idx, tc] of pendingToolCalls) {
                let parsedInput: Record<string, unknown>;
                try { parsedInput = JSON.parse(tc.arguments); } catch { parsedInput = { raw: tc.arguments }; }
                yield {
                  type: "tool_call",
                  id: tc.id,
                  name: tc.name,
                  argumentsDelta: JSON.stringify(parsedInput),
                  index: idx,
                  done: true,
                } satisfies ToolCallChunk;
              }
              pendingToolCalls.clear();
            }
          }
        }
      }

      if (this._supportsNativeTools) {
        for (const [idx, tc] of pendingToolCalls) {
          let parsedInput: Record<string, unknown>;
          try { parsedInput = JSON.parse(tc.arguments); } catch { parsedInput = { raw: tc.arguments }; }
          yield {
            type: "tool_call",
            id: tc.id,
            name: tc.name,
            argumentsDelta: JSON.stringify(parsedInput),
            index: idx,
            done: true,
          } satisfies ToolCallChunk;
        }
        pendingToolCalls.clear();
      }
      yield* emitTextToolCallItems(textToolCalls.flush());
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const url = `${this._provider.baseUrl}${this._endpoint}`;
    const body = this._buildBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: false,
      extra: params.extra,
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers: this._headers(this._provider.extraHeaders),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json() as Record<string, unknown>;
    } catch {
      return "";
    }
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices?.length) return "";
    const message = choices[0].message as Record<string, unknown> | undefined;
    return (message?.content as string) ?? "";
  }

  // ─── Multi-Modal: Embeddings ────────────────────────────────────────────

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const url = `${this._provider.baseUrl}/embeddings`;
    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input,
    };
    if (params.dimensions != null) body.dimensions = params.dimensions;

    const res = await this._transport.request(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as Record<string, unknown>;
    const dataArr = data.data as Array<{ embedding: number[] }>;
    const usage = data.usage as Record<string, number> | undefined;

    return {
      embeddings: dataArr.map((d) => d.embedding),
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
    };
  }
}
