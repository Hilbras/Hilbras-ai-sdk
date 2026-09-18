/**
 * @hilbras/sdk — Voyage AI Adapter
 *
 * Handles Voyage AI's embedding API. Specialized for high-quality embeddings.
 *
 * API format:
 * - Embeddings: POST /v1/embeddings (OpenAI-compatible format)
 *
 * Authentication: Bearer token (Voyage AI API key)
 * Base URL: https://api.voyageai.com
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { EmbeddingParams, EmbeddingResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";

export type VoyageAIAdapterConfig = AdapterConfig;

export class VoyageAIAdapter implements AIProvider {
  readonly id = "voyageai";
  private _provider: ProviderConfig;
  private _transport: Transport;

  constructor(config: VoyageAIAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
  }

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const auth = this._provider.authentication;
    if (auth.type === "bearer" && auth.apiKey) {
      headers["Authorization"] = `Bearer ${auth.apiKey}`;
    } else if (auth.type === "header") {
      headers[auth.name] = auth.value;
    }
    return headers;
  }

  async embed(params: EmbeddingParams): Promise<EmbeddingResult> {
    const input = Array.isArray(params.input) ? params.input : [params.input];
    const url = `${this._provider.baseUrl}/v1/embeddings`;

    const body: Record<string, unknown> = {
      model: params.model,
      input,
      input_type: "document",
    };

    if (params.dimensions) {
      body.truncation = false;
    }

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

  async complete(): Promise<never> {
    throw new Error("Voyage AI does not support chat completions. Use a chat provider.");
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error("Voyage AI does not support streaming chat. Use a chat provider.");
  }
}
