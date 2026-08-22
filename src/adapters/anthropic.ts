/**
 * @hilbras/sdk — Anthropic Adapter
 *
 * Handles the Anthropic Messages API (Claude models).
 * Converts between Hilbras' universal types and Anthropic's wire format.
 *
 * Key differences from OpenAI:
 * - System prompt is a top-level `system` field, not a message
 * - Tool calls use a different schema (input_schema vs parameters)
 * - Streaming uses Server-Sent Events with different event types
 * - Max tokens is required (not optional)
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig, Authentication } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk, TextChunk, ReasoningChunk, ToolCallChunk, UsageChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";
import { messageToDict } from "../types/messages.js";

export type AnthropicAdapterConfig = AdapterConfig;

export class AnthropicAdapter implements AIProvider {
  readonly id = "anthropic";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _reasoningNormalizer = new ReasoningNormalizer();

  constructor(config: AnthropicAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
  }

  private _headers(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "anthropic-version": "2023-06-01",
      ...extraHeaders,
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["x-api-key"] = auth.apiKey;
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
    // Extract system message (Anthropic uses top-level system field)
    let systemPrompt = "";
    const nonSystemMessages = params.messages.filter((m) => {
      if (m.role === "system") {
        systemPrompt += (systemPrompt ? "\n\n" : "") + m.content;
        return false;
      }
      return true;
    });

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      stream: params.stream,
    };

    if (systemPrompt) body.system = systemPrompt;
    body.messages = nonSystemMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Convert tools to Anthropic format
    if (params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

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
    const url = `${this._provider.baseUrl}/messages`;
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
      headers: this._headers(this._provider.extraHeaders),
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
    const toolCalls = new Map<number, { id: string; name: string; inputJson: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "";
          let rawData = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            if (line.startsWith("data: ")) rawData = line.slice(6).trim();
          }
          if (!rawData || rawData === "[DONE]") continue;

          let data: Record<string, unknown>;
          try { data = JSON.parse(rawData); } catch { continue; }

          // Content block delta (text or tool_use input)
          if (eventType === "content_block_delta" || data.type === "content_block_delta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (!delta) continue;

            if (delta.type === "text_delta" && typeof delta.text === "string") {
              const reasoning = this._reasoningNormalizer.feedText(delta.text);
              if (reasoning) yield reasoning;
              else if (!ReasoningNormalizer.looksLikeReasoningTag(delta.text)) {
                yield { type: "text", text: delta.text };
              }
            }

            if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
              const idx = (data.index as number) ?? 0;
              const existing = toolCalls.get(idx);
              if (existing) {
                existing.inputJson += delta.partial_json;
              }
            }
          }

          // Content block start (tool_use)
          if (eventType === "content_block_start" || data.type === "content_block_start") {
            const block = data.content_block as Record<string, unknown> | undefined;
            if (block?.type === "tool_use") {
              toolCalls.set(data.index as number, {
                id: block.id as string,
                name: block.name as string,
                inputJson: "",
              });
            }
          }

          // Content block stop — flush tool call
          if (eventType === "content_block_stop" || data.type === "content_block_stop") {
            const idx = data.index as number;
            const tc = toolCalls.get(idx);
            if (tc) {
              yield {
                type: "tool_call",
                id: tc.id,
                name: tc.name,
                argumentsDelta: tc.inputJson,
                index: idx,
                done: true,
              };
              toolCalls.delete(idx);
            }
          }

          // Usage
          if (data.type === "message_delta" && data.usage) {
            const usage = data.usage as Record<string, number>;
            yield {
              type: "usage",
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            };
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
    const url = `${this._provider.baseUrl}/messages`;
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

    const data = await res.json() as Record<string, unknown>;
    const content = data.content as Array<Record<string, unknown>> | undefined;
    if (!content?.length) return "";
    const textBlock = content.find((b) => b.type === "text");
    return (textBlock?.text as string) ?? "";
  }
}
