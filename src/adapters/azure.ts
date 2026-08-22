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
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export interface AzureAdapterConfig {
  provider: ProviderConfig;
  transport: Transport;
  deployment?: string;
  apiVersion?: string;
}

export class AzureAdapter {
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
}
