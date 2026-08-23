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
import type { ExecutionPolicy } from "../types/policy.js";
import type { TaskRequirement } from "../types/router.js";
import type { StructuredOutputConfig } from "../types/schema.js";
import { ProviderRegistry } from "../providers/registry.js";
import { FetchTransport } from "../transport/fetch.js";
import { getCircuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { createRetryConfig, shouldRetry, shouldRetryNetworkError } from "../reliability/retry.js";
import { calculateBackoff, sleep } from "../reliability/backoff.js";
import { ProviderNotFoundError, ModelNotFoundError, CircuitBreakerOpenError, ValidationError } from "../errors/index.js";
import { createTimeoutSignal } from "../reliability/timeout.js";
import { sdkLogger } from "../logging/logger.js";
import { AdapterRegistry, getDefaultAdapterRegistry } from "../providers/adapter-registry.js";
import { dictToMessage } from "../types/messages.js";
import { resolvePolicy } from "../reliability/presets.js";
import { ModelRouter } from "../router/model-router.js";
import { buildJsonSystemInstruction, buildRepairPrompt, extractJson, buildJsonModeParams } from "../output/structured.js";
import { ClientHooks } from "./hooks.js";
import type { HookEvent, HookEventType, HookListener } from "../types/observability.js";
import { BudgetTracker } from "../cost/tracker.js";
import type { BudgetConfig, CostEvent, CostReport } from "../cost/types.js";
import { estimateTokens } from "../tokens/counter.js";

export interface HilbrasClientConfig {
  /** Custom transport (default: FetchTransport) */
  transport?: Transport;
  /** Custom adapter registry (default: built-in registry with openai, anthropic, etc.) */
  adapterRegistry?: AdapterRegistry;
  /** Default execution policy for all requests (can be overridden per-request) */
  policy?: ExecutionPolicy;
  /** Budget configuration for cost tracking and enforcement */
  budget?: BudgetConfig;
}

export class HilbrasClient implements AsyncDisposable {
  private _registry = new ProviderRegistry();
  private _transport: Transport;
  private _adapterRegistry: AdapterRegistry;
  private _adapters = new Map<string, AIProvider>();
  private _defaultPolicy: ExecutionPolicy | undefined;
  private _router: ModelRouter;
  private _hooks = new ClientHooks();
  private _requestCounter = 0;
  private _budgetTracker: BudgetTracker;

  constructor(config?: HilbrasClientConfig) {
    this._transport = config?.transport ?? new FetchTransport();
    this._adapterRegistry = config?.adapterRegistry ?? getDefaultAdapterRegistry();
    this._defaultPolicy = config?.policy;
    this._router = new ModelRouter();
    this._budgetTracker = new BudgetTracker(config?.budget);
  }

  /** Subscribe to lifecycle events. Returns an unsubscribe function. */
  on<T extends HookEvent = HookEvent>(event: T["type"], listener: HookListener<T>): () => void {
    return this._hooks.on(event, listener);
  }

  /** Remove a specific listener */
  off(event: HookEventType, listener: HookListener): void {
    this._hooks.off(event, listener);
  }

  /** Remove all listeners */
  removeAllListeners(event?: HookEventType): void {
    this._hooks.removeAll(event);
  }

  private _nextRequestId(): string {
    return `req_${++this._requestCounter}`;
  }

  private _emit(event: HookEvent): void {
    this._hooks.emit(event);
  }

  // ─── Provider Management ────────────────────────────────────────────────

  addProvider(config: ProviderConfig): void {
    this._registry.add(config);
    this._adapters.set(config.name, this._adapterRegistry.create(config.adapter, {
      provider: config,
      transport: this._transport,
    }));
    this._router.updateProviders(this._registry.list().map((p) => p.name));
  }

  removeProvider(name: string): void {
    this._registry.remove(name);
    this._adapters.delete(name);
    this._router.updateProviders(this._registry.list().map((p) => p.name));
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

  /** Access the model router */
  get router(): ModelRouter {
    return this._router;
  }

  /**
   * Explain a routing decision — returns the best model with full audit trail.
   * Always includes rejected candidates for debugging.
   *
   * @example
   * const decision = client.explain({ task: "coding", needsTools: true, maxCost: 0.05 });
   * console.log(decision.reasons);
   */
  explain(requirements: TaskRequirement): import("../types/router.js").RoutingResult | null {
    return this._router.explain(requirements);
  }

  /**
   * Create an execution plan — the full decision about how to execute a request.
   * Includes primary model, fallbacks, cost estimates, and reasoning.
   *
   * @example
   * const plan = client.plan({ task: "coding", messages, policy: { allowFallback: true } });
   * console.log(plan.estimatedTotalCost);
   */
  plan(requirements: TaskRequirement & { messages?: Array<Record<string, unknown> | Message> }): import("../types/execution.js").ExecutionPlan | null {
    const requestId = this._nextRequestId();
    return this._router.plan(requirements, requestId);
  }

  /** Get fallback candidates for a failed request */
  private _getFallbacks(excludeModels: string[], requirements: { task?: string; needsVision?: boolean; needsTools?: boolean; needsReasoning?: boolean; needsStructuredOutput?: boolean; maxCost?: number; budget?: "low" | "medium" | "high"; excludeModels?: string[]; preferredProvider?: string }): Array<{ provider: string; model: string }> {
    const results = this._router.evaluate(requirements as TaskRequirement, false);
    return results
      .filter((r) => !excludeModels.includes(r.model))
      .slice(0, 3)
      .map((r) => ({ provider: r.provider, model: r.model }));
  }

  // ─── Cost Tracking ──────────────────────────────────────────────────────

  /** Access the cost tracker */
  get cost(): BudgetTracker { return this._budgetTracker; }

  /** Get the current cost report */
  costReport(): CostReport { return this._budgetTracker.report(); }

  /** Check if budget is exhausted */
  isBudgetExhausted(): boolean { return this._budgetTracker.isBudgetExhausted(); }

  findModel(modelId: string) {
    return this._registry.findModel(modelId);
  }

  // ─── Adapter Lookup ─────────────────────────────────────────────────────

  private _getAdapter(providerName: string): AIProvider {
    const adapter = this._adapters.get(providerName);
    if (!adapter) throw new ProviderNotFoundError(providerName);
    return adapter;
  }

  // ─── Provider/Model Resolution ──────────────────────────────────────────

  private _resolveProviderModel(params: {
    provider?: string;
    model?: string;
    task?: string;
    needsVision?: boolean;
    needsTools?: boolean;
    needsReasoning?: boolean;
    needsStructuredOutput?: boolean;
    maxCost?: number;
    budget?: "low" | "medium" | "high";
    excludeModels?: string[];
    preferredProvider?: string;
    hasOutput?: boolean;
  }): { providerName: string; modelId: string } {
    // If explicit provider + model, use them directly
    if (params.provider && params.model) {
      return { providerName: params.provider, modelId: params.model };
    }

    // Auto-connect: structured output requirement → router capability filter
    const needsStructured = params.needsStructuredOutput ?? params.hasOutput ?? false;

    // Route via the model router
    const result = this._router.best({
      task: params.task as import("../types/router.js").TaskType | undefined,
      needsVision: params.needsVision,
      needsTools: params.needsTools,
      needsReasoning: params.needsReasoning,
      needsStructuredOutput: needsStructured,
      maxCost: params.maxCost,
      budget: params.budget,
      excludeModels: params.excludeModels,
      preferredProvider: params.preferredProvider,
    });

    if (!result) {
      throw new Error(
        "No model found matching the given requirements. " +
        "Try relaxing constraints or registering more providers."
      );
    }

    return { providerName: result.provider, modelId: result.model };
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
    provider?: string;
    model?: string;
    messages: Array<Record<string, unknown> | Message>;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
    /** Per-request execution policy (overrides client default) */
    policy?: ExecutionPolicy;
    /** Task requirements for automatic model routing (when provider/model are omitted) */
    task?: string;
    needsVision?: boolean;
    needsTools?: boolean;
    needsReasoning?: boolean;
    needsStructuredOutput?: boolean;
    maxCost?: number;
    budget?: "low" | "medium" | "high";
    excludeModels?: string[];
    preferredProvider?: string;
  }): AsyncGenerator<StreamChunk> {
    const requestId = this._nextRequestId();
    const startTime = performance.now();
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let firstChunkEmitted = false;
    let adapterStartTime = 0;

    this._emit({ type: "request.start", requestId, timestamp: startTime, provider: params.provider, model: params.model, task: params.task });

    // Resolve provider + model — either explicit or via router
    const { providerName, modelId } = this._resolveProviderModel(params);
    const providerConfig = this._registry.getOrThrow(providerName);
    const model = providerConfig.models.find((m) => m.id === modelId);
    if (!model) throw new ModelNotFoundError(modelId, providerName);

    this._emit({ type: "routing.resolved", requestId, timestamp: performance.now(), provider: providerName, model: modelId, score: 0, reasons: params.provider ? ["Explicit provider/model"] : ["Router selected"] });

    const adapter = this._getAdapter(providerName);
    const resolved = resolvePolicy(params.policy ?? this._defaultPolicy);

    // Circuit breaker (if enabled)
    let circuitBreaker = undefined;
    if (resolved.circuitBreaker.enabled) {
      circuitBreaker = getCircuitBreakerRegistry().getOrCreate(providerName, {
        failureThreshold: resolved.circuitBreaker.failureThreshold,
        successThreshold: resolved.circuitBreaker.successThreshold,
        timeoutMs: resolved.circuitBreaker.timeoutMs,
        halfOpenMaxCalls: resolved.circuitBreaker.halfOpenMaxCalls,
      });
      if (!circuitBreaker.isAvailable()) {
        this._emit({ type: "circuit_breaker.open", requestId, timestamp: performance.now(), provider: providerName });
        throw new CircuitBreakerOpenError(providerName);
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
        adapterStartTime = performance.now();
        const gen = adapter.stream({
          model: modelId,
          messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          tools: params.tools,
          extra: params.extra,
          signal,
        });

        for await (const chunk of gen) {
          // Track first chunk latency
          if (!firstChunkEmitted) {
            firstChunkEmitted = true;
            this._emit({ type: "stream.first_chunk", requestId, timestamp: performance.now(), latencyMs: performance.now() - adapterStartTime });
          }
          // Track usage tokens
          if (chunk.type === "usage") {
            inputTokens = (chunk as { inputTokens?: number }).inputTokens;
            outputTokens = (chunk as { outputTokens?: number }).outputTokens;
          }
          yield chunk;
        }

        circuitBreaker?.recordSuccess();
        this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, inputTokens, outputTokens, structuredOutput: false });
        return;
      } catch (err: unknown) {
        // Check if we should retry
        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          const delay = calculateBackoff(attempt, resolved.backoff);
          this._emit({ type: "request.retrying", requestId, timestamp: performance.now(), provider: providerName, attempt, delayMs: delay, reason: "network error" });
          await sleep(delay);
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          const delay = calculateBackoff(attempt, resolved.backoff);
          this._emit({ type: "request.retrying", requestId, timestamp: performance.now(), provider: providerName, attempt, delayMs: delay, reason: `HTTP ${status}` });
          await sleep(delay);
          continue;
        }

        // Try fallback if allowed and we have candidates
        if (resolved.allowFallback && attempt >= retryConfig.maxRetries) {
          const fallbacks = this._getFallbacks([modelId], params);
          for (const fb of fallbacks) {
            this._emit({ type: "fallback.started", requestId, timestamp: performance.now(), originalProvider: providerName, originalModel: modelId, fallbackProvider: fb.provider, fallbackModel: fb.model });
            try {
              const fbAdapter = this._getAdapter(fb.provider);
              const gen = fbAdapter.stream({ model: fb.model, messages, temperature: params.temperature, maxTokens: params.maxTokens, tools: params.tools, extra: params.extra, signal });
              for await (const chunk of gen) { yield chunk; }
              this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: fb.provider, model: fb.model, durationMs: performance.now() - startTime, attempts: attempt + 2, inputTokens, outputTokens, structuredOutput: false });
              return;
            } catch { /* fallback also failed — continue to next */ }
          }
        }

        circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
        this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
  }

  // ─── Non-Streaming Completion ───────────────────────────────────────────

  async complete<T = string>(params: {
    provider?: string;
    model?: string;
    messages: Array<Record<string, unknown> | Message>;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
    /** Per-request execution policy (overrides client default) */
    policy?: ExecutionPolicy;
    /** Structured output config — validates and auto-repairs */
    output?: StructuredOutputConfig<T>;
    /** Task requirements for automatic model routing (when provider/model are omitted) */
    task?: string;
    needsVision?: boolean;
    needsTools?: boolean;
    needsReasoning?: boolean;
    needsStructuredOutput?: boolean;
    maxCost?: number;
    budget?: "low" | "medium" | "high";
    excludeModels?: string[];
    preferredProvider?: string;
  }): Promise<T> {
    const requestId = this._nextRequestId();
    const startTime = performance.now();

    this._emit({ type: "request.start", requestId, timestamp: startTime, provider: params.provider, model: params.model, task: params.task });

    // Resolve provider + model — either explicit or via router
    const resolved_ = this._resolveProviderModel({ ...params, hasOutput: !!params.output });
    const providerConfig = this._registry.getOrThrow(resolved_.providerName);
    const model = providerConfig.models.find((m) => m.id === resolved_.modelId);
    if (!model) throw new ModelNotFoundError(resolved_.modelId, resolved_.providerName);
    const providerName = resolved_.providerName;
    const modelId = resolved_.modelId;

    this._emit({ type: "routing.resolved", requestId, timestamp: performance.now(), provider: providerName, model: modelId, score: 0, reasons: params.provider ? ["Explicit provider/model"] : ["Router selected"] });

    const adapter = this._getAdapter(providerName);
    const resolved = resolvePolicy(params.policy ?? this._defaultPolicy);

    // Circuit breaker (if enabled)
    let circuitBreaker = undefined;
    if (resolved.circuitBreaker.enabled) {
      circuitBreaker = getCircuitBreakerRegistry().getOrCreate(providerName, {
        failureThreshold: resolved.circuitBreaker.failureThreshold,
        successThreshold: resolved.circuitBreaker.successThreshold,
        timeoutMs: resolved.circuitBreaker.timeoutMs,
        halfOpenMaxCalls: resolved.circuitBreaker.halfOpenMaxCalls,
      });
      if (!circuitBreaker.isAvailable()) {
        this._emit({ type: "circuit_breaker.open", requestId, timestamp: performance.now(), provider: providerName });
        throw new CircuitBreakerOpenError(providerName);
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

    // Structured output setup
    const outputConfig = params.output;
    let structuredMessages = [...messages];
    let structuredExtra = { ...params.extra };

    if (outputConfig) {
      // Add JSON mode params for the provider
      const jsonModeParams = buildJsonModeParams(adapter.id);
      structuredExtra = { ...structuredExtra, ...jsonModeParams };

      // Add system instruction for JSON output
      const schemaDesc = buildJsonSystemInstruction(outputConfig.schema as never);
      structuredMessages = [
        { role: "system", content: buildJsonSystemInstruction(outputConfig.schema as never) },
        ...messages,
      ];
    }

    const maxRepairAttempts = outputConfig?.maxRepairAttempts ?? 2;

    // Budget check before execution
    const estimatedCost = this._budgetTracker.estimate(modelId, providerName, estimateTokens(messages.map((m) => m.content ?? "").join("")), 0);
    if (this._budgetTracker.wouldExceedBudget(estimatedCost)) {
      throw new Error(`Request would exceed per-request budget ($${estimatedCost.toFixed(4)})`);
    }
    if (this._budgetTracker.isBudgetExhausted()) {
      throw new Error("Session budget exhausted");
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const result = await adapter.complete({
          model: modelId,
          messages: structuredMessages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          tools: params.tools,
          extra: structuredExtra,
          signal,
        });
        circuitBreaker?.recordSuccess();

        // If no structured output, return raw string
        if (!outputConfig) {
          this._budgetTracker.record({ requestId, provider: providerName, model: modelId, phase: "execute", estimatedCost, actualCost: estimatedCost, timestamp: performance.now() });
          this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, structuredOutput: false });
          return result as T;
        }

        // Validate structured output
        const json = extractJson(result);
        const parsed = JSON.parse(json);
        const validation = outputConfig.schema.safeParse(parsed);
        if (validation.success) {
          this._budgetTracker.record({ requestId, provider: providerName, model: modelId, phase: "execute", estimatedCost, actualCost: estimatedCost, timestamp: performance.now() });
          this._emit({ type: "structured.validate.pass", requestId, timestamp: performance.now() });
          this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, structuredOutput: true });
          return validation.data;
        }

        // Validation failed — attempt repair
        this._emit({ type: "structured.validate.fail", requestId, timestamp: performance.now(), attempt, error: validation.error instanceof Error ? validation.error.message : String(validation.error) });
        if (attempt < maxRepairAttempts) {
          const repairPrompt = buildRepairPrompt(
            validation.error,
            result,
            buildJsonSystemInstruction(outputConfig.schema as never),
            outputConfig.repairInstructions,
          );
          // Replace last user message with repair prompt
          const lastUserIdx = structuredMessages.map((m) => m.role).lastIndexOf("user");
          if (lastUserIdx >= 0) {
            structuredMessages = [
              ...structuredMessages.slice(0, lastUserIdx),
              { role: "user", content: repairPrompt },
            ];
          } else {
            structuredMessages = [...structuredMessages, { role: "user", content: repairPrompt }];
          }
          continue;
        }

        // Exhausted repair attempts
        this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: "Validation failed after repair attempts" });
        throw new ValidationError(maxRepairAttempts + 1, validation.error, result);
      } catch (err: unknown) {
        // Don't retry validation errors through the retry loop
        if (err instanceof ValidationError) {
          throw err;
        }

        const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
        const status = (err as { status?: number }).status;

        if (isNetworkError && shouldRetryNetworkError(attempt, retryConfig)) {
          const delay = calculateBackoff(attempt, resolved.backoff);
          this._emit({ type: "request.retrying", requestId, timestamp: performance.now(), provider: providerName, attempt, delayMs: delay, reason: "network error" });
          await sleep(delay);
          continue;
        }
        if (typeof status === "number" && shouldRetry(status, attempt, retryConfig)) {
          const delay = calculateBackoff(attempt, resolved.backoff);
          this._emit({ type: "request.retrying", requestId, timestamp: performance.now(), provider: providerName, attempt, delayMs: delay, reason: `HTTP ${status}` });
          await sleep(delay);
          continue;
        }

        // Try fallback if allowed and retries exhausted
        if (resolved.allowFallback && attempt >= retryConfig.maxRetries && !(err instanceof ValidationError)) {
          const fallbacks = this._getFallbacks([modelId], params);
          for (const fb of fallbacks) {
            try {
              const fbAdapter = this._getAdapter(fb.provider);
              const result = await fbAdapter.complete({ model: fb.model, messages: structuredMessages, temperature: params.temperature, maxTokens: params.maxTokens, tools: params.tools, extra: structuredExtra, signal });
              this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: fb.provider, model: fb.model, durationMs: performance.now() - startTime, attempts: attempt + 2, structuredOutput: !!outputConfig });
              if (!outputConfig) return result as T;
              const json = extractJson(result);
              const parsed = JSON.parse(json);
              const validation = outputConfig.schema.safeParse(parsed);
              if (validation.success) return validation.data;
              throw new ValidationError(maxRepairAttempts + 1, validation.error, result);
            } catch { /* fallback also failed — continue to next */ }
          }
        }

        circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
        this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
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
