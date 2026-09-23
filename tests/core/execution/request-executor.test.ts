import { describe, expect, it, vi } from "vitest";
import { RequestExecutor } from "../../../src/core/execution/request-executor.js";
import type { ResolvedPolicy } from "../../../src/types/policy.js";
import type { Message } from "../../../src/types/messages.js";

const policy: ResolvedPolicy = {
  allowFallback: false,
  maxFallbackCost: null,
  retry: { maxRetries: 0, retryableStatuses: new Set(), retryableNetworkErrors: false },
  backoff: { baseDelayMs: 1, maxDelayMs: 1, jitter: 0 },
  timeout: { requestTimeoutMs: 0 },
  circuitBreaker: { enabled: true, failureThreshold: 2, successThreshold: 1, timeoutMs: 10, halfOpenMaxCalls: 1 },
};

const messages: Message[] = [{ role: "user", content: "hello" }];

function makeExecutor(overrides: Partial<{
  complete: (params: { signal?: AbortSignal }) => Promise<string>;
  available: boolean;
}> = {}) {
  const circuit = {
    stats: { failureCount: 0 },
    isAvailable: vi.fn(() => overrides.available ?? true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const adapter = {
    id: "test-adapter",
    complete: vi.fn(overrides.complete ?? (async () => "ok")),
    stream: vi.fn(),
  };
  const executor = new RequestExecutor({
    policy: { resolve: () => policy },
    circuitBreakers: { getOrCreate: () => circuit },
    adapters: { get: () => adapter },
  });
  return { executor, circuit, adapter };
}

describe("RequestExecutor", () => {
  it("prepares policy, circuit, and request context without client dependencies", () => {
    const { executor } = makeExecutor();
    const prepared = executor.prepare({
      requestId: "req_1",
      operation: "complete",
      provider: "test",
      model: "model",
      policy: {},
      metadata: { tenant: "acme" },
    });

    expect(prepared.context.requestId).toBe("req_1");
    expect(prepared.context.operation).toBe("complete");
    expect(prepared.context.provider).toBe("test");
    expect(prepared.retryConfig.maxRetries).toBe(0);
    expect(prepared.circuitBreaker).toBeDefined();
    prepared.dispose();
  });

  it("executes one complete attempt and records success", async () => {
    const complete = vi.fn(async () => "result");
    const { executor, circuit, adapter } = makeExecutor({ complete });
    const prepared = executor.prepare({
      requestId: "req_2",
      operation: "complete",
      provider: "test",
      model: "model",
      policy: {},
    });

    const result = await executor.executeComplete(prepared, {
      model: "model",
      messages,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("result");
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: "model", messages }));
    expect(circuit.recordSuccess).toHaveBeenCalledOnce();
    expect(circuit.recordFailure).not.toHaveBeenCalled();
    expect(adapter.complete).toHaveBeenCalledOnce();
    prepared.dispose();
  });

  it("retains the provider error and records a provider failure", async () => {
    const error = new Error("provider failed");
    const { executor, circuit } = makeExecutor({ complete: async () => { throw error; } });
    const prepared = executor.prepare({
      requestId: "req_3",
      operation: "complete",
      provider: "test",
      model: "model",
      policy: {},
    });

    const result = await executor.executeComplete(prepared, { model: "model", messages });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(error);
    expect(circuit.recordFailure).toHaveBeenCalledWith(error);
    prepared.dispose();
  });

  it("does not record caller cancellation as a provider failure", async () => {
    const caller = new AbortController();
    const error = new DOMException("aborted", "AbortError");
    const { executor, circuit } = makeExecutor({ complete: async () => { throw error; } });
    const prepared = executor.prepare({
      requestId: "req_4",
      operation: "complete",
      provider: "test",
      model: "model",
      policy: {},
      callerSignal: caller.signal,
    });
    caller.abort();

    const result = await executor.executeComplete(prepared, { model: "model", messages });

    expect(result.ok).toBe(false);
    expect(circuit.recordFailure).not.toHaveBeenCalled();
    prepared.dispose();
  });

  it("rejects an unavailable circuit before invoking the adapter", async () => {
    const { executor, adapter } = makeExecutor({ available: false });

    expect(() => executor.prepare({
      requestId: "req_5",
      operation: "complete",
      provider: "test",
      model: "model",
      policy: {},
    })).toThrow(/circuit breaker is open/i);
    expect(adapter.complete).not.toHaveBeenCalled();
  });
});
