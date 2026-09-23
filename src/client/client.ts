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
import type { RetryConfig } from "../reliability/retry.js";
import type { CircuitBreakerPort } from "../core/execution/ports.js";
import { RequestExecutor } from "../core/execution/request-executor.js";
import { RequestPipeline } from "../core/execution/request-pipeline.js";
import type { RequestOperation } from "../core/execution/request-context.js";
import type { TaskRequirement } from "../types/router.js";
import type { StructuredOutputConfig, StreamObjectOptions, SchemaValidator } from "../types/schema.js";
import type {
  EmbeddingResult,
  ImageResult,
  SpeechResult,
  TranscriptionResult,
  RerankResult,
} from "../types/multi-modal.js";
import { ProviderRegistry } from "../providers/registry.js";
import { cloneProviderConfig } from "../config/provider-config.js";
import { FetchTransport } from "../transport/fetch.js";
import { MiddlewareTransport } from "../transport/middleware-transport.js";
import { getCircuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { createRetryConfig, shouldRetry, shouldRetryNetworkError } from "../reliability/retry.js";
import { calculateBackoff, sleep } from "../reliability/backoff.js";
import { ProviderNotFoundError, ModelNotFoundError, CircuitBreakerOpenError, ValidationError, ConfigurationError } from "../errors/index.js";

import { AdapterRegistry, getDefaultAdapterRegistry } from "../providers/adapter-registry.js";
import { dictToMessage } from "../types/messages.js";
import { validateBaseUrl } from "../security/url-guard.js";
import { resolvePolicy } from "../reliability/presets.js";
import { ModelRouter } from "../router/model-router.js";
import { buildJsonSystemInstruction, buildRepairPrompt, extractJson, buildJsonModeParams } from "../output/structured.js";
import { ClientHooks } from "./hooks.js";
import type { StructuredLogger } from "../telemetry/structured-logger.js";
import type { OpenTelemetryExporter } from "../telemetry/opentelemetry.js";
import type { HookEvent, HookEventType, HookListener } from "../types/observability.js";
import { BudgetTracker } from "../cost/tracker.js";
import type { BudgetConfig, CostReport } from "../cost/types.js";
import { estimateTokens, type Tokenizer } from "../tokens/counter.js";
import { getProviderCatalog, getModelsForProvider, listProviders } from "../catalog/index.js";
import type { AdapterName } from "../types/providers.js";
import type { ModelCapabilities } from "../types/models.js";
import { PluginRegistry } from "../plugin/registry.js";
import type { Plugin } from "../plugin/types.js";

export interface HilbrasClientConfig {
  /** Custom transport (default: FetchTransport) */
  transport?: Transport;
  /**
   * v2.5.0: Middleware pipeline applied to all transport requests.
   * When provided, the transport is automatically wrapped with a
   * `MiddlewareTransport` that applies the middleware chain.
   *
   * This is a convenience shortcut — if you already have a custom
   * `transport` that wraps middleware, you don't need this.
   *
   * @example
   * ```ts
   * const client = new HilbrasClient({
   *   middleware: composeMiddlewares(authMiddleware(getToken), loggingMiddleware()),
   * });
   * ```
   */
  middleware?: import("../middleware/middleware.js").Middleware;
  /** Custom adapter registry (default: built-in registry with openai, anthropic, etc.) */
  adapterRegistry?: AdapterRegistry;
  /** Default execution policy for all requests (can be overridden per-request) */
  policy?: ExecutionPolicy;
  /** Budget configuration for cost tracking and enforcement */
  budget?: BudgetConfig;
  /**
   * Master switch: allow providers to register http:// baseUrls.
   * Loopback/`.local` is always allowed when this is on. Private network
   * ranges additionally require {@link allowPrivateNetwork}.
   * Defaults to false. Per-provider `allowInsecure: true` overrides this.
   */
  allowInsecureUrls?: boolean;
  /**
   * On top of {@link allowInsecureUrls}, allow private network ranges
   * (10.*, 172.16-31.*, 192.168.*). Defaults to false.
   */
  allowPrivateNetwork?: boolean;
  /**
   * v0.10.0 PR-5: layered SDK config (e.g. from `loadConfig()`).
   * Mapped into `policy` and `budget` if those aren't already set.
   * Precedence: explicit `policy`/`budget` > `sdkConfig.policy`/`sdkConfig.budget`
   * > `DEFAULT_CONFIG`.
   *
   * Currently wired fields: `maxRetries`, `requestTimeoutMs`,
   * `circuitBreakerEnabled`/`circuitBreakerThreshold`/`circuitBreakerResetMs`,
   * `sessionBudget`, `perRequestBudget`.
   */
  sdkConfig?: import("../config/schema.js").SDKConfig;
  /**
   * v1.1.0: Optional telemetry sinks. When provided, the client automatically
   * forwards lifecycle events to the configured sinks.
   */
  telemetry?: {
    /** Structured JSON logger for production */
    structuredLogger?: StructuredLogger;
    /** OpenTelemetry exporter for traces and metrics */
    openTelemetry?: OpenTelemetryExporter;
  };
  /**
   * v2.5.0 BUG-04: Optional per-client tokenizer for accurate token counting.
   * When provided, this tokenizer is used instead of the global `setTokenizer()`
   * singleton, allowing multiple clients to use different tokenizers without
   * interfering with each other.
   *
   * @example
   * ```ts
   * import { createTokenizer } from "tiktoken";
   * const enc = await createTokenizer("cl100k_base");
   * const client = new HilbrasClient({
   *   tokenizer: { count: (text) => enc.encode(text).length },
   * });
   * ```
   */
  tokenizer?: Tokenizer;
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
  private _allowInsecureUrls: boolean;
  private _allowPrivateNetwork: boolean;
  private _tokenizer: Tokenizer | null;
  private _plugins = new PluginRegistry();
  private _requestExecutor: RequestExecutor;
  private _requestPipeline: RequestPipeline;

  constructor(config?: HilbrasClientConfig) {
    this._transport = config?.transport ?? new FetchTransport();
    // v2.5.0: Wrap transport with middleware pipeline when provided
    if (config?.middleware) {
      this._transport = new MiddlewareTransport(this._transport, config.middleware);
    }
    this._adapterRegistry = config?.adapterRegistry ?? getDefaultAdapterRegistry();
    this._router = new ModelRouter();
    this._allowInsecureUrls = config?.allowInsecureUrls ?? false;
    this._allowPrivateNetwork = config?.allowPrivateNetwork ?? false;
    this._tokenizer = config?.tokenizer ?? null;

    // v0.10.0 PR-5: derive policy + budget from sdkConfig when not
    // explicitly provided. Precedence: explicit > sdkConfig > defaults.
    const sdk = config?.sdkConfig;
    this._defaultPolicy = config?.policy ?? (sdk ? this._policyFromSDK(sdk) : undefined);
    const sdkBudget = sdk ? this._budgetFromSDK(sdk) : undefined;
    this._budgetTracker = new BudgetTracker(config?.budget ?? sdkBudget);
    this._requestExecutor = new RequestExecutor({
      policy: {
        resolve: (policy) => resolvePolicy(policy ?? this._defaultPolicy),
      },
      circuitBreakers: {
        getOrCreate: (provider, circuitPolicy) => getCircuitBreakerRegistry().getOrCreate(provider, circuitPolicy),
      },
      adapters: {
        get: (provider) => this._adapters.get(provider),
      },
    });

    this._requestPipeline = new RequestPipeline({
      executor: this._requestExecutor,
      budget: this._budgetTracker,
      plugins: this._plugins,
      emit: (event) => this._emit(event),
      now: () => performance.now(),
      sleep: (ms) => sleep(ms),
      onCircuitOpen: (requestId, provider) => {
        this._emit({ type: "circuit_breaker.open", requestId, timestamp: performance.now(), provider });
      },
    });

    // v1.1.0: Register providers from SDKConfig if provided
    if (sdk?.providers?.length) {
      for (const provider of sdk.providers) {
        if (!this._registry.get(provider.name)) {
          this.addProvider(provider);
        }
      }
    }

    // v1.1.0: Wire telemetry sinks
    if (config?.telemetry?.structuredLogger) {
      config.telemetry.structuredLogger.instrumentClient(this as any);
    }
    if (config?.telemetry?.openTelemetry) {
      config.telemetry.openTelemetry.instrumentClient(this as any);
    }
  }

  /**
   * Map the legacy SDKConfig fields (maxRetries, requestTimeoutMs,
   * circuitBreakerEnabled/Threshold/ResetMs) to an ExecutionPolicy.
   * Unrecognized fields are left undefined; the per-request policy
   * resolver fills in defaults.
   */
  private _policyFromSDK(sdk: import("../config/schema.js").SDKConfig): ExecutionPolicy {
    const policy: ExecutionPolicy = {};
    if (sdk.maxRetries !== undefined) {
      policy.retry = { maxRetries: sdk.maxRetries };
    }
    if (sdk.requestTimeoutMs !== undefined) {
      policy.timeout = { requestTimeoutMs: sdk.requestTimeoutMs };
    }
    if (sdk.circuitBreakerEnabled !== undefined || sdk.circuitBreakerThreshold !== undefined || sdk.circuitBreakerResetMs !== undefined) {
      policy.circuitBreaker = {
        enabled: sdk.circuitBreakerEnabled,
        failureThreshold: sdk.circuitBreakerThreshold,
        timeoutMs: sdk.circuitBreakerResetMs,
      };
    }
    return policy;
  }

  /** Map the legacy SDKConfig budget fields to a BudgetConfig. */
  private _budgetFromSDK(sdk: import("../config/schema.js").SDKConfig): BudgetConfig {
    const budget: BudgetConfig = {};
    if (sdk.sessionBudget !== undefined) budget.sessionBudget = sdk.sessionBudget;
    if (sdk.perRequestBudget !== undefined) budget.perRequestBudget = sdk.perRequestBudget;
    return budget;
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

  // ─── Plugin System ──────────────────────────────────────────────────────

  /**
   * Register one or more plugins with the client. Plugins receive lifecycle
   * hooks that fire around every LLM request.
   *
   * @example
   * ```ts
   * client.use({
   *   name: "logger",
   *   onRequest(ctx) { console.log(`[${ctx.requestId}] → ${ctx.provider}/${ctx.model}`); },
   *   onResponse(ctx) { console.log(`[${ctx.requestId}] ✓ ${ctx.durationMs}ms`); },
   *   onError(ctx) { console.error(`[${ctx.requestId}] ✗ ${ctx.error.message}`); },
   * });
   * ```
   */
  async use(...plugins: Plugin[]): Promise<void> {
    await this._plugins.add(...plugins);
    for (const plugin of plugins) await this._plugins.setup(plugin, this as never);
  }

  private _nextRequestId(): string {
    return `req_${++this._requestCounter}`;
  }

  /**
   * Client-scoped token estimation. Uses the per-client tokenizer when set,
   * otherwise falls back to the global `estimateTokens()`.
   *
   * BUG-04 fix: This prevents multiple clients from fighting over the global
   * `setTokenizer()` singleton.
   */
  private _estimateTokens(text: string): number {
    if (this._tokenizer) return this._tokenizer.count(text);
    return estimateTokens(text);
  }

  private _emit(event: HookEvent): void {
    this._hooks.emit(event);
  }

  // ─── Provider Management ────────────────────────────────────────────────

  addProvider(config: ProviderConfig): void {
    const ownedConfig = cloneProviderConfig(config);
    // v0.9.3: SSRF guard. Per-provider `allowInsecure` overrides client-wide
    // `allowInsecureUrls`; local targets require explicit opt-in.
    const guard = validateBaseUrl(ownedConfig.baseUrl, {
      allowInsecure: ownedConfig.allowInsecure ?? this._allowInsecureUrls,
      allowPrivateNetwork: this._allowPrivateNetwork,
    });
    if (!guard.ok) {
      throw new ConfigurationError(
        `Refused to register provider '${ownedConfig.name}': ${guard.reason}`,
      );
    }
    const adapter = this._adapterRegistry.create(ownedConfig.adapter, {
      provider: ownedConfig,
      transport: this._transport,
    });
    this._registry.add(ownedConfig);
    this._adapters.set(ownedConfig.name, adapter);
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

  /**
   * Add a provider from the built-in catalog with one line.
   *
   * @example
   * ```ts
   * client.addProviderFromCatalog("openai", "gpt-4o", process.env.OPENAI_API_KEY!);
   * ```
   */
  addProviderFromCatalog(providerId: string, modelId: string, apiKey: string): string {
    const catalogProviderId = listProviders().find((id) => id.toLowerCase() === providerId.toLowerCase()) ?? providerId;
    const provider = getProviderCatalog(catalogProviderId);
    if (!provider) throw new ConfigurationError(`Unknown provider: ${providerId}`, `Available catalog providers: openai, anthropic, google-vertex, google-genai, groq, mistral, deepseek, cohere, huggingface, ollama, bedrock, azure, elevenlabs, voyageai`);
    const models = getModelsForProvider(catalogProviderId);
    const model = models.find((m) => m.id === modelId);
    if (!model) throw new ConfigurationError(`Model ${modelId} not found for provider ${providerId}`, `Available models for ${providerId}: ${models.map((m) => m.id).join(", ")}`);

    const adapter = provider.adapters[0] as AdapterName ?? "openai-compatible";
    this.addProvider({
      name: provider.name,
      baseUrl: provider.baseUrl,
      authentication: { type: "bearer", apiKey },
      adapter,
      models: [
        {
          id: model.id,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutput,
          capabilities: this._parseCapabilities(model.capabilities, catalogProviderId),
        },
      ],
    });
    return provider.name;
  }

  /** Access the adapter registry for plugins */
  get adapterRegistry(): AdapterRegistry {
    return this._adapterRegistry;
  }

  /**
   * Parse catalog capabilities string array to ModelCapabilities object.
   */
  private _parseCapabilities(capabilities: string[], providerId: string): ModelCapabilities {
    const cap: ModelCapabilities = {
      streaming: false,
      tools: false,
      vision: false,
      reasoning: false,
      structuredOutput: false,
      parallelTools: false,
      systemPrompts: false,
      embeddings: false,
      imageGeneration: false,
      speech: false,
      transcription: false,
      reranking: false,
    };
    for (const c of capabilities) {
      if (c in cap) cap[c as keyof ModelCapabilities] = true;
    }
    // Provider-specific defaults
    if (providerId === "openai" || providerId === "anthropic" || providerId === "google") {
      cap.systemPrompts = true;
    }
    return cap;
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
    if (!adapter) throw new ProviderNotFoundError(providerName, this._registry.list().map((c) => c.name));
    return adapter;
  }

  // ─── Request Pre-Flight (v0.10.0 PR-4) ───────────────────────────────

  /**
   * Resolve the per-request reliability primitives: policy, circuit-breaker,
   * retry config, and timeout-wrapped signal. Both `stream()` and `complete()`
   * did this work inline with near-duplicate code. Now they share this
   * helper. Pure refactor: the returned values are byte-for-byte equivalent
   * to what the inline code produced before PR-4.
   */
  private _prepareRequest(
    requestId: string,
    providerName: string,
    providerConfig: ProviderConfig,
    policy: ExecutionPolicy | undefined,
    userSignal: AbortSignal | undefined,
    operation: RequestOperation = "complete",
  ): {
    resolved: ResolvedPolicy;
    circuitBreaker: CircuitBreakerPort | undefined;
    retryConfig: RetryConfig;
    signal: AbortSignal | undefined;
    dispose: () => void;
  } {
    try {
      const prepared = this._requestExecutor.prepare({
        requestId,
        operation,
        provider: providerName,
        model: providerConfig.models[0]?.id ?? "",
        policy,
        providerTimeoutMs: providerConfig.timeout,
        callerSignal: userSignal,
      });
      return {
        resolved: prepared.context.policy,
        circuitBreaker: prepared.circuitBreaker,
        retryConfig: prepared.retryConfig,
        signal: prepared.signal,
        dispose: prepared.dispose,
      };
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        this._emit({ type: "circuit_breaker.open", requestId, timestamp: performance.now(), provider: providerName });
      }
      throw error;
    }
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
    // Budget tracking for streaming. v0.9.3: stream() now reserves like complete().
    let estimatedCost = 0;
    let reservationActive = false;
    let usageSettled = false;

    this._emit({ type: "request.start", requestId, timestamp: startTime, provider: params.provider, model: params.model, task: params.task });

    // Resolve provider + model — either explicit or via router
    const { providerName, modelId } = this._resolveProviderModel(params);
    const providerConfig = this._registry.getOrThrow(providerName);
    const model = providerConfig.models.find((m) => m.id === modelId);
    if (!model) throw new ModelNotFoundError(modelId, providerName, providerConfig.models.map((m) => m.id));

    this._emit({ type: "routing.resolved", requestId, timestamp: performance.now(), provider: providerName, model: modelId, score: 0, reasons: params.provider ? ["Explicit provider/model"] : ["Router selected"] });

    const adapter = this._getAdapter(providerName);
    // v0.10.0 PR-4: extract the duplicated policy/circuit-breaker/retry/signal
    // setup into _prepareRequest so stream() and complete() share it.
    const { resolved, circuitBreaker, retryConfig, signal } = this._prepareRequest(
      requestId,
      providerName,
      providerConfig,
      params.policy,
      params.signal,
      "stream",
    );

    const messages = this._normalizeMessages(params.messages);

    // v3.0.0: Plugin onRequest hook
    await this._plugins.fireRequest({
      requestId,
      provider: providerName,
      model: modelId,
      messages,
      extra: params.extra,
      signal: params.signal,
      timestamp: startTime,
    });

    // Atomic budget reservation before any provider call. Reserves the
    // estimated cost for the entire retry+fallback chain; the reservation is
    // converted to actual on the first usage chunk, or released on failure.
    estimatedCost = this._budgetTracker.estimate(modelId, providerName, this._estimateTokens(messages.map((m) => m.content ?? "").join("")), 0);
    const initialReservation = this._budgetTracker.reserve(requestId, estimatedCost);
    if (!initialReservation) {
      throw new ConfigurationError(
        `Budget reservation rejected — estimated cost $${estimatedCost.toFixed(4)} would exceed budget`,
        `Remaining budget: $${this._budgetTracker.report().remainingBudget?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
      );
    }
    reservationActive = true;

    try {
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
            // Track usage tokens and convert reservation on first usage chunk
            if (chunk.type === "usage") {
              const inT = (chunk as { inputTokens?: number }).inputTokens;
              const outT = (chunk as { outputTokens?: number }).outputTokens;
              inputTokens = inT;
              outputTokens = outT;
              if (reservationActive && !usageSettled) {
                const actualCost = this._budgetTracker.estimate(modelId, providerName, inT ?? 0, outT ?? 0);
                this._budgetTracker.settle(requestId, actualCost, { provider: providerName, model: modelId, phase: "execute" });
                reservationActive = false;
                usageSettled = true;
              }
            }
            yield chunk;
          }

          circuitBreaker?.recordSuccess();
          // End-of-stream with no usage chunk: settle at the estimate
          if (reservationActive) {
            this._budgetTracker.settle(requestId, estimatedCost, { provider: providerName, model: modelId, phase: "execute" });
            reservationActive = false;
          }
          this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, inputTokens, outputTokens, structuredOutput: false });
          // v3.0.0: Plugin onResponse hook
          await this._plugins.fireResponse({ requestId, provider: providerName, model: modelId, durationMs: performance.now() - startTime, inputTokens, outputTokens, streaming: true });
          return;
        } catch (err: unknown) {
          // Once a chunk has escaped to the caller, retrying would duplicate
          // output and potentially repeat tool side effects. Caller cancellation
          // is terminal as well.
          const callerAborted = params.signal?.aborted === true;
          if (callerAborted || firstChunkEmitted) {
            circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
            this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
            await this._plugins.fireError({ requestId, provider: providerName, model: modelId, error: err instanceof Error ? err : new Error(String(err)), durationMs: performance.now() - startTime, attempts: attempt + 1 });
            throw err;
          }

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
            let fallbackSucceeded = false;
            for (const fb of fallbacks) {
              this._emit({ type: "fallback.started", requestId, timestamp: performance.now(), originalProvider: providerName, originalModel: modelId, fallbackProvider: fb.provider, fallbackModel: fb.model });
              // Release original reservation, re-reserve under fallback id
              if (reservationActive) {
                this._budgetTracker.release(requestId);
                reservationActive = false;
              }
              const fbReservationId = `${requestId}_fb_${fb.model}`;
              const fbEstimatedCost = this._budgetTracker.estimate(fb.model, fb.provider, this._estimateTokens(messages.map((m) => m.content ?? "").join("")), 0);
              const fbReservation = this._budgetTracker.reserve(fbReservationId, fbEstimatedCost);
              if (!fbReservation) continue; // budget exceeded for this fallback
              let fbReservationActive = true;
              try {
                const fbAdapter = this._getAdapter(fb.provider);
                const gen = fbAdapter.stream({ model: fb.model, messages, temperature: params.temperature, maxTokens: params.maxTokens, tools: params.tools, extra: params.extra, signal });
                for await (const chunk of gen) {
                  if (chunk.type === "usage") {
                    const inT = (chunk as { inputTokens?: number }).inputTokens;
                    const outT = (chunk as { outputTokens?: number }).outputTokens;
                    if (fbReservationActive) {
                      const actualCost = this._budgetTracker.estimate(fb.model, fb.provider, inT ?? 0, outT ?? 0);
                      this._budgetTracker.settle(fbReservationId, actualCost, { provider: fb.provider, model: fb.model, phase: "fallback" });
                      fbReservationActive = false;
                    }
                  }
                  yield chunk;
                }
                // End-of-stream without usage chunk: settle at estimate
                if (fbReservationActive) {
                  this._budgetTracker.settle(fbReservationId, fbEstimatedCost, { provider: fb.provider, model: fb.model, phase: "fallback" });
                  fbReservationActive = false;
                }
                this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: fb.provider, model: fb.model, durationMs: performance.now() - startTime, attempts: attempt + 2, inputTokens, outputTokens, structuredOutput: false });
                fallbackSucceeded = true;
                return;
              } catch {
                if (fbReservationActive) {
                  this._budgetTracker.release(fbReservationId);
                  fbReservationActive = false;
                }
                /* fallback also failed — continue to next */
              }
            }
            if (fallbackSucceeded) return; // unreachable but for type safety
          }

          circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
          this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
          // v3.0.0: Plugin onError hook
          await this._plugins.fireError({ requestId, provider: providerName, model: modelId, error: err instanceof Error ? err : new Error(String(err)), durationMs: performance.now() - startTime, attempts: attempt + 1 });
          throw err;
        }
      }
    } finally {
      // Guarantee release on any path that did not settle (consumer break,
      // signal abort, unexpected throw). Idempotent: settle/release are no-ops
      // on missing reservations.
      if (reservationActive) {
        this._budgetTracker.release(requestId);
        reservationActive = false;
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
    if (!model && providerConfig.models.length > 0) {
      throw new ModelNotFoundError(resolved_.modelId, resolved_.providerName, providerConfig.models.map((m) => m.id));
    }
    const providerName = resolved_.providerName;
    const modelId = resolved_.modelId;

    this._emit({ type: "routing.resolved", requestId, timestamp: performance.now(), provider: providerName, model: modelId, score: 0, reasons: params.provider ? ["Explicit provider/model"] : ["Router selected"] });

    if (!params.output) {
      const messages = this._normalizeMessages(params.messages);
      const estimatedCost = this._budgetTracker.estimate(
        modelId,
        providerName,
        this._estimateTokens(messages.map((m) => m.content ?? "").join("")),
        0,
      );
      return this._requestPipeline.runComplete({
        requestId,
        startTime,
        provider: providerName,
        model: modelId,
        messages,
        params: {
          model: modelId,
          messages,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          tools: params.tools,
          extra: params.extra,
        },
        estimatedCost,
        policy: params.policy,
        providerTimeoutMs: providerConfig.timeout,
        callerSignal: params.signal,
        fallbackCandidates: (excludeModels) => this._getFallbacks(excludeModels, params),
        estimateFallbackCost: (candidate) => this._budgetTracker.estimate(
          candidate.model,
          candidate.provider,
          this._estimateTokens(messages.map((m) => m.content ?? "").join("")),
          0,
        ),
        getProviderTimeout: (provider) => this._registry.get(provider)?.timeout,
      }) as Promise<T>;
    }

    const adapter = this._getAdapter(providerName);
    // v0.10.0 PR-4: extract the duplicated policy/circuit-breaker/retry/signal
    // setup into _prepareRequest so stream() and complete() share it.
    const { resolved, circuitBreaker, retryConfig, signal } = this._prepareRequest(
      requestId,
      providerName,
      providerConfig,
      params.policy,
      params.signal,
      "complete",
    );

    const messages = this._normalizeMessages(params.messages);

    // v3.0.0: Plugin onRequest hook
    await this._plugins.fireRequest({
      requestId,
      provider: providerName,
      model: modelId,
      messages,
      extra: params.extra,
      signal: params.signal,
      timestamp: startTime,
    });

    // Structured output setup
    const outputConfig = params.output;
    let structuredMessages = [...messages];
    let structuredExtra = { ...params.extra };

    if (outputConfig) {
      // Add JSON mode params for the provider
      const jsonModeParams = buildJsonModeParams(adapter.id);
      structuredExtra = { ...structuredExtra, ...jsonModeParams };

      // Add system instruction for JSON output
      structuredMessages = [
        { role: "system", content: buildJsonSystemInstruction(outputConfig.schema as never) },
        ...messages,
      ];
    }

    const maxRepairAttempts = outputConfig?.maxRepairAttempts ?? 2;

    // Budget: atomic reserve before execution
    const estimatedCost = this._budgetTracker.estimate(modelId, providerName, this._estimateTokens(messages.map((m) => m.content ?? "").join("")), 0);
    const reservation = this._budgetTracker.reserve(requestId, estimatedCost);
    if (!reservation) {
      throw new ConfigurationError(
        `Budget reservation rejected — estimated cost $${estimatedCost.toFixed(4)} would exceed budget`,
        `Remaining budget: $${this._budgetTracker.report().remainingBudget?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
      );
    }

    try {
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

        // If no structured output, settle and return
        if (!outputConfig) {
          this._budgetTracker.settle(requestId, estimatedCost, { provider: providerName, model: modelId, phase: "execute" });
          this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, structuredOutput: false });
          // v3.0.0: Plugin onResponse hook
          await this._plugins.fireResponse({ requestId, provider: providerName, model: modelId, durationMs: performance.now() - startTime, streaming: false });
          return result as T;
        }

        // Validate structured output
        const json = extractJson(result);
        const parsed = JSON.parse(json);
        const validation = outputConfig.schema.safeParse(parsed);
        if (validation.success) {
          this._budgetTracker.settle(requestId, estimatedCost, { provider: providerName, model: modelId, phase: "execute" });
          this._emit({ type: "structured.validate.pass", requestId, timestamp: performance.now() });
          this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, structuredOutput: true });
          // v3.0.0: Plugin onResponse hook
          await this._plugins.fireResponse({ requestId, provider: providerName, model: modelId, durationMs: performance.now() - startTime, streaming: false });
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
        throw new ValidationError(maxRepairAttempts + 1, validation.error, result, { requestId, model: modelId });
      } catch (err: unknown) {
        // Don't retry validation errors through the retry loop
        if (err instanceof ValidationError) {
          throw err;
        }

        if (params.signal?.aborted) {
          circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
          this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
          await this._plugins.fireError({ requestId, provider: providerName, model: modelId, error: err instanceof Error ? err : new Error(String(err)), durationMs: performance.now() - startTime, attempts: attempt + 1 });
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
          this._budgetTracker.release(requestId); // Release original reservation
          const fallbacks = this._getFallbacks([modelId], params);
          for (const fb of fallbacks) {
            const fbEstimatedCost = this._budgetTracker.estimate(fb.model, fb.provider, this._estimateTokens(messages.map((m) => m.content ?? "").join("")), 0);
            const fbReservation = this._budgetTracker.reserve(`${requestId}_fb_${fb.model}`, fbEstimatedCost);
            if (!fbReservation) continue; // Budget exceeded — skip this fallback
            try {
              const fbAdapter = this._getAdapter(fb.provider);
              const result = await fbAdapter.complete({ model: fb.model, messages: structuredMessages, temperature: params.temperature, maxTokens: params.maxTokens, tools: params.tools, extra: structuredExtra, signal });
              this._budgetTracker.settle(`${requestId}_fb_${fb.model}`, fbEstimatedCost, { provider: fb.provider, model: fb.model, phase: "fallback" });
              this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: fb.provider, model: fb.model, durationMs: performance.now() - startTime, attempts: attempt + 2, structuredOutput: !!outputConfig });
              if (!outputConfig) return result as T;
              const json = extractJson(result);
              const parsed = JSON.parse(json);
              const validation = outputConfig.schema.safeParse(parsed);
              if (validation.success) return validation.data;
              throw new ValidationError(maxRepairAttempts + 1, validation.error, result, { requestId, model: fb.model });
            } catch {
              this._budgetTracker.release(`${requestId}_fb_${fb.model}`);
            }
          }
        }

        // Release reservation on final failure
        this._budgetTracker.release(requestId);
        circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
        this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: err instanceof Error ? err.message : String(err) });
        // v3.0.0: Plugin onError hook
        await this._plugins.fireError({ requestId, provider: providerName, model: modelId, error: err instanceof Error ? err : new Error(String(err)), durationMs: performance.now() - startTime, attempts: attempt + 1 });
        throw err;
      }
      }
    } finally {
      // Validation failures and every other terminal path must not strand an
      // active reservation. Settled reservations are unaffected.
      this._budgetTracker.release(requestId);
    }
  }

  // ─── Multi-Modal Reliability Pipeline ──────────────────────────────────

  /**
   * Run a multi-modal adapter method with retry, circuit breaker, timeout,
   * and hook events — the same reliability guarantees as stream()/complete().
   */
  private async _runMultiModal<T>(
    requestId: string,
    providerName: string,
    modelId: string,
    _operation: string,
    fn: (signal: AbortSignal | undefined) => Promise<T>,
    userSignal: AbortSignal | undefined,
  ): Promise<T> {
    const startTime = performance.now();
    this._emit({ type: "request.start", requestId, timestamp: startTime, provider: providerName, model: modelId });

    const providerConfig = this._registry.get(providerName);
    const { resolved, circuitBreaker, retryConfig, signal } = this._prepareRequest(
      requestId, providerName, providerConfig ?? { name: providerName, baseUrl: "", authentication: { type: "none" }, adapter: "openai-compatible" } as ProviderConfig, undefined, userSignal,
    );

    let lastError: Error | undefined;
    const maxAttempts = resolved.retry.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await fn(signal);
        circuitBreaker?.recordSuccess();
        this._emit({ type: "request.completed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, structuredOutput: false });
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number }).status ?? 0;
        const retryable = (status > 0 && shouldRetry(status, attempt, retryConfig)) || shouldRetryNetworkError(attempt, retryConfig);
        circuitBreaker?.recordFailure(lastError);

        if (retryable && attempt < maxAttempts - 1) {
          const delay = calculateBackoff(attempt, resolved.backoff);
          this._emit({ type: "request.retrying", requestId, timestamp: performance.now(), provider: providerName, attempt, delayMs: delay, reason: lastError.message });
          await sleep(delay);
          continue;
        }

        this._emit({ type: "request.failed", requestId, timestamp: performance.now(), provider: providerName, model: modelId, durationMs: performance.now() - startTime, attempts: attempt + 1, error: lastError.message });
        throw lastError;
      }
    }

    throw lastError!;
  }

  // ─── Multi-Modal: Embeddings ──────────────────────────────────────────

  async embed(params: {
    provider: string;
    model: string;
    input: string | string[];
    dimensions?: number;
    signal?: AbortSignal;
  }): Promise<EmbeddingResult> {
    const adapter = this._getAdapter(params.provider);
    if (!adapter.embed) {
      throw new ConfigurationError(
        `Provider "${params.provider}" does not support embeddings`,
        `Providers supporting embeddings: openai, voyageai, cohere, huggingface, google-vertex, google-genai`,
      );
    }
    const requestId = this._nextRequestId();
    return this._runMultiModal(requestId, params.provider, params.model, "embed", (signal) =>
      adapter.embed!({ model: params.model, input: params.input, dimensions: params.dimensions, signal }),
    params.signal);
  }

  // ─── Multi-Modal: Image Generation ────────────────────────────────────

  async generateImage(params: {
    provider: string;
    model: string;
    prompt: string;
    n?: number;
    size?: import("../types/multi-modal.js").ImageSize;
    quality?: import("../types/multi-modal.js").ImageQuality;
    style?: import("../types/multi-modal.js").ImageStyle;
    responseFormat?: "url" | "b64_json";
    signal?: AbortSignal;
  }): Promise<ImageResult> {
    const adapter = this._getAdapter(params.provider);
    if (!adapter.generateImage) {
      throw new ConfigurationError(
        `Provider "${params.provider}" does not support image generation`,
        `Providers supporting image generation: openai (DALL-E), google-genai, stability-ai`,
      );
    }
    const requestId = this._nextRequestId();
    return this._runMultiModal(requestId, params.provider, params.model, "generateImage", (signal) =>
      adapter.generateImage!({
        model: params.model, prompt: params.prompt, n: params.n, size: params.size,
        quality: params.quality, style: params.style, responseFormat: params.responseFormat, signal,
      }),
    params.signal);
  }

  // ─── Multi-Modal: Speech Synthesis ────────────────────────────────────

  async generateSpeech(params: {
    provider: string;
    model: string;
    input: string;
    voice: import("../types/multi-modal.js").SpeechVoice;
    responseFormat?: import("../types/multi-modal.js").SpeechFormat;
    speed?: number;
    signal?: AbortSignal;
  }): Promise<SpeechResult> {
    const adapter = this._getAdapter(params.provider);
    if (!adapter.generateSpeech) {
      throw new ConfigurationError(
        `Provider "${params.provider}" does not support speech synthesis`,
        `Providers supporting speech synthesis: openai (TTS), elevenlabs`,
      );
    }
    const requestId = this._nextRequestId();
    return this._runMultiModal(requestId, params.provider, params.model, "generateSpeech", (signal) =>
      adapter.generateSpeech!({
        model: params.model, input: params.input, voice: params.voice,
        responseFormat: params.responseFormat, speed: params.speed, signal,
      }),
    params.signal);
  }

  // ─── Multi-Modal: Transcription ───────────────────────────────────────

  async transcribe(params: {
    provider: string;
    model: string;
    file: File | Blob | Uint8Array;
    language?: import("../types/multi-modal.js").TranscriptLanguage;
    prompt?: string;
    responseFormat?: import("../types/multi-modal.js").TranscriptFormat;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<TranscriptionResult> {
    const adapter = this._getAdapter(params.provider);
    if (!adapter.transcribe) {
      throw new ConfigurationError(
        `Provider "${params.provider}" does not support transcription`,
        `Providers supporting transcription: openai (Whisper), deepgram, google-genai, elevenlabs`,
      );
    }
    const requestId = this._nextRequestId();
    return this._runMultiModal(requestId, params.provider, params.model, "transcribe", (signal) =>
      adapter.transcribe!({
        model: params.model, file: params.file, language: params.language,
        prompt: params.prompt, responseFormat: params.responseFormat,
        temperature: params.temperature, signal,
      }),
    params.signal);
  }

  // ─── Multi-Modal: Reranking ───────────────────────────────────────────

  async rerank(params: {
    provider: string;
    model: string;
    query: string;
    documents: string[];
    topN?: number;
    signal?: AbortSignal;
  }): Promise<RerankResult> {
    const adapter = this._getAdapter(params.provider);
    if (!adapter.rerank) {
      throw new ConfigurationError(
        `Provider "${params.provider}" does not support reranking`,
        `Providers supporting reranking: cohere, voyageai`,
      );
    }
    const requestId = this._nextRequestId();
    return this._runMultiModal(requestId, params.provider, params.model, "rerank", (signal) =>
      adapter.rerank!({ model: params.model, query: params.query, documents: params.documents, topN: params.topN, signal }),
    params.signal);
  }

  // ─── High-Level: streamText with Multi-Step Tool Calling ──────────────

  /**
   * Stream text with automatic multi-step tool calling.
   * Loops through tool calls until the model stops calling tools or maxSteps is reached.
   *
   * @example
   * ```ts
   * for await (const event of client.streamText({
   *   provider: "OpenAI", model: "gpt-4o",
   *   messages: [{ role: "user", content: "What's the weather?" }],
   *   tools: [{ type: "function", function: { name: "getWeather", ... } }],
   *   maxSteps: 5,
   *   onStepFinish: (step) => console.log(`Step ${step.step}: ${step.toolCalls.length} tool calls`),
   * })) {
   *   if (event.type === "text") process.stdout.write(event.text);
   * }
   * ```
   */
  async *streamText(params: {
    provider?: string;
    model?: string;
    messages: Array<Record<string, unknown> | Message>;
    temperature?: number;
    maxTokens?: number;
    tools?: Tool[];
    extra?: Record<string, unknown>;
    signal?: AbortSignal;
    policy?: ExecutionPolicy;
    task?: string;
    needsVision?: boolean;
    needsTools?: boolean;
    needsReasoning?: boolean;
    maxSteps?: number;
    toolExecution?: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
    onStepFinish?: (step: { step: number; text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>; usage?: { promptTokens: number; completionTokens: number } }) => void;
  }): AsyncGenerator<StreamChunk> {
    const maxSteps = params.maxSteps ?? 1;
    const messages = this._normalizeMessages(params.messages);
    const allowedToolNames = new Set((params.tools ?? []).map((tool) => tool.function.name));
    let currentMessages = [...messages];

    for (let step = 0; step < maxSteps; step++) {
      let stepText = "";
      const stepToolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = [];
      let stepUsage: { promptTokens: number; completionTokens: number } | undefined;

      // Accumulate tool call arguments across incremental deltas (keyed by index)
      const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of this.stream({
        ...params,
        messages: currentMessages,
      })) {
        if (chunk.type === "text") {
          stepText += chunk.text;
          yield chunk;
        } else if (chunk.type === "tool_call") {
          const idx = chunk.index ?? 0;

          // Accumulate incremental argument deltas
          if (!pendingToolCalls.has(idx)) {
            pendingToolCalls.set(idx, {
              id: chunk.id,
              name: chunk.name ?? "unknown",
              arguments: "",
            });
          }
          const pending = pendingToolCalls.get(idx)!;
          if (chunk.name) pending.name = chunk.name;
          if (chunk.argumentsDelta) pending.arguments += chunk.argumentsDelta;

          // Only finalize when done=true, or if done field is absent (backwards compat: treat as complete)
          if (chunk.done === true || chunk.done === undefined) {
            let parsedArgs: Record<string, unknown>;
            let argumentError: string | undefined;
            try {
              const parsed = JSON.parse(pending.arguments || "{}");
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Tool arguments must be an object");
              }
              parsedArgs = parsed as Record<string, unknown>;
            } catch (err) {
              argumentError = err instanceof Error ? err.message : String(err);
              parsedArgs = {};
            }

            const toolCall = { name: pending.name, args: parsedArgs, result: undefined as unknown };
            stepToolCalls.push(toolCall);

            if (argumentError) {
              toolCall.result = { error: argumentError };
              yield { type: "error", message: `Invalid arguments for tool ${pending.name}: ${argumentError}`, retryable: false };
            } else if (!allowedToolNames.has(pending.name)) {
              const message = `Tool ${pending.name} is not in the configured allowlist`;
              toolCall.result = { error: message };
              yield { type: "error", message, retryable: false };
            } else if (params.toolExecution) {
              try {
                toolCall.result = await params.toolExecution(pending.name, parsedArgs);
              } catch (err) {
                toolCall.result = { error: (err as Error).message };
              }
            }

            pendingToolCalls.delete(idx);
          }
        } else if (chunk.type === "usage") {
          stepUsage = { promptTokens: chunk.inputTokens ?? 0, completionTokens: chunk.outputTokens ?? 0 };
        } else {
          yield chunk;
        }
      }

      // Flush any remaining pending tool calls (stream ended without done=true)
      for (const [, tc] of pendingToolCalls) {
        let parsedArgs: Record<string, unknown>;
        let argumentError: string | undefined;
        try {
          const parsed = JSON.parse(tc.arguments || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Tool arguments must be an object");
          }
          parsedArgs = parsed as Record<string, unknown>;
        } catch (err) {
          argumentError = err instanceof Error ? err.message : String(err);
          parsedArgs = {};
        }
        const toolCall = { name: tc.name, args: parsedArgs, result: undefined as unknown };
        stepToolCalls.push(toolCall);
        if (argumentError) {
          toolCall.result = { error: argumentError };
          yield { type: "error", message: `Invalid arguments for tool ${tc.name}: ${argumentError}`, retryable: false };
        } else if (!allowedToolNames.has(tc.name)) {
          const message = `Tool ${tc.name} is not in the configured allowlist`;
          toolCall.result = { error: message };
          yield { type: "error", message, retryable: false };
        } else if (params.toolExecution) {
          try {
            toolCall.result = await params.toolExecution(tc.name, parsedArgs);
          } catch (err) {
            toolCall.result = { error: (err as Error).message };
          }
        }
      }

      params.onStepFinish?.({ step, text: stepText, toolCalls: stepToolCalls, usage: stepUsage });

      // If no tool calls, we're done
      if (stepToolCalls.length === 0) return;

      // Build next messages with tool results
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: stepText, tool_calls: stepToolCalls.map((tc, i) => ({
          id: `call_${step}_${i}`,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })) },
      ];

      for (const tc of stepToolCalls) {
        const resultStr = tc.result !== undefined ? JSON.stringify(tc.result) : "No result";
        currentMessages.push({ role: "tool" as const, content: resultStr, tool_call_id: `call_${step}_${stepToolCalls.indexOf(tc)}` });
      }
    }
  }

  // ─── High-Level: streamObject (Streaming Structured Output) ───────────

  /**
   * Stream a structured object with progressive JSON rendering.
   * Yields partial object chunks as they are parsed from the stream.
   * Supports both raw JSON Schema objects and SchemaValidator<T> (Zod/Valibot).
   *
   * @example
   * ```ts
   * import { z } from "zod";
   * for await (const event of client.streamObject({
   *   provider: "OpenAI", model: "gpt-4o",
   *   messages: [{ role: "user", content: "Describe a cat" }],
   *   schema: z.object({ name: z.string(), traits: z.array(z.string()) }),
   * })) {
   *   if (event.type === "object_delta") console.log(event.partialObject);
   * }
   * ```
   */
  async *streamObject<T>(
    params: StreamObjectOptions<T> & {
      messages: Array<Record<string, unknown> | Message>;
      schema: Record<string, unknown> | SchemaValidator<T>;
    },
  ): AsyncGenerator<{ type: "object_delta"; partialObject: Partial<T> } | StreamChunk> {
    const { onPartialObject, onFinalObject, ...streamParams } = params;

    // Detect if schema is a SchemaValidator (has safeParse) or raw JSON Schema
    const isValidator = (s: Record<string, unknown> | SchemaValidator<T>): s is SchemaValidator<T> =>
      typeof s === "object" && s !== null && "safeParse" in s;

    const schemaValidator = isValidator(params.schema) ? params.schema : undefined;
    const rawSchema = schemaValidator
      ? undefined
      : (params.schema as Record<string, unknown>);

    // Build schema description for the system prompt
    const schemaDescription = schemaValidator
      ? JSON.stringify(
          // Try to extract JSON Schema from Zod/Valibot via .toJsonSchema() if available
          typeof (schemaValidator as unknown as Record<string, unknown>).toJsonSchema === "function"
            ? (schemaValidator as unknown as { toJsonSchema: () => Record<string, unknown> }).toJsonSchema()
            : { description: "See schema parameter for details" },
        )
      : JSON.stringify(rawSchema);

    // Build system instruction using the structured output utility
    const { buildJsonSystemInstruction, extractJson } = await import("../output/structured.js");
    const jsonInstruction = buildJsonSystemInstruction(schemaDescription);

    const messages: Message[] = [
      { role: "system", content: jsonInstruction },
      ...this._normalizeMessages(params.messages),
    ];

    // Build JSON mode params based on the first provider's adapter
    let jsonModeExtra: Record<string, unknown> = {};
    if (params.provider) {
      const providerConfig = this._registry.get(params.provider);
      if (providerConfig?.adapter) {
        const { buildJsonModeParams } = await import("../output/structured.js");
        jsonModeExtra = buildJsonModeParams(providerConfig.adapter);
      }
    }

    let accumulatedText = "";

    for await (const chunk of this.stream({
      ...streamParams,
      messages,
      extra: {
        ...params.extra,
        ...jsonModeExtra,
      },
    })) {
      if (chunk.type === "text") {
        accumulatedText += chunk.text;

        // Extract JSON from the accumulated text
        const extracted = extractJson(accumulatedText);

        try {
          const partial = JSON.parse(extracted) as Partial<T>;

          // If we have a validator, validate partial objects (best-effort)
          if (schemaValidator) {
            const result = schemaValidator.safeParse(partial);
            if (result.success) {
              onPartialObject?.(result.data as Partial<T>);
              yield { type: "object_delta", partialObject: result.data as Partial<T> };
            } else {
              // Partial not yet valid — yield what we have, skip validation
              onPartialObject?.(partial);
              yield { type: "object_delta", partialObject: partial };
            }
          } else {
            onPartialObject?.(partial);
            yield { type: "object_delta", partialObject: partial };
          }
        } catch {
          // JSON not parseable yet — yield empty partial
          yield { type: "object_delta", partialObject: {} as Partial<T> };
        }
      } else if (chunk.type === "finish") {
        // Final validation of complete object
        const extracted = extractJson(accumulatedText);
        const { ValidationError: VError } = await import("../errors/index.js");
        try {
          const finalObject = JSON.parse(extracted) as T;
          if (schemaValidator) {
            const result = schemaValidator.safeParse(finalObject);
            if (result.success) {
              onFinalObject?.(result.data);
            } else {
              // v2.4.0 BUG-04: throw ValidationError instead of silently dropping
              throw new VError(1, result.error, accumulatedText);
            }
          } else {
            onFinalObject?.(finalObject);
          }
        } catch (err) {
          // Re-throw ValidationError; swallow only JSON parse errors (incomplete stream)
          if (err instanceof VError) throw err;
          // Final parse failed (incomplete JSON) — the stream still completes
        }
        yield chunk;
      } else {
        yield chunk;
      }
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    // v3.0.0: Destroy all plugins before transport cleanup
    await this._plugins.destroyAll();
    // v2.4.0: Call destroy() when available to clear timers and pooled
    // connections; fall back to abort() for basic transports.
    if (typeof this._transport.destroy === "function") {
      this._transport.destroy();
    } else {
      this._transport.abort();
    }
    this._adapters.clear();
    this._registry.clear();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}
