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

import type { ProviderConfig } from "../types/providers.js";
import type { AIProvider } from "../types/adapter.js";
import type { Message } from "../types/messages.js";
import type { Tool } from "../types/tools.js";
import type { StreamChunk } from "../types/streams.js";
import type { Transport } from "../transport/transport.js";
import type { ExecutionPolicy, ResolvedPolicy } from "../types/policy.js";
import { ProviderRegistry } from "../providers/registry.js";
import { FetchTransport } from "../transport/fetch.js";
import { getCircuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { createRetryConfig, shouldRetry, shouldRetryNetworkError } from "../reliability/retry.js";
import { calculateBackoff, sleep } from "../reliability/backoff.js";
import { ProviderNotFoundError, ModelNotFoundError, CircuitBreakerOpenError } from "../errors/index.js";
import { createTimeoutSignal } from "../reliability/timeout.js";
import { sdkLogger } from "../logging/logger.js";
import { AdapterRegistry, getDefaultAdapterRegistry } from "../providers/adapter-registry.js";
import { dictToMessage } from "../types/messages.js";
import { resolvePolicy } from "../reliability/presets.js";

export interface HilbrasClientConfig {
  /** Custom transport (default: FetchTransport) */
  transport?: Transport;
  /** Custom adapter registry (default: built-in registry with openai, anthropic, etc.) */
  adapterRegistry?: AdapterRegistry;
  /** Default execution policy for all requests (can be overridden per-request) */
  policy?: ExecutionPolicy;
}

export class HilbrasClient implements AsyncDisposable {
  private _registry = new ProviderRegistry();
  private _transport: Transport;
  private _adapterRegistry: AdapterRegistry;
  private _adapters = new Map<string, AIProvider>();
  private _defaultPolicy: ExecutionPolicy | undefined;

  constructor(config?: HilbrasClientConfig) {
    this._transport = config?.transport ?? new FetchTransport();
    this._adapterRegistry = config?.adapterRegistry ?? getDefaultAdapterRegistry();
    this._defaultPolicy = config?.policy;
  }

  // ─── Provider Management ────────────────────────────────────────────────

  addProvider(config: ProviderConfig): void {
    this._registry.add(config);
    this._adapters.set(config.name, this._adapterRegistry.create(config.adapter, {
      provider: config,
      transport: this._transport,
    }));
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

  /** Access the adapter registry for plugins */
  get adapterRegistry(): AdapterRegistry {
    return this._adapterRegistry;
  }

  findModel(modelId: string) {
    return this._registry.findModel(modelId);
  }

  // ─── Adapter Lookup ─────────────────────────────────────────────────────

  private _getAdapter(providerName: string): AIProvider {
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
    /** Per-request execution policy (overrides client default) */
    policy?: ExecutionPolicy;
  }): AsyncGenerator<StreamChunk> {
    const providerConfig = this._registry.getOrThrow(params.provider);
    const model = providerConfig.models.find((m) => m.id === params.model);
    if (!model) throw new ModelNotFoundError(params.model, params.provider);

    const adapter = this._getAdapter(params.provider);
    const resolved = resolvePolicy(params.policy ?? this._defaultPolicy);

    // Circuit breaker (if enabled)
    let circuitBreaker = undefined;
    if (resolved.circuitBreaker.enabled) {
      circuitBreaker = getCircuitBreakerRegistry().getOrCreate(params.provider, {
        failureThreshold: resolved.circuitBreaker.failureThreshold,
        successThreshold: resolved.circuitBreaker.successThreshold,
        timeoutMs: resolved.circuitBreaker.timeoutMs,
        halfOpenMaxCalls: resolved.circuitBreaker.halfOpenMaxCalls,
      });
      if (!circuitBreaker.isAvailable()) {
        throw new CircuitBreakerOpenError(params.provider);
      }
    }

    const messages = this._normalizeMessages(params.messages);
    const retryConfig = createRetryConfig({
      maxRetries: resolved.retry.maxRetries,
      retryableStatuses: resolved.retry.retryableStatuses,
      retryableNetworkErrors: resolved.retry.retryableNetworkErrors,
    });

    // Build timeout signal from policy (falls back to provider config)
    const timeoutMs = resolved.timeout.requestTimeoutMs || providerConfig.timeout;
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

        circuitBreaker?.recordSuccess();
        return;
      } catch (err: unknown) {
        // Check if we should retry
        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt, resolved.backoff));
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt, resolved.backoff));
          continue;
        }

        circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
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
    /** Per-request execution policy (overrides client default) */
    policy?: ExecutionPolicy;
  }): Promise<string> {
    const providerConfig = this._registry.getOrThrow(params.provider);
    const model = providerConfig.models.find((m) => m.id === params.model);
    if (!model) throw new ModelNotFoundError(params.model, params.provider);

    const adapter = this._getAdapter(params.provider);
    const resolved = resolvePolicy(params.policy ?? this._defaultPolicy);

    // Circuit breaker (if enabled)
    let circuitBreaker = undefined;
    if (resolved.circuitBreaker.enabled) {
      circuitBreaker = getCircuitBreakerRegistry().getOrCreate(params.provider, {
        failureThreshold: resolved.circuitBreaker.failureThreshold,
        successThreshold: resolved.circuitBreaker.successThreshold,
        timeoutMs: resolved.circuitBreaker.timeoutMs,
        halfOpenMaxCalls: resolved.circuitBreaker.halfOpenMaxCalls,
      });
      if (!circuitBreaker.isAvailable()) {
        throw new CircuitBreakerOpenError(params.provider);
      }
    }

    const messages = this._normalizeMessages(params.messages);
    const retryConfig = createRetryConfig({
      maxRetries: resolved.retry.maxRetries,
      retryableStatuses: resolved.retry.retryableStatuses,
      retryableNetworkErrors: resolved.retry.retryableNetworkErrors,
    });

    // Build timeout signal from policy (falls back to provider config)
    const timeoutMs = resolved.timeout.requestTimeoutMs || providerConfig.timeout;
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
        circuitBreaker?.recordSuccess();
        return result;
      } catch (err: unknown) {
        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt, resolved.backoff));
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          await sleep(calculateBackoff(attempt, resolved.backoff));
          continue;
        }

        circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
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
