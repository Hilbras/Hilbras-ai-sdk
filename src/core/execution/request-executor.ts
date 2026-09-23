/**
 * One-attempt execution boundary for the internal execution subsystem.
 *
 * Retry, fallback, and logical-request budget ownership are intentionally left
 * to RequestPipeline. This class owns preparation and one provider attempt.
 */

import { CircuitBreakerOpenError, ProviderNotFoundError } from "../../errors/index.js";
import { createRetryConfig, type RetryConfig } from "../../reliability/retry.js";
import { createScopedTimeout, type ScopedTimeout } from "../../reliability/timeout.js";
import type { ExecutionPolicy } from "../../types/policy.js";
import type { RoutingResult } from "../../types/router.js";
import type { GenerateParams } from "../../types/adapter.js";
import { createRequestContext, type RequestContext, type RequestOperation } from "./request-context.js";
import { executionFailure, executionSuccess, type ExecutionResult } from "./execution-result.js";
import type { CircuitBreakerPort, ExecutionPorts } from "./ports.js";
import type { BudgetConfig } from "../../cost/types.js";

export interface RequestPreparationInput {
  requestId: string;
  operation: RequestOperation;
  provider: string;
  model: string;
  policy?: ExecutionPolicy;
  providerTimeoutMs?: number;
  budget?: BudgetConfig;
  callerSignal?: AbortSignal;
  routing?: RoutingResult;
  metadata?: Record<string, unknown>;
}

export interface PreparedRequest {
  context: RequestContext;
  retryConfig: RetryConfig;
  circuitBreaker?: CircuitBreakerPort;
  signal?: AbortSignal;
  timeout?: ScopedTimeout;
  dispose(): void;
}

export class RequestExecutor {
  constructor(private readonly ports: ExecutionPorts) {}

  prepare(input: RequestPreparationInput): PreparedRequest {
    const resolved = this.ports.policy.resolve(input.policy);
    const context = createRequestContext({
      requestId: input.requestId,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      policy: resolved,
      budget: input.budget,
      callerSignal: input.callerSignal,
      routing: input.routing,
      metadata: input.metadata,
    });

    let circuitBreaker: CircuitBreakerPort | undefined;
    if (resolved.circuitBreaker.enabled) {
      circuitBreaker = this.ports.circuitBreakers.getOrCreate(input.provider, resolved.circuitBreaker);
      if (!circuitBreaker.isAvailable()) {
        throw new CircuitBreakerOpenError(input.provider, {
          failureCount: circuitBreaker.stats.failureCount,
          retryAfterMs: resolved.circuitBreaker.timeoutMs,
        });
      }
    }

    const timeoutMs = resolved.timeout.requestTimeoutMs || input.providerTimeoutMs || 0;
    const timeout = timeoutMs > 0
      ? createScopedTimeout({ requestTimeoutMs: timeoutMs }, input.callerSignal)
      : undefined;
    const retryConfig = createRetryConfig({
      maxRetries: resolved.retry.maxRetries,
      retryableStatuses: resolved.retry.retryableStatuses,
      retryableNetworkErrors: resolved.retry.retryableNetworkErrors,
    });

    return {
      context,
      retryConfig,
      circuitBreaker,
      signal: timeout?.signal ?? input.callerSignal,
      timeout,
      dispose: () => timeout?.cancel(),
    };
  }

  async executeComplete(
    prepared: PreparedRequest,
    params: Omit<GenerateParams, "signal">,
    options: { dispose?: boolean } = {},
  ): Promise<ExecutionResult<string>> {
    if (prepared.context.callerSignal?.aborted) {
      return executionFailure(new DOMException("The operation was aborted", "AbortError"), prepared.context);
    }

    const adapter = this.ports.adapters.get(prepared.context.provider);
    if (!adapter) {
      return executionFailure(
        new ProviderNotFoundError(prepared.context.provider),
        prepared.context,
      );
    }

    try {
      const value = await adapter.complete({ ...params, signal: prepared.signal });
      prepared.circuitBreaker?.recordSuccess();
      return executionSuccess(value, prepared.context);
    } catch (error) {
      if (!prepared.context.callerSignal?.aborted) {
        prepared.circuitBreaker?.recordFailure(error instanceof Error ? error : undefined);
      }
      return executionFailure(error, prepared.context);
    } finally {
      if (options.dispose !== false) prepared.dispose();
    }
  }
}
