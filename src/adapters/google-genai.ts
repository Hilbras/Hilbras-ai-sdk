/**
 * @hilbras/sdk — Google GenAI Adapter
 *
 * Handles the Google Gemini (Vertex AI / AI Studio) API.
 * Converts between Hilbras' universal types and Google's wire format.
 *
 * Key differences from OpenAI:
 * - System instruction is a top-level field
 * - Tool calls use a different schema (function_declarations)
 * - Streaming uses newline-delimited JSON (not SSE)
 * - Max tokens is maxOutputTokens
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk, TextChunk, ToolCallChunk, UsageChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export type GoogleGenAIAdapterConfig = AdapterConfig;

export class GoogleGenAIAdapter implements AIProvider {
  readonly id = "google-genai";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _reasoningNormalizer = new ReasoningNormalizer();

  constructor(config: GoogleGenAIAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
  }

  private _headers(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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

  private _buildBody(params: {
    model: string;
    messages: Message[];
    temperature: number;
    maxTokens?: number;
    tools?: Tool[];
    stream: boolean;
    extra?: Record<string, unknown>;
  }): Record<string, unknown> {
    // Extract system instruction
    let systemInstruction = "";
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const m of params.messages) {
      if (m.role === "system") {
        systemInstruction += (systemInstruction ? "\n\n" : "") + m.content;
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : m.role,
          parts: [{ text: m.content ?? "" }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxTokens ?? 4096,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (params.tools?.length) {
      body.tools = [{
        functionDeclarations: params.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    if (params.stream) {
      body.generationConfig = { ...body.generationConfig as object, responseMimeType: "text/plain" };
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
    const url = `${this._provider.baseUrl}/models/${params.model}:streamGenerateContent?alt=sse`;
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
    let toolCallIdx = 0;

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

          const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
          if (!candidates?.length) continue;
          const candidate = candidates[0];
          const content = candidate.content as Record<string, unknown> | undefined;
          const parts = content?.parts as Array<Record<string, unknown>> | undefined;
          if (!parts?.length) continue;

          for (const p of parts) {
            // Text content
            if (typeof p.text === "string" && p.text) {
              const reasoning = this._reasoningNormalizer.feedText(p.text);
              if (reasoning) yield reasoning;
              else if (!ReasoningNormalizer.looksLikeReasoningTag(p.text)) {
                yield { type: "text", text: p.text };
              }
            }

            // Function call
            if (p.functionCall) {
              const fc = p.functionCall as Record<string, unknown>;
              yield {
                type: "tool_call",
                id: `call_google_${toolCallIdx++}`,
                name: fc.name as string,
                argumentsDelta: JSON.stringify(fc.args ?? {}),
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
    const url = `${this._provider.baseUrl}/models/${params.model}:generateContent`;
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
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates?.length) return "";
    const candidate = candidates[0];
    const content = candidate.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (!parts?.length) return "";
    return parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
  }
}
