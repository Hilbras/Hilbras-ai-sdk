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
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export type OllamaAdapterConfig = AdapterConfig;

/**
 * OllamaAdapter — OpenAI-compatible adapter for Ollama local models.
 * No API key needed. Supports text-embedded tool calls via the SDK's parser.
 */
export class OllamaAdapter implements AIProvider {
  readonly id = "ollama";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _reasoningNormalizer = new ReasoningNormalizer();

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
    if (params.maxTokens != null && params.maxTokens > 0) body.options = { num_predict: params.maxTokens };

    if (params.extra) {
      Object.assign(body, params.extra);
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
    const url = `${this._provider.baseUrl}/chat/completions`;
    const body = this._buildBody({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens,
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

          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          if (!choices?.length) continue;
          const choice = choices[0];
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const content = delta.content as string | undefined;
          if (content) {
            const reasoning = this._reasoningNormalizer.feedText(content);
            if (reasoning) yield reasoning;
            else if (!ReasoningNormalizer.looksLikeReasoningTag(content)) {
              yield { type: "text", text: content };
            }
            continue;
          }

          // Ollama may support tool calls in the future
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
}
