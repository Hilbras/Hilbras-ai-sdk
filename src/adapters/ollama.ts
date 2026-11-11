/**
 * @hilbras/sdk — Ollama Adapter
 *
 * Handles Ollama's OpenAI-compatible API for local models.
 * Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
 *
 * Key differences:
 * - No API key required (local server)
 * - Models are pulled locally first
 * - Supports multimodal (vision) for compatible models
 * - Streaming works via standard SSE
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";
import { splitSseFrames } from "../utils/sse.js";
import { mergeExtraParams } from "./extra.js";

export type OllamaAdapterConfig = AdapterConfig;

/**
 * OllamaAdapter — OpenAI-compatible adapter for Ollama local models.
 * No API key needed. Tool calling is native: `tools` goes out in the OpenAI
 * shape and tool-capable models reply with `tool_calls`.
 */
export class OllamaAdapter implements AIProvider {
  readonly id = "ollama";
  private _provider: ProviderConfig;
  private _transport: Transport;

  constructor(config: OllamaAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
  }

  private _headers(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  private _buildBody(params: {
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
      })),
      stream: params.stream,
    };

    if (params.temperature !== undefined) body.temperature = params.temperature;
    // The adapter calls `/v1/chat/completions`, so the limit belongs in the
    // OpenAI-shaped `max_tokens`. `options.num_predict` is a native-API field
    // and was ignored on this endpoint, leaving maxTokens with no effect.
    if (params.maxTokens != null && params.maxTokens > 0) body.max_tokens = params.maxTokens;

    // Ollama's OpenAI-compatible endpoint accepts `tools` for tool-capable
    // models. It was never sent, so the stream loop's native `tool_calls`
    // branch was unreachable.
    if (params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    if (params.extra) {
      mergeExtraParams(body, params.extra);
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
    const reasoningNormalizer = new ReasoningNormalizer();
    const url = `${this._provider.baseUrl}/chat/completions`;
    const body = this._buildBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: true,
      extra: params.extra,
    });

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

    if (!res.body) {
      throw new ProviderRequestError(500, "Response body is null", this._provider.name);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = splitSseFrames(buffer, decoder.decode(value, { stream: true }));
        buffer = decoded.buffer;

        for (const frame of decoded.frames) {
          const rawData = frame.data.trim();
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
            yield { type: "finish", reason: finishReason };
          }

          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const content = delta.content as string | undefined;
          if (content) {
            const reasoningParts = reasoningNormalizer.feedText(content);
            if (reasoningParts.length > 0) {
              for (const part of reasoningParts) yield part;
            } else if (!ReasoningNormalizer.looksLikeReasoningTag(content)) {
              yield { type: "text", text: content };
            }
            continue;
          }

          const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx = (tc.index as number) ?? 0;
              let parsedInput: Record<string, unknown>;
              const fn = tc.function as Record<string, unknown> | undefined;
              try { parsedInput = JSON.parse((fn?.arguments as string) ?? "{}"); } catch { parsedInput = {}; }
              yield {
                type: "tool_call",
                id: (tc.id as string) ?? `call_ollama_${idx}`,
                name: (fn?.name as string) ?? "",
                argumentsDelta: JSON.stringify(parsedInput),
                index: idx,
                done: true,
              };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Non-streaming completion */
  async complete(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const url = `${this._provider.baseUrl}/chat/completions`;
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
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices?.length) return "";
    const message = choices[0].message as Record<string, unknown> | undefined;
    return (message?.content as string) ?? "";
  }

  // ─── Multi-Modal: Embeddings ────────────────────────────────────────────

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    // The native endpoint sits at the Ollama root, but the configured baseUrl
    // carries the OpenAI-compatible `/v1` suffix. Appending the native path
    // without stripping it produced `<host>/v1/api/embeddings` — a 404.
    const root = this._provider.baseUrl.replace(/\/v1\/?$/, "");
    const url = `${root}/api/embeddings`;
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: Array.isArray(params.input) ? params.input.join("\n") : params.input,
    };

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
    const embedding = data.embedding as number[] | undefined;

    return {
      embeddings: embedding ? [embedding] : [],
      usage: { inputTokens: 0, totalTokens: 0 },
    };
  }
}
