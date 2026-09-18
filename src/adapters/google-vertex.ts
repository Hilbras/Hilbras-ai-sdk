/**
 * @hilbras/sdk — Google Vertex AI Adapter
 *
 * Handles Google Cloud Vertex AI API. Extends the Google GenAI wire format
 * with Vertex AI-specific routing (projects, locations, publishers).
 *
 * Key differences from Google GenAI (AI Studio):
 * - Base URL: https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
 * - Authentication: Google Cloud OAuth2 access token
 * - Model path: /publishers/{publisher}/models/{model}
 * - Supports both Google-native and OpenAI-compatible formats
 *
 * Wire format is identical to Google GenAI:
 * - candidates[].content.parts[].text for text
 * - candidates[].content.parts[].functionCall for tool calls
 * - Streaming via SSE with newline-delimited JSON
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

export interface VertexAIAdapterConfig extends AdapterConfig {
  /** Google Cloud project ID */
  project?: string;
  /** Google Cloud region (default: us-central1) */
  region?: string;
  /** Google Cloud location (default: us-central1) */
  location?: string;
}

export class VertexAIAdapter implements AIProvider {
  readonly id = "google-vertex";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _project: string;
  private _region: string;
  private _location: string;
  private _reasoningNormalizer = new ReasoningNormalizer();

  constructor(config: VertexAIAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;

    // Parse project/region/location from baseUrl or config
    const parsed = this._parseBaseUrl();
    this._project = config.project ?? parsed.project ?? "";
    this._region = config.region ?? parsed.region ?? "us-central1";
    // Location defaults to region when not explicitly set (useful when overriding region via config)
    this._location = config.location ?? (config.region ? this._region : (parsed.location ?? this._region));
  }

  private _parseBaseUrl(): { project?: string; region?: string; location?: string } {
    const url = this._provider.baseUrl;
    // Match: https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
    const match = url.match(/https?:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com\/v1\/projects\/([^/]+)\/locations\/([^/]+)/);
    if (match) {
      return { region: match[1], project: match[2], location: match[3] };
    }
    return {};
  }

  private _baseUrl(): string {
    return `https://${this._region}-aiplatform.googleapis.com/v1/projects/${this._project}/locations/${this._location}`;
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

  private _modelUrl(model: string, action: string): string {
    // Vertex AI model path: /publishers/{publisher}/models/{model}:{action}
    // Publishers: google, meta, mistralai, anthropic, etc.
    const publisher = model.includes("/") ? model.split("/")[0] : "google";
    const modelId = model.includes("/") ? model.split("/").slice(1).join("/") : model;
    return `${this._baseUrl()}/publishers/${publisher}/models/${modelId}:${action}`;
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
    const url = this._modelUrl(params.model, "streamGenerateContent") + "?alt=sse";
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
          const contentParts = content?.parts as Array<Record<string, unknown>> | undefined;
          if (!contentParts?.length) continue;

          for (const p of contentParts) {
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
                id: `call_vertex_${toolCallIdx++}`,
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

  async complete(params: {
    model: string;
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const url = this._modelUrl(params.model, "generateContent");
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
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates?.length) return "";
    const candidate = candidates[0];
    const content = candidate.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (!parts?.length) return "";
    return parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
  }

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const url = this._modelUrl(params.model, "predict");
    const body: Record<string, unknown> = {
      instances: [{
        content: typeof params.input === "string" ? params.input : params.input.join("\n"),
      }],
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
    const predictions = data.predictions as Array<Record<string, unknown>> | undefined;
    const embeddings = predictions?.map((p) => {
      const emb = p.embeddings as Record<string, unknown> | undefined;
      return (emb?.values as number[]) ?? [];
    }) ?? [];

    return {
      embeddings,
      usage: { inputTokens: 0, totalTokens: 0 },
    };
  }

  async generateImage(params: ImageParams): Promise<ImageResult> {
    // Vertex AI image generation uses a different endpoint
    const url = `${this._baseUrl()}/publishers/google/models/imagen-3.0-generate-002:predict`;
    const body: Record<string, unknown> = {
      instances: [{ prompt: params.prompt }],
      parameters: {
        sampleCount: params.n ?? 1,
        ...(params.size ? { aspectRatio: params.size } : {}),
      },
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
    const predictions = data.predictions as Array<Record<string, unknown>> | undefined;

    const images = (predictions ?? []).map((p) => ({
      b64Json: typeof p.bytesBase64Encoded === "string" ? p.bytesBase64Encoded : undefined,
      revisedPrompt: typeof p.prompt === "string" ? p.prompt : undefined,
    }));

    return { images };
  }

  async generateSpeech(params: SpeechParams): Promise<SpeechResult> {
    // Vertex AI uses Google Cloud TTS
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
      headers: this._headers(),
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

  async transcribe(params: TranscriptionParams): Promise<TranscriptionResult> {
    // Vertex AI uses Google Cloud Speech-to-Text
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
      headers: this._headers(),
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
