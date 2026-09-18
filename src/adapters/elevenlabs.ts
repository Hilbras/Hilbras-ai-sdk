/**
 * @hilbras/sdk — ElevenLabs Adapter
 *
 * Handles ElevenLabs' text-to-speech API. Specialized for speech synthesis.
 *
 * API format:
 * - TTS: POST /v1/text-to-speech/{voice_id}
 * - Supports streaming TTS via chunked transfer
 *
 * Authentication: Bearer token (ElevenLabs API key)
 * Base URL: https://api.elevenlabs.io
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { SpeechParams, SpeechResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";

export interface ElevenLabsAdapterConfig extends AdapterConfig {
  /** Default voice ID (default: "21m00Tcm4TlvDq8ikWAM") */
  voiceId?: string;
}

export class ElevenLabsAdapter implements AIProvider {
  readonly id = "elevenlabs";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _defaultVoiceId: string;

  constructor(config: ElevenLabsAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
    this._defaultVoiceId = config.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "audio/mpeg",
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["xi-api-key"] = auth.apiKey;
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
  }

  async embed(): Promise<never> {
    throw new Error("ElevenLabs does not support embeddings. Use a dedicated embedding provider.");
  }

  async complete(): Promise<never> {
    throw new Error("ElevenLabs does not support chat completions. Use a chat provider.");
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error("ElevenLabs does not support streaming chat. Use a chat provider.");
  }

  async generateSpeech(params: SpeechParams): Promise<SpeechResult> {
    const voiceId = params.voice || this._defaultVoiceId;
    const url = `${this._provider.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const body: Record<string, unknown> = {
      text: params.input,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    };

    if (params.speed != null) {
      (body.voice_settings as Record<string, unknown>).speed = params.speed;
    }

    const res = await this._transport.request(url, {
      method: "POST",
      headers: {
        ...this._headers(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, errorBody, this._provider.name);
    }

    const buffer = await res.arrayBuffer();
    const format = params.responseFormat === "mp3" ? "mp3"
      : params.responseFormat === "opus" ? "opus"
      : params.responseFormat === "wav" ? "wav"
      : "mp3";

    return { audio: new Uint8Array(buffer), format };
  }
}
