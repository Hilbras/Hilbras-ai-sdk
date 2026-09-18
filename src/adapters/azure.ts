/**
 * @hilbras/sdk — Azure OpenAI Adapter
 *
 * Handles Azure OpenAI deployments. Extends OpenAI adapter with
 * Azure-specific header requirements (api-key, deployment routing).
 *
 * Key differences from OpenAI:
 * - Uses api-key header instead of Bearer token
 * - Routes through /deployments/{deployment}/chat/completions
 * - API version must be specified as query parameter
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult, ImageParams, ImageResult, SpeechParams, SpeechResult, TranscriptionParams, TranscriptionResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export interface AzureAdapterConfig extends AdapterConfig {
  deployment?: string;
  apiVersion?: string;
}

export class AzureAdapter implements AIProvider {
  readonly id = "azure";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _deployment: string;
  private _apiVersion: string;
  private _reasoningNormalizer = new ReasoningNormalizer();

  constructor(config: AzureAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
    this._deployment = config.deployment ?? config.provider.models?.[0]?.id ?? "gpt-4o";
    this._apiVersion = config.apiVersion ?? "2024-10-21-preview";
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["api-key"] = auth.apiKey; // Azure uses api-key, not Authorization
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
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

    if (params.extra) {
      for (const [k, v] of Object.entries(params.extra)) {
        if (k === "enable_thinking" && v) {
          body.thinking = { type: "enabled" };
        } else {
          body[k] = v;
        }
      }
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
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${this._apiVersion}`;
    const body = this._buildBody({
      model: deployment,
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
            const reasoning = this._reasoningNormalizer.feedText(content);
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
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${this._apiVersion}`;
    const body = this._buildBody({
      model: deployment,
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
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/embeddings?api-version=${this._apiVersion}`;
    const body: Record<string, unknown> = {
      model: deployment,
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

  // ─── Multi-Modal: Image Generation ──────────────────────────────────────

  async generateImage(params: ImageParams): Promise<ImageResult> {
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/images/generations?api-version=${this._apiVersion}`;
    const body: Record<string, unknown> = {
      model: deployment,
      prompt: params.prompt,
    };
    if (params.n != null) body.n = params.n;
    if (params.size) body.size = params.size;
    if (params.quality) body.quality = params.quality;
    if (params.style) body.style = params.style;
    if (params.responseFormat) body.response_format = params.responseFormat;

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
    const dataArr = data.data as Array<Record<string, string>>;

    return {
      images: dataArr.map((d) => ({
        url: d.url,
        b64Json: d.b64_json,
        revisedPrompt: d.revised_prompt,
      })),
    };
  }

  // ─── Multi-Modal: Speech Synthesis ──────────────────────────────────────

  async generateSpeech(params: SpeechParams): Promise<SpeechResult> {
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/audio/speech?api-version=${this._apiVersion}`;
    const body: Record<string, unknown> = {
      model: deployment,
      input: params.input,
      voice: params.voice,
    };
    if (params.responseFormat) body.response_format = params.responseFormat;
    if (params.speed != null) body.speed = params.speed;

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

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "";
    const format = contentType.includes("ogg") ? "opus"
      : contentType.includes("aac") ? "aac"
      : contentType.includes("flac") ? "flac"
      : contentType.includes("wav") ? "wav"
      : contentType.includes("pcm") ? "pcm"
      : "mp3";

    return { audio: new Uint8Array(buffer), format };
  }

  // ─── Multi-Modal: Transcription ─────────────────────────────────────────

  async transcribe(params: TranscriptionParams): Promise<TranscriptionResult> {
    const deployment = params.model || this._deployment;
    const url = `${this._provider.baseUrl}/openai/deployments/${deployment}/audio/transcriptions?api-version=${this._apiVersion}`;
    const form = new FormData();
    form.append("model", deployment);

    if (params.file instanceof File) {
      form.append("file", params.file);
    } else if (params.file instanceof Blob) {
      form.append("file", new File([params.file], "audio.wav"));
    } else {
      const buf = new ArrayBuffer(params.file.byteLength);
      new Uint8Array(buf).set(params.file);
      form.append("file", new File([buf], "audio.wav", { type: "audio/wav" }));
    }

    if (params.language) form.append("language", params.language);
    if (params.prompt) form.append("prompt", params.prompt);
    if (params.responseFormat) form.append("response_format", params.responseFormat);
    if (params.temperature != null) form.append("temperature", String(params.temperature));

    const res = await this._transport.request(url, {
      method: "POST",
      headers: {
        ...this._headers(),
        "Content-Type": undefined,
      },
      body: form,
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const format = params.responseFormat ?? "json";
    if (format === "json" || format === "text") {
      const text = await res.text();
      return { text };
    }

    const data = await res.json() as Record<string, unknown>;
    return {
      text: (data.text as string) ?? "",
      language: data.language as string | undefined,
      duration: data.duration as number | undefined,
      segments: data.segments as TranscriptionResult["segments"],
    };
  }
}
