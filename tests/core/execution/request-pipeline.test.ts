import { describe, expect, it, vi } from "vitest";
import { BudgetTracker } from "../../../src/cost/tracker.js";
import { RequestExecutor } from "../../../src/core/execution/request-executor.js";
import { RequestPipeline } from "../../../src/core/execution/request-pipeline.js";
import { ProviderRequestError } from "../../../src/errors/index.js";
import type { ResolvedPolicy } from "../../../src/types/policy.js";
import type { Message } from "../../../src/types/messages.js";

const model = "model";
const messages: Message[] = [{ role: "user", content: "hello" }];

function policy(overrides: Partial<ResolvedPolicy> = {}): ResolvedPolicy {
  return {
    allowFallback: false,
    maxFallbackCost: null,
    retry: { maxRetries: 0, retryableStatuses: new Set(), retryableNetworkErrors: false },
    backoff: { baseDelayMs: 1, maxDelayMs: 1, jitter: 0 },
    timeout: { requestTimeoutMs: 0 },
    circuitBreaker: { enabled: false, failureThreshold: 2, successThreshold: 1, timeoutMs: 10, halfOpenMaxCalls: 1 },
    ...overrides,
  };
}

function setup(complete: (params: { model: string; messages: Message[] }) => Promise<string>, resolved = policy()) {
  const circuit = {
    stats: { failureCount: 0 },
    isAvailable: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const adapter = {
    id: "test-adapter",
    complete: vi.fn(complete),
    stream: vi.fn(),
  };
  const executor = new RequestExecutor({
    policy: { resolve: () => resolved },
    circuitBreakers: { getOrCreate: () => circuit },
    adapters: { get: () => adapter },
  });
  const budget = new BudgetTracker({ sessionBudget: 10 });
  const events: string[] = [];
  const plugins = {
    fireRequest: vi.fn(async () => {}),
    fireResponse: vi.fn(async () => {}),
    fireError: vi.fn(async () => {}),
  };
  const pipeline = new RequestPipeline({
    executor,
    budget,
    emit: (event) => events.push(event.type),
    now: () => 0,
    plugins,
    sleep: async () => {},
  });
  return { pipeline, budget, events, plugins };
}

describe("RequestPipeline plain complete", () => {
  it("owns one reservation and terminal success lifecycle", async () => {
    const { pipeline, budget, events, plugins } = setup(async () => "ok");

    const result = await pipeline.runComplete({
      requestId: "req_1",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [],
      getProviderTimeout: () => 0,
    });

    expect(result).toBe("ok");
    expect(events).toEqual(["request.completed"]);
    expect(plugins.fireRequest).toHaveBeenCalledOnce();
    expect(plugins.fireResponse).toHaveBeenCalledOnce();
    expect(budget.report().activeReservations).toBe(0);
    expect(budget.report().requestCount).toBe(1);
  });

  it("reuses one logical reservation across retries", async () => {
    let calls = 0;
    const resolved = policy({ retry: { maxRetries: 1, retryableStatuses: new Set([503]), retryableNetworkErrors: false } });
    const { pipeline, budget, events } = setup(async () => {
      calls++;
      if (calls === 1) throw new ProviderRequestError(503, "busy", "test");
      return "ok";
    }, resolved);

    const result = await pipeline.runComplete({
      requestId: "req_2",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [],
      getProviderTimeout: () => 0,
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(events).toEqual(["request.retrying", "request.completed"]);
    expect(budget.report().activeReservations).toBe(0);
    expect(budget.report().requestCount).toBe(1);
  });

  it("releases the reservation and rethrows the original terminal error", async () => {
    const error = new ProviderRequestError(400, "bad request", "test");
    const { pipeline, budget, events, plugins } = setup(async () => { throw error; });

    await expect(pipeline.runComplete({
      requestId: "req_3",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [],
      getProviderTimeout: () => 0,
    })).rejects.toBe(error);

    expect(events).toEqual(["request.failed"]);
    expect(plugins.fireError).toHaveBeenCalledOnce();
    expect(budget.report().activeReservations).toBe(0);
  });
});
