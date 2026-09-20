/**
 * @hilbras/sdk — RequestPipeline (v0.10.0 PR-4)
 *
 * The shared reliability lifecycle for a *single attempt*. Used by
 * `HilbrasClient.stream()` and `HilbrasClient.complete()`.
 *
 * Before PR-4, both methods had near-duplicate code for: provider
 * resolution, circuit-breaker check, retry config, timeout signal,
 * budget reservation, budget settle/release, and request.completed /
 * request.failed event emission. The pipeline extracts those concerns
 * for a single attempt. The retry loop and fallback loop stay in the
 * client (where the per-stream consumption semantics live), but they
 * now call `pipeline.runOnce(...)` for each attempt — so a single
 * attempt is one place in the code, not two.
 *
 * Internal-only: not exported from `src/index.ts`.
 */

import { ConfigurationError, CircuitBreakerOpenError } from "../errors/index.js";
import type { AIProvider } from "../types/adapter.js";
import type { HookEvent } from "../types/observability.js";
import type { Message } from "../types/messages.js";
import type { StreamChunk } from "../types/streams.js";
import type { ResolvedPolicy } from "../types/policy.js";
import type { ProviderConfig } from "../types/providers.js";
import type { ExecutionPolicy } from "../types/policy.js";
import { resolvePolicy } from "../reliability/presets.js";
import { getCircuitBreakerRegistry, type CircuitBreaker } from "../reliability/circuit-breaker.js";
import { createRetryConfig } from "../reliability/retry.js";
import { createTimeoutSignal } from "../reliability/timeout.js";
import type { BudgetTracker } from "../cost/tracker.js";
import { estimateTokens } from "../tokens/counter.js";

/** Per-attempt result for a streaming run. */
export interface StreamAttemptResult {
  /** Total input tokens reported by the usage chunk, if any. */
  inputTokens?: number;
  /** Total output tokens reported by the usage chunk, if any. */
  outputTokens?: number;
}

/** Streaming executor signature. */
export type StreamExecutor = (args: {
  signal: AbortSignal | undefined;
  providerName: string;
  modelId: string;
  messages: Message[];
  temperature: number | undefined;
  maxTokens: number | undefined;
  tools: import("../types/tools.js").Tool[] | undefined;
  extra: Record<string, unknown> | undefined;
}) => Promise<{ chunks: AsyncGenerator<StreamChunk>; result: StreamAttemptResult }>;

/** Non-streaming executor signature. */
export type CompleteExecutor<T> = (args: {
  signal: AbortSignal | undefined;
  providerName: string;
  modelId: string;
  messages: Message[];
  temperature: number | undefined;
  maxTokens: number | undefined;
  tools: import("../types/tools.js").Tool[] | undefined;
  extra: Record<string, unknown> | undefined;
}) => Promise<T>;

/** Result of a successful streaming run. */
export interface PipelineStreamSuccess {
  ok: true;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
  providerName: string;
  modelId: string;
}

/** A streaming-executor error that the host should classify (retry/fallback). */
export interface PipelineStreamFailure {
  ok: false;
  err: unknown;
}

export type PipelineStreamResult = PipelineStreamSuccess | PipelineStreamFailure;

/** Same shape for non-streaming. */
export type PipelineCompleteResult<T> =
  | { ok: true; attempts: number; value: T; providerName: string; modelId: string }
  | { ok: false; err: unknown };

/** What the pipeline needs from the host to do its job. */
export interface PipelineContext {
  requestId: string;
  startTime: number;
  providerConfig: ProviderConfig;
  modelId: string;
  resolved: ResolvedPolicy;
  adapter: AIProvider;
  circuitBreaker: CircuitBreaker | undefined;
  retryConfig: ReturnType<typeof createRetryConfig>;
  signal: AbortSignal | undefined;
  messages: Message[];
  emit: (event: HookEvent) => void;
  budgetTracker: BudgetTracker;
  /** When true (default), the streaming variant settles the budget on the
   * first usage chunk. When false, the budget is settled at the end-of-stream
   * using the estimated cost. */
  settleOnUsage: boolean;
}

/**
 * Build a `PipelineContext` for a given client request. The host
 * (HilbrasClient.stream / complete) supplies the resolved fields.
 */
export interface BuildContextArgs {
  requestId: string;
  startTime: number;
  providerConfig: ProviderConfig;
  modelId: string;
  policy: ExecutionPolicy | undefined;
  defaultPolicy: ExecutionPolicy | undefined;
  adapter: AIProvider;
  messages: Message[];
  signal: AbortSignal | undefined;
  emit: (event: HookEvent) => void;
  budgetTracker: BudgetTracker;
  settleOnUsage: boolean;
}

export function buildPipelineContext(args: BuildContextArgs): PipelineContext {
  const resolved = resolvePolicy(args.policy ?? args.defaultPolicy);
  let circuitBreaker: CircuitBreaker | undefined;
  if (resolved.circuitBreaker.enabled) {
    circuitBreaker = getCircuitBreakerRegistry().getOrCreate(args.providerConfig.name, {
      failureThreshold: resolved.circuitBreaker.failureThreshold,
      successThreshold: resolved.circuitBreaker.successThreshold,
      timeoutMs: resolved.circuitBreaker.timeoutMs,
      halfOpenMaxCalls: resolved.circuitBreaker.halfOpenMaxCalls,
    });
    if (!circuitBreaker.isAvailable()) {
      args.emit({
        type: "circuit_breaker.open",
        requestId: args.requestId,
        timestamp: performance.now(),
        provider: args.providerConfig.name,
      });
      throw new CircuitBreakerOpenError(args.providerConfig.name, {
        failureCount: circuitBreaker.stats.failureCount,
        retryAfterMs: resolved.circuitBreaker.timeoutMs,
      });
    }
  }
  const retryConfig = createRetryConfig({
    maxRetries: resolved.retry.maxRetries,
    retryableStatuses: resolved.retry.retryableStatuses,
    retryableNetworkErrors: resolved.retry.retryableNetworkErrors,
  });
  const timeoutMs = resolved.timeout.requestTimeoutMs || args.providerConfig.timeout;
  const signal = timeoutMs
    ? createTimeoutSignal({ requestTimeoutMs: timeoutMs }, args.signal)
    : args.signal;

  return {
    requestId: args.requestId,
    startTime: args.startTime,
    providerConfig: args.providerConfig,
    modelId: args.modelId,
    resolved,
    adapter: args.adapter,
    circuitBreaker,
    retryConfig,
    signal,
    messages: args.messages,
    emit: args.emit,
    budgetTracker: args.budgetTracker,
    settleOnUsage: args.settleOnUsage,
  };
}

/**
 * Run a single streaming attempt through the full pipeline (reservation,
 * executor, budget settle, hook emission). Returns a result object the
 * host can use to decide retry/fallback.
 */
export async function runStreamAttempt(
  ctx: PipelineContext,
  executor: StreamExecutor,
  attempt: number,
): Promise<PipelineStreamResult> {
  const { requestId, startTime, providerConfig, modelId, signal, messages, emit, budgetTracker, settleOnUsage } = ctx;
  const estimatedCost = budgetTracker.estimate(
    modelId,
    providerConfig.name,
    estimateTokens(messages.map((m) => m.content ?? "").join("")),
    0,
  );
  const initialReservation = budgetTracker.reserve(requestId, estimatedCost);
  if (!initialReservation) {
    throw new ConfigurationError(
      `Budget reservation rejected — estimated cost $${estimatedCost.toFixed(4)} would exceed budget`,
      `Remaining budget: $${budgetTracker.report().remainingBudget?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
    );
  }

  let reservationActive = true;
  let usageSettled = false;
  let totalIn: number | undefined;
  let totalOut: number | undefined;

  try {
    const { chunks, result } = await executor({
      signal,
      providerName: providerConfig.name,
      modelId,
      messages,
      temperature: undefined,
      maxTokens: undefined,
      tools: undefined,
      extra: undefined,
    });

    for await (const chunk of chunks) {
      if (chunk.type === "usage") {
        const inT = (chunk as { inputTokens?: number }).inputTokens;
        const outT = (chunk as { outputTokens?: number }).outputTokens;
        totalIn = inT;
        totalOut = outT;
        if (reservationActive && !usageSettled && settleOnUsage) {
          const actualCost = budgetTracker.estimate(modelId, providerConfig.name, inT ?? 0, outT ?? 0);
          budgetTracker.settle(requestId, actualCost, { provider: providerConfig.name, model: modelId, phase: "execute" });
          reservationActive = false;
          usageSettled = true;
        }
      }
    }
    if (result.inputTokens !== undefined) totalIn = result.inputTokens;
    if (result.outputTokens !== undefined) totalOut = result.outputTokens;

    ctx.circuitBreaker?.recordSuccess();
    if (reservationActive) {
      // No usage chunk arrived; settle at the estimate.
      budgetTracker.settle(requestId, estimatedCost, { provider: providerConfig.name, model: modelId, phase: "execute" });
      reservationActive = false;
    }
    emit({
      type: "request.completed",
      requestId,
      timestamp: performance.now(),
      provider: providerConfig.name,
      model: modelId,
      durationMs: performance.now() - startTime,
      attempts: attempt + 1,
      inputTokens: totalIn,
      outputTokens: totalOut,
      structuredOutput: false,
    });
    return { ok: true, attempts: attempt + 1, inputTokens: totalIn, outputTokens: totalOut, providerName: providerConfig.name, modelId };
  } catch (err) {
    if (reservationActive) {
      budgetTracker.release(requestId);
      reservationActive = false;
    }
    return { ok: false, err };
  } finally {
    // Defensive: in case neither the success nor the catch branch ran
    // (e.g. an exception thrown between them), make sure the reservation
    // is released. Idempotent.
    if (reservationActive) {
      budgetTracker.release(requestId);
      reservationActive = false;
    }
  }
}

/** Run a single non-streaming attempt through the full pipeline. */
export async function runCompleteAttempt<T>(
  ctx: PipelineContext,
  executor: CompleteExecutor<T>,
  attempt: number,
): Promise<PipelineCompleteResult<T>> {
  const { requestId, startTime, providerConfig, modelId, signal, messages, emit, budgetTracker } = ctx;
  const estimatedCost = budgetTracker.estimate(
    modelId,
    providerConfig.name,
    estimateTokens(messages.map((m) => m.content ?? "").join("")),
    0,
  );
  const initialReservation = budgetTracker.reserve(requestId, estimatedCost);
  if (!initialReservation) {
    throw new ConfigurationError(
      `Budget reservation rejected — estimated cost $${estimatedCost.toFixed(4)} would exceed budget`,
      `Remaining budget: $${budgetTracker.report().remainingBudget?.toFixed(4) ?? "unknown"}. Options: (1) increase sessionBudget, (2) use a cheaper model, (3) reduce input token count`,
    );
  }

  let reservationActive = true;
  try {
    const value = await executor({
      signal,
      providerName: providerConfig.name,
      modelId,
      messages,
      temperature: undefined,
      maxTokens: undefined,
      tools: undefined,
      extra: undefined,
    });
    ctx.circuitBreaker?.recordSuccess();
    if (reservationActive) {
      budgetTracker.settle(requestId, estimatedCost, { provider: providerConfig.name, model: modelId, phase: "execute" });
      reservationActive = false;
    }
    emit({
      type: "request.completed",
      requestId,
      timestamp: performance.now(),
      provider: providerConfig.name,
      model: modelId,
      durationMs: performance.now() - startTime,
      attempts: attempt + 1,
      inputTokens: undefined,
      outputTokens: undefined,
      structuredOutput: false,
    });
    return { ok: true, attempts: attempt + 1, value, providerName: providerConfig.name, modelId };
  } catch (err) {
    if (reservationActive) {
      budgetTracker.release(requestId);
      reservationActive = false;
    }
    return { ok: false, err };
  } finally {
    if (reservationActive) {
      budgetTracker.release(requestId);
      reservationActive = false;
    }
  }
}

/** Record a final-failure event for a request that exhausted retries and fallbacks. */
export function recordFailure(
  ctx: PipelineContext,
  err: unknown,
  attempt: number,
): void {
  const { requestId, startTime, providerConfig, modelId, emit } = ctx;
  ctx.circuitBreaker?.recordFailure(err instanceof Error ? err : undefined);
  emit({
    type: "request.failed",
    requestId,
    timestamp: performance.now(),
    provider: providerConfig.name,
    model: modelId,
    durationMs: performance.now() - startTime,
    attempts: attempt + 1,
    error: err instanceof Error ? err.message : String(err),
  });
}
