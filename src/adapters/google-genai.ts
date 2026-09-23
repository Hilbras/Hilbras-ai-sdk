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
import { extractText } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult, ImageParams, ImageResult, SpeechParams, SpeechResult, TranscriptionParams, TranscriptionResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";
import { ReasoningNormalizer } from "../reasoning/normalizer.js";

export type GoogleGenAIAdapterConfig = AdapterConfig;

export class GoogleGenAIAdapter implements AIProvider {
  readonly id = "google-genai";
  private _provider: ProviderConfig;
  private _transport: Transport;

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
        systemInstruction += (systemInstruction ? "\n\n" : "") + extractText(m.content);
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : m.role,
          parts: [{ text: extractText(m.content) }],
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
    const reasoningNormalizer = new ReasoningNormalizer();
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
              const reasoning = reasoningNormalizer.feedText(p.text);
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

  // ─── Multi-Modal: Embeddings ──────────────────────────────────────────

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const url = `${this._provider.baseUrl}/models/${params.model}:embedContent`;
    const body: Record<string, unknown> = {
      model: `models/${params.model}`,
      content: { parts: [{ text: typeof params.input === "string" ? params.input : params.input.join("\n") }] },
    };
    if (params.dimensions) {
      (body as Record<string, unknown>).outputDimensionality = params.dimensions;
    }

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
    const embedding = data.embedding as Record<string, unknown> | undefined;
    const values = embedding?.values as number[] | undefined;

    if (Array.isArray(params.input) && values) {
      // batch embedContent not supported — return single result
      return { embeddings: [values], usage: { inputTokens: 0, totalTokens: 0 } };
    }

    return { embeddings: values ? [values] : [], usage: { inputTokens: 0, totalTokens: 0 } };
  }

  // ─── Multi-Modal: Image Generation ────────────────────────────────────

  async generateImage(params: ImageParams): Promise<ImageResult> {
    const url = `${this._provider.baseUrl}/models/${params.model}:predict`;
    const body: Record<string, unknown> = {
      instances: [{ prompt: params.prompt }],
      parameters: {
        sampleCount: params.n ?? 1,
        ...(params.size ? { aspectRatio: params.size } : {}),
      },
    };

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
    const predictions = data.predictions as Array<Record<string, unknown>> | undefined;

    const images = (predictions ?? []).map((p) => ({
      b64Json: typeof p.bytesBase64Encoded === "string" ? p.bytesBase64Encoded : undefined,
      revisedPrompt: typeof p.prompt === "string" ? p.prompt : undefined,
    }));

    return { images };
  }

  // ─── Multi-Modal: Speech Synthesis ────────────────────────────────────

  async generateSpeech(params: SpeechParams): Promise<SpeechResult> {
    // Google Cloud TTS uses a different endpoint structure
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize`;
    const body: Record<string, unknown> = {
      input: { text: params.input },
      voice: { languageCode: "en-US", name: params.voice },
      audioConfig: {
        audioEncoding: params.responseFormat === "mp3" ? "MP3" : params.responseFormat === "opus" ? "OGG_OPUS" : "LINEAR16",
        speakingRate: params.speed ?? 1.0,
      },
    };

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
    const audioContent = data.audioContent as string | undefined;

    return {
      audio: audioContent ? Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0)) : new Uint8Array(),
      format: params.responseFormat ?? "wav",
    };
  }

  // ─── Multi-Modal: Transcription ───────────────────────────────────────

  async transcribe(params: TranscriptionParams): Promise<TranscriptionResult> {
    // Google Speech-to-Text uses a different endpoint
    const url = `https://speech.googleapis.com/v1/speech:recognize`;
    const fileBytes = params.file instanceof Uint8Array ? params.file : new Uint8Array(await (params.file as Blob).arrayBuffer());
    const body: Record<string, unknown> = {
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: params.language ?? "en-US",
        enableAutomaticPunctuation: true,
      },
      audio: { content: btoa(String.fromCharCode(...fileBytes)) },
    };

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
    const results = data.results as Array<Record<string, unknown>> | undefined;
    const alternatives = (results?.[0] as Record<string, unknown> | undefined)?.alternatives as Array<Record<string, unknown>> | undefined;
    const transcript = alternatives?.[0]?.transcript as string | undefined;

    return { text: transcript ?? "" };
  }
}
