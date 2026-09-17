/**
 * @hilbras/sdk — Cohere Adapter
 *
 * Handles the Cohere Chat API (v2).
 * Cohere uses a different wire format from OpenAI:
 * - Messages use `role` + `message` (not `content`)
 * - System prompt is a top-level `preamble` field
 * - Tools use a different schema
 * - Streaming uses SSE with different event types
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import { ProviderRequestError } from "../errors/index.js";

export type CohereAdapterConfig = AdapterConfig;

export class CohereAdapter implements AIProvider {
  readonly id = "cohere";
  private _provider: ProviderConfig;
  private _transport: Transport;

  constructor(config: CohereAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
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

  private _buildBody(params: {
    model: string;
    messages: Message[];
    temperature: number;
    maxTokens?: number;
    tools?: Tool[];
    stream: boolean;
    extra?: Record<string, unknown>;
  }): Record<string, unknown> {
    let preamble = "";
    const chatHistory: Array<{ role: string; message: string }> = [];

    for (const m of params.messages) {
      if (m.role === "system") {
        preamble += (preamble ? "\n\n" : "") + m.content;
      } else if (m.role === "user") {
        chatHistory.push({ role: "USER", message: m.content ?? "" });
      } else if (m.role === "assistant") {
        chatHistory.push({ role: "CHATBOT", message: m.content ?? "" });
      }
    }

    const lastUserMsg = params.messages.filter((m) => m.role === "user").pop();
    const message = lastUserMsg?.content ?? "";

    const body: Record<string, unknown> = {
      model: params.model,
      messages: chatHistory,
      message,
      stream: params.stream,
    };

    if (preamble) body.preamble = preamble;
    if (params.temperature != null) body.temperature = params.temperature;
    if (params.maxTokens != null && params.maxTokens > 0) body.max_tokens = params.maxTokens;

    if (params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameter_definitions: t.function.parameters.properties
            ? Object.fromEntries(
                Object.entries(t.function.parameters.properties).map(([k, v]) => {
                  const param = v as unknown as Record<string, unknown>;
                  return [k, {
                    description: param.description ?? "",
                    type: param.type ?? "string",
                    required: (t.function.parameters.required ?? []).includes(k),
                  }];
                })
              )
            : {},
        },
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
    const url = `${this._provider.baseUrl}/v2/chat`;
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

          if (data.type === "message-start") {
            const msg = data.message as Record<string, unknown> | undefined;
            const usage = msg?.usage as Record<string, number> | undefined;
            if (usage) {
              yield {
                type: "usage",
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
              };
            }
          }

          if (data.type === "content-delta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text" && typeof delta.text === "string") {
              yield { type: "text", text: delta.text };
            }
          }

          if (data.type === "tool-call-delta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (delta) {
              yield {
                type: "tool_call",
                id: (data.tool_call_id as string) ?? `call_cohere_${Date.now()}`,
                name: (delta.name as string) ?? "",
                argumentsDelta: delta.arguments ? JSON.stringify(delta.arguments) : "",
                done: false,
              };
            }
          }

          if (data.type === "tool-call-end") {
            yield {
              type: "tool_call",
              id: (data.tool_call_id as string) ?? "",
              done: true,
            };
          }

          if (eventType === "message-end" || data.type === "message-end") {
            const delta = data.delta as Record<string, unknown> | undefined;
            const usage = delta?.usage as Record<string, number> | undefined;
            if (usage) {
              yield {
                type: "usage",
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
              };
            }
            yield { type: "finish", reason: "stop" };
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
    const url = `${this._provider.baseUrl}/v2/chat`;
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
    const message = data.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!content?.length) return "";
    const textBlock = content.find((b) => b.type === "text");
    return (textBlock?.text as string) ?? "";
  }
}
