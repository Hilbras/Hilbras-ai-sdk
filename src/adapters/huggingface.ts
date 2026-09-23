/**
 * @hilbras/sdk — Hugging Face Inference Adapter
 *
 * Handles the Hugging Face Inference API. Supports:
 * - OpenAI-compatible chat completions via /models/{model}/v1/chat/completions
 * - Legacy task-based inference via /models/{model}
 * - Embeddings via feature extraction task
 *
 * Authentication: Bearer token (HF API token)
 * Base URL: https://api-inference.huggingface.co
 *
 * HF models use the model ID directly (e.g. "meta-llama/Llama-3.1-8B-Instruct")
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult, ImageParams, ImageResult, TranscriptionParams, TranscriptionResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export interface HuggingFaceAdapterConfig extends AdapterConfig {
  /** Use OpenAI-compatible endpoint (default: true) */
  useOpenAICompat?: boolean;
}

export class HuggingFaceAdapter implements AIProvider {
  readonly id = "huggingface";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _useOpenAICompat: boolean;

  constructor(config: HuggingFaceAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
    this._useOpenAICompat = config.useOpenAICompat ?? true;
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["Authorization"] = `Bearer ${auth.apiKey}`;
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
  }

  private _chatUrl(model: string): string {
    // OpenAI-compatible: /models/{model}/v1/chat/completions
    // Legacy: /models/{model}
    if (this._useOpenAICompat) {
      return `${this._provider.baseUrl}/models/${encodeURIComponent(model)}/v1/chat/completions`;
    }
    return `${this._provider.baseUrl}/models/${encodeURIComponent(model)}`;
  }

  private _buildBody(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    stream: boolean;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, content: m.content } : {}),
      })),
      stream: params.stream,
    };

    if (params.temperature != null) body.temperature = params.temperature;
    if (params.maxTokens != null && params.maxTokens > 0) body.max_tokens = params.maxTokens;

    if (params.stream) {
      body.stream_options = { include_usage: true };
    }

    if (params.tools?.length) {
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
    const url = this._chatUrl(params.model);
    const body = this._buildBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: true,
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
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

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
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const reasoningContent = (delta.reasoning_content ?? delta.thinking) as string | undefined;
          if (reasoningContent) {
            yield { type: "reasoning", text: reasoningContent };
            continue;
          }

          const content = delta.content as string | undefined;
          if (content) {
            const reasoning = reasoningNormalizer.feedText(content);
            if (reasoning) yield reasoning;
            else if (!ReasoningNormalizer.looksLikeReasoningTag(content)) {
              yield { type: "text", text: content };
            }
            continue;
          }

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

          const finishReason = choice.finish_reason as string | undefined;
          if (finishReason) {
            yield { type: "finish", reason: finishReason } as any;
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
              };
            }
            pendingToolCalls.clear();
          }
        }
      }
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
    const url = this._chatUrl(params.model);
    const body = this._buildBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      tools: params.tools,
      stream: false,
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

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const input = Array.isArray(params.input) ? params.input : [params.input];
    const url = `${this._provider.baseUrl}/models/${encodeURIComponent(params.model)}`;
    const body = JSON.stringify({
      inputs: input,
      parameters: {
        ...(params.dimensions ? { dimension: params.dimensions } : {}),
      },
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers: this._headers(),
      body,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as unknown;
    // HF returns embeddings as array of arrays or array of numbers depending on model
    let embeddings: number[][];
    if (Array.isArray(data) && Array.isArray(data[0])) {
      embeddings = data as number[][];
    } else if (Array.isArray(data)) {
      embeddings = [data as number[]];
    } else {
      embeddings = [];
    }

    return {
      embeddings,
      usage: { inputTokens: 0, totalTokens: 0 },
    };
  }

  async generateImage(params: ImageParams): Promise<ImageResult> {
    const url = `${this._provider.baseUrl}/models/${encodeURIComponent(params.model)}`;
    const body = JSON.stringify({
      inputs: params.prompt,
      parameters: {
        ...(params.n ? { num_images_per_prompt: params.n } : {}),
      },
    });

    const res = await this._transport.request(url, {
      method: "POST",
      headers: this._headers(),
      body,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("image")) {
      const buffer = await res.arrayBuffer();
      return { images: [{ b64Json: Buffer.from(buffer).toString("base64") }] };
    }

    const data = await res.json() as Record<string, unknown>;
    // Some HF models return URL format
    if (Array.isArray(data)) {
      return {
        images: (data as Array<Record<string, unknown>>).map((img) => ({
          url: typeof img.url === "string" ? img.url : undefined,
          b64Json: typeof img.blob === "string" ? img.blob : undefined,
        })),
      };
    }

    return { images: [] };
  }

  async transcribe(params: TranscriptionParams): Promise<TranscriptionResult> {
    const url = `${this._provider.baseUrl}/models/${encodeURIComponent(params.model)}`;
    const formData = new FormData();

    if (params.file instanceof File) {
      formData.append("file", params.file);
    } else if (params.file instanceof Blob) {
      formData.append("file", new File([params.file], "audio.wav"));
    } else {
      const buf = new ArrayBuffer(params.file.byteLength);
      new Uint8Array(buf).set(params.file);
      formData.append("file", new File([buf], "audio.wav", { type: "audio/wav" }));
    }

    formData.append("inputs", JSON.stringify({
      ...(params.language ? { language: params.language } : {}),
    }));

    const res = await this._transport.request(url, {
      method: "POST",
      headers: {
        ...this._headers(),
        "Content-Type": undefined,
      },
      body: formData,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const data = await res.json() as Record<string, unknown>;
    return { text: (data.text as string) ?? JSON.stringify(data) };
  }
}
