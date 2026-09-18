/**
 * @hilbras/sdk — Cohere Rerank Adapter
 *
 * Handles Cohere's reranking API. Re-ranks documents based on relevance to a query.
 *
 * API format:
 * - Rerank: POST /v1/rerank
 *
 * Authentication: Bearer token (Cohere API key)
 * Base URL: https://api.cohere.com
 */

import type { Transport } from "../transport/transport.js";
import type { ProviderConfig } from "../types/providers.js";
import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import type { RerankParams, RerankResult } from "../types/multi-modal.js";
import { ProviderRequestError } from "../errors/index.js";

export interface CohereRerankAdapterConfig extends AdapterConfig {
  /** Default rerank model (default: rerank-english-v3.0) */
  rerankModel?: string;
}

export class CohereRerankAdapter implements AIProvider {
  readonly id = "cohere-rerank";
  private _provider: ProviderConfig;
  private _transport: Transport;
  private _rerankModel: string;

  constructor(config: CohereRerankAdapterConfig) {
    this._provider = config.provider;
    this._transport = config.transport;
    this._rerankModel = config.rerankModel ?? "rerank-english-v3.0";
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

  async rerank(params: RerankParams): Promise<RerankResult> {
    const url = `${this._provider.baseUrl}/v1/rerank`;

    const body: Record<string, unknown> = {
      model: params.model ?? this._rerankModel,
      query: params.query,
      documents: params.documents,
      top_n: params.topN ?? params.documents.length,
      return_documents: false,
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
    const results = data.results as Array<Record<string, unknown>>;
    const meta = data.meta as Record<string, unknown> | undefined;
    const billedUnits = meta?.billed_units as Record<string, number> | undefined;

    return {
      results: (results ?? []).map((r) => ({
        index: r.index as number,
        relevanceScore: r.relevance_score as number,
        document: (r.document as Record<string, unknown> | undefined)?.text as string | undefined,
      })),
      usage: billedUnits ? {
        inputTokens: billedUnits.input_tokens ?? 0,
        totalTokens: (billedUnits.input_tokens ?? 0) + (billedUnits.output_tokens ?? 0),
      } : undefined,
    };
  }

  async embed(): Promise<never> {
    throw new Error("Cohere Rerank does not support embeddings. Use a dedicated embedding provider.");
  }

  async complete(): Promise<never> {
    throw new Error("Cohere Rerank does not support chat completions. Use a chat provider.");
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error("Cohere Rerank does not support streaming chat. Use a chat provider.");
  }
}
