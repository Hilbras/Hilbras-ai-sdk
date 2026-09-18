/**
 * @hilbras/sdk — Deepgram Adapter
 *
 * Handles Deepgram's speech-to-text API. Specialized for transcription.
 *
 * API format:
 * - Transcription: POST /v1/listen?model={model}
 * - Supports file upload via multipart/form-data or URL via body
 *
 * Authentication: Bearer token (Deepgram API key)
 * Base URL: https://api.deepgram.com
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { TranscriptionParams, TranscriptionResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";

export type DeepgramAdapterConfig = AdapterConfig;

export class DeepgramAdapter implements AIProvider {
  readonly id = "deepgram";
  private _provider: ProviderConfig;
  private _transport: Transport;

  constructor(config: DeepgramAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["Authorization"] = `Token ${auth.apiKey}`;
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
  }

  private _queryParams(params: TranscriptionParams): string {
    const q = new URLSearchParams();
    q.set("model", params.model || "nova-2");
    if (params.language) q.set("language", params.language);
    if (params.temperature != null) q.set("smart_format", "true");
    q.set(" punctuate", "true");
    q.set(" paragraphs", "true");
    q.set(" timestamps", "true");
    q.set(" detect_language", "true");
    return q.toString();
  }

  async embed(): Promise<never> {
    throw new Error("Deepgram does not support embeddings. Use a dedicated embedding provider.");
  }

  async complete(): Promise<never> {
    throw new Error("Deepgram does not support chat completions. Use a chat provider.");
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error("Deepgram does not support streaming chat. Use a chat provider.");
  }

  async transcribe(params: TranscriptionParams): Promise<TranscriptionResult> {
    const queryParams = this._queryParams(params);
    const url = `${this._provider.baseUrl}/v1/listen?${queryParams}`;

    const formData = new FormData();
    if (params.file instanceof File) {
      formData.append("file", params.file);
    } else if (params.file instanceof Blob) {
      formData.append("file", new File([params.file], "audio.wav", { type: "audio/wav" }));
    } else {
      const buf = new ArrayBuffer(params.file.byteLength);
      new Uint8Array(buf).set(params.file);
      formData.append("file", new File([buf], "audio.wav", { type: "audio/wav" }));
    }

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
    const results = data.results as Record<string, unknown> | undefined;
    const channels = results?.channels as Array<Record<string, unknown>> | undefined;
    const alternatives = channels?.[0]?.alternatives as Array<Record<string, unknown>> | undefined;
    const transcript = alternatives?.[0]?.transcript as string | undefined;

    // Extract paragraphs from timestamps
    const paragraphs = channels?.[0]?.paragraphs as Record<string, unknown> | undefined;
    const paraList = paragraphs?.paragraphs as Array<Record<string, unknown>> | undefined;

    const segments = paraList?.flatMap((p) => {
      const sentences = p.sentences as Array<Record<string, unknown>> | undefined;
      return (sentences ?? []).map((s) => ({
        start: s.start as number,
        end: s.end as number,
        text: s.text as string,
      }));
    }) ?? [];

    return {
      text: transcript ?? "",
      language: results?.language as string | undefined,
      segments: segments.length > 0 ? segments : undefined,
    };
  }
}
