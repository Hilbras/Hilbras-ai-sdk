/**
 * @hilbras/sdk — HilbrasClient
 *
 * The main entry point. Manages providers, adapters, and the reliability pipeline.
 * Completely UI-agnostic — works in Node, Bun, Deno, CLI, TUI, VS Code, or browser.
 *
 * Usage:
 *   const client = new HilbrasClient();
 *   client.addProvider({ name: "OpenAI", baseUrl: "https://api.openai.com/v1", ... });
 *   for await (const chunk of client.stream({ provider: "OpenAI", model: "gpt-4", messages })) { ... }
 */

import type { ProviderConfig, AdapterName } from "../types/providers.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { Transport } from "../transport/transport.js";
import { ProviderRegistry } from "../providers/registry.js";
import { FetchTransport } from "../transport/fetch.js";
import { getCircuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { createRetryConfig, shouldRetry, shouldRetryNetworkError } from "../reliability/retry.js";
import { calculateBackoff, sleep } from "../reliability/backoff.js";
import { ProviderNotFoundError, ModelNotFoundError, CircuitBreakerOpenError } from "../errors/index.js";
import { createTimeoutSignal } from "../reliability/timeout.js";
import { OpenAIAdapter } from "../adapters/openai.js";
import { sdkLogger } from "../logging/logger.js";
import { AnthropicAdapter } from "../adapters/anthropic.js";
import { GoogleGenAIAdapter } from "../adapters/google-genai.js";
import { AzureAdapter } from "../adapters/azure.js";
import { GroqAdapter } from "../adapters/groq.js";
import { OllamaAdapter } from "../adapters/ollama.js";
import { dictToMessage } from "../types/messages.js";

export interface HilbrasClientConfig {
  /** Custom transport (default: FetchTransport) */
  transport?: Transport;
}

export class HilbrasClient implements AsyncDisposable {
  private _registry = new ProviderRegistry();
  private _transport: Transport;
  private _adapters = new Map<string, OpenAIAdapter>();

  constructor(config?: HilbrasClientConfig) {
    this._transport = config?.transport ?? new FetchTransport();
  }

  // ─── Provider Management ────────────────────────────────────────────────

  addProvider(config: ProviderConfig): void {
    this._registry.add(config);
    // Create adapter for this provider
    const ADAPTER_MAP: Record<string, any> = {
      openai: OpenAIAdapter, anthropic: AnthropicAdapter,
      "google-genai": GoogleGenAIAdapter, azure: AzureAdapter,
      groq: GroqAdapter, ollama: OllamaAdapter,
    };
    const adapterClass = ADAPTER_MAP[config.adapter] ?? OpenAIAdapter;
    this._adapters.set(config.name, new (adapterClass as any)({
      provider: config,
      transport: this._transport,
    }) as any);
  }

  removeProvider(name: string): void {
    this._registry.remove(name);
    this._adapters.delete(name);
  }

  getProvider(name: string) {
    return this._registry.get(name);
  }

  listProviders() {
    return this._registry.list();
  }

  findModel(modelId: string) {
    return this._registry.findModel(modelId);
  }

  // ─── Adapter Lookup ─────────────────────────────────────────────────────

  private _getAdapter(providerName: string): OpenAIAdapter {
    const adapter = this._adapters.get(providerName);
    if (!adapter) throw new ProviderNotFoundError(providerName);
    return adapter;
  }

  // ─── Message Normalization ──────────────────────────────────────────────

  private _normalizeMessages(raw: Array<Record<string, unknown> | Message>): Message[] {
    return raw.map((m) => {
      if ("role" in m && typeof (m as Message).role === "string") {
        return m as Message;
      }
      return dictToMessage(m as Record<string, unknown>);
    });
  }

  // ─── Streaming ──────────────────────────────────────────────────────────

  async *stream(params: {
    provider: string;
    model: string;
    messages: Array<Record<string, unknown> | Message>;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamChunk> {
    const providerConfig = this._registry.getOrThrow(params.provider);
    const model = providerConfig.models.find((m) => m.id === params.model);
    if (!model) throw new ModelNotFoundError(params.model, params.provider);

    const adapter = this._getAdapter(params.provider);
    const circuitBreaker = getCircuitBreakerRegistry().getOrCreate(params.provider);

    if (!circuitBreaker.isAvailable()) {
      throw new CircuitBreakerOpenError(params.provider);
    }

    const messages = this._normalizeMessages(params.messages);
    const retryConfig = createRetryConfig();

    // Build a timeout signal if the provider has a configured timeout
    const timeoutMs = providerConfig.timeout;
    const signal = timeoutMs
      ? createTimeoutSignal({ requestTimeoutMs: timeoutMs }, params.signal)
      : params.signal;

    for (let attempt = 0; ; attempt++) {
      try {
        const gen = adapter.stream({
          model: params.model,
          messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          tools: params.tools,
          extra: params.extra,
          signal,
        });

        for await (const chunk of gen) {
          yield chunk;
        }

        circuitBreaker.recordSuccess();
        return;
      } catch (err: unknown) {
        // Check if we should retry
        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt));
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt));
          continue;
        }

        circuitBreaker.recordFailure(err instanceof Error ? err : undefined);
        throw err;
      }
    }
  }

  // ─── Non-Streaming Completion ───────────────────────────────────────────

  async complete(params: {
    provider: string;
    model: string;
    messages: Array<Record<string, unknown> | Message>;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const providerConfig = this._registry.getOrThrow(params.provider);
    const model = providerConfig.models.find((m) => m.id === params.model);
    if (!model) throw new ModelNotFoundError(params.model, params.provider);

    const adapter = this._getAdapter(params.provider);
    const circuitBreaker = getCircuitBreakerRegistry().getOrCreate(params.provider);

    if (!circuitBreaker.isAvailable()) {
      throw new CircuitBreakerOpenError(params.provider);
    }

    const messages = this._normalizeMessages(params.messages);
    const retryConfig = createRetryConfig();

    // Build a timeout signal if the provider has a configured timeout
    const timeoutMs = providerConfig.timeout;
    const signal = timeoutMs
      ? createTimeoutSignal({ requestTimeoutMs: timeoutMs }, params.signal)
      : params.signal;

    for (let attempt = 0; ; attempt++) {
      try {
        const result = await adapter.complete({
          model: params.model,
          messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          tools: params.tools,
          extra: params.extra,
          signal,
        });
        circuitBreaker.recordSuccess();
        return result;
      } catch (err: unknown) {
        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt));
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt));
          continue;
        }

        circuitBreaker.recordFailure(err instanceof Error ? err : undefined);
        throw err;
      }
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    this._transport.abort();
    this._adapters.clear();
    this._registry.clear();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}
