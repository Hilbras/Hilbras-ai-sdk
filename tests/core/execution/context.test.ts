import { describe, expect, it } from "vitest";
import type { ResolvedPolicy } from "../../../src/types/policy.js";
import { createRequestContext, deriveRequestContext, toTelemetryContext } from "../../../src/core/execution/request-context.js";
import { executionFailure, executionSuccess } from "../../../src/core/execution/execution-result.js";

const policy: ResolvedPolicy = {
  allowFallback: true,
  maxFallbackCost: 0.25,
  retry: { maxRetries: 2, retryableStatuses: new Set([429, 503]), retryableNetworkErrors: true },
  backoff: { baseDelayMs: 10, maxDelayMs: 100, jitter: 0 },
  timeout: { requestTimeoutMs: 1_000 },
  circuitBreaker: { enabled: true, failureThreshold: 3, successThreshold: 1, timeoutMs: 100, halfOpenMaxCalls: 1 },
};

describe("v3.2 execution contracts", () => {
  it("creates a request context with separate caller and execution signals", () => {
    const callerSignal = new AbortController().signal;
    const executionSignal = new AbortController().signal;
    const context = createRequestContext({
      requestId: "req_1",
      operation: "complete",
      provider: "test",
      model: "model",
      policy,
      budget: { sessionBudget: 2 },
      callerSignal,
      executionSignal,
      metadata: { tenant: "acme" },
    });

    expect(context.requestId).toBe("req_1");
    expect(context.callerSignal).toBe(callerSignal);
    expect(context.executionSignal).toBe(executionSignal);
    expect(context.retry).toBe(policy.retry);
    expect(context.timeout).toBe(policy.timeout);
    expect(context.metadata).toEqual({ tenant: "acme" });
  });

  it("derives an attempt context without mutating the logical request", () => {
    const original = createRequestContext({
      requestId: "req_2",
      operation: "stream",
      provider: "test",
      model: "model",
      policy,
    });
    const derived = deriveRequestContext(original, {
      attempt: 1,
      phase: "fallback",
      provider: "fallback",
      model: "fallback-model",
    });

    expect(derived.attempt).toBe(1);
    expect(derived.phase).toBe("fallback");
    expect(derived.provider).toBe("fallback");
    expect(original.attempt).toBe(0);
    expect(original.phase).toBe("primary");
    expect(original.provider).toBe("test");
  });

  it("retains the original error and value in execution results", () => {
    const context = createRequestContext({
      requestId: "req_3",
      operation: "complete",
      provider: "test",
      model: "model",
      policy,
    });
    const error = new Error("provider failed");
    const success = executionSuccess("result", context);
    const failure = executionFailure(error, context);

    expect(success.ok).toBe(true);
    if (success.ok) expect(success.value).toBe("result");
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error).toBe(error);
  });

  it("exposes a minimal telemetry-safe context projection", () => {
    const context = createRequestContext({
      requestId: "req_4",
      operation: "stream",
      provider: "test",
      model: "model",
      policy,
      metadata: { secret: "do-not-emit" },
    });

    expect(toTelemetryContext(context)).toEqual({
      requestId: "req_4",
      operation: "stream",
      provider: "test",
      model: "model",
      attempt: 0,
      phase: "primary",
    });
  });
});
