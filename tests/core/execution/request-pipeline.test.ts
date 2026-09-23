import { describe, expect, it, vi } from "vitest";
import { BudgetTracker } from "../../../src/cost/tracker.js";
import { RequestExecutor } from "../../../src/core/execution/request-executor.js";
import { RequestPipeline } from "../../../src/core/execution/request-pipeline.js";
import type { AdapterPort } from "../../../src/core/execution/ports.js";
import { ProviderRequestError, ValidationError } from "../../../src/errors/index.js";
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

function setup(
  complete: (params: { model: string; messages: Message[] }) => Promise<string>,
  resolved = policy(),
  options: {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    adapters?: Record<string, AdapterPort>;
  } = {},
) {
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
  const adapters = options.adapters ?? { test: adapter as AdapterPort };
  const executor = new RequestExecutor({
    policy: { resolve: () => resolved },
    circuitBreakers: { getOrCreate: () => circuit },
    adapters: { get: (provider) => adapters[provider] },
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
    sleep: options.sleep ?? (async () => {}),
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

  it("owns streaming usage settlement and completion events", async () => {
    const streamAdapter = {
      id: "stream-adapter",
      complete: vi.fn(async () => "unused"),
      stream: vi.fn(async function* () {
        yield { type: "text", text: "hello" };
        yield { type: "usage", inputTokens: 3, outputTokens: 2, totalTokens: 5 };
      }),
    };
    const { pipeline, budget, events, plugins } = setup(async () => "unused", policy(), {
      adapters: { test: streamAdapter },
    });

    const chunks = [];
    for await (const chunk of pipeline.runStream({
      requestId: "req_stream_success",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(events).toEqual(["stream.first_chunk", "request.completed"]);
    expect(plugins.fireResponse).toHaveBeenCalledOnce();
    expect(budget.report().activeReservations).toBe(0);
  });

  it("releases a streaming reservation when the consumer stops early", async () => {
    const streamAdapter = {
      id: "stream-adapter",
      complete: vi.fn(async () => "unused"),
      stream: vi.fn(async function* () {
        yield { type: "text", text: "hello" };
        yield { type: "text", text: "world" };
      }),
    };
    const { pipeline, budget } = setup(async () => "unused", policy(), {
      adapters: { test: streamAdapter },
    });

    for await (const _chunk of pipeline.runStream({
      requestId: "req_stream_break",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    })) {
      break;
    }

    expect(budget.report().activeReservations).toBe(0);
  });

  it("uses a fallback stream candidate after a terminal primary failure", async () => {
    const primary = {
      id: "primary",
      complete: vi.fn(async () => "unused"),
      stream: vi.fn(async function* () {
        throw new ProviderRequestError(400, "bad request", "test");
      }),
    };
    const fallback = {
      id: "fallback",
      complete: vi.fn(async () => "unused"),
      stream: vi.fn(async function* () {
        yield { type: "text", text: "fallback" };
      }),
    };
    const resolved = policy({ allowFallback: true });
    const { pipeline, budget, events } = setup(async () => "unused", resolved, {
      adapters: { test: primary, fallback },
    });

    const chunks = [];
    for await (const chunk of pipeline.runStream({
      requestId: "req_stream_fallback",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [{ provider: "fallback", model: "fallback-model" }],
      estimateFallbackCost: () => 0.2,
      getProviderTimeout: () => 0,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: "text", text: "fallback" }]);
    expect(events).toEqual(["fallback.started", "request.completed"]);
    expect(budget.report().activeReservations).toBe(0);
  });

  it("validates structured output before reporting completion", async () => {
    const { pipeline, budget, events } = setup(async () => '{"ok":true}');
    const result = await pipeline.runStructuredComplete({
      requestId: "req_4",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      output: {
        schema: {
          safeParse(value) {
            return value && typeof value === "object" && "ok" in value
              ? { success: true, data: value as { ok: boolean } }
              : { success: false, error: new Error("missing ok") };
          },
        },
      },
      fallbackCandidates: () => [],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    });

    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["structured.validate.pass", "request.completed"]);
    expect(budget.report().activeReservations).toBe(0);
  });

  it("releases structured reservations when validation is exhausted", async () => {
    const { pipeline, budget, events } = setup(async () => '{"ok":false}');
    const promise = pipeline.runStructuredComplete({
      requestId: "req_5",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      output: {
        maxRepairAttempts: 0,
        schema: { safeParse: () => ({ success: false, error: new Error("invalid") }) },
      },
      fallbackCandidates: () => [],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    });

    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    expect(events).toEqual(["structured.validate.fail", "request.failed"]);
    expect(budget.report().activeReservations).toBe(0);
  });

  it("allows fallback after a non-retryable primary failure when configured", async () => {
    const primary = {
      id: "primary",
      complete: vi.fn(async () => { throw new ProviderRequestError(400, "bad request", "test"); }),
      stream: vi.fn(),
    };
    const fallback = {
      id: "fallback",
      complete: vi.fn(async () => "fallback"),
      stream: vi.fn(),
    };
    const resolved = policy({
      allowFallback: true,
      retry: { maxRetries: 2, retryableStatuses: new Set([503]), retryableNetworkErrors: false },
    });
    const { pipeline, budget, events } = setup(primary.complete, resolved, {
      adapters: { test: primary, fallback },
    });

    const result = await pipeline.runComplete({
      requestId: "req_fallback",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [{ provider: "fallback", model: "fallback-model" }],
      estimateFallbackCost: () => 0.2,
      getProviderTimeout: () => 0,
    });

    expect(result).toBe("fallback");
    expect(fallback.complete).toHaveBeenCalledOnce();
    expect(events).toEqual(["request.completed"]);
    expect(budget.report().activeReservations).toBe(0);
  });

  it("skips fallback candidates above the configured fallback cost", async () => {
    const primary = {
      id: "primary",
      complete: vi.fn(async () => { throw new ProviderRequestError(400, "bad request", "test"); }),
      stream: vi.fn(),
    };
    const fallback = {
      id: "fallback",
      complete: vi.fn(async () => "should-not-run"),
      stream: vi.fn(),
    };
    const resolved = policy({ allowFallback: true, maxFallbackCost: 0.1 });
    const { pipeline } = setup(primary.complete, resolved, { adapters: { test: primary, fallback } });

    await expect(pipeline.runComplete({
      requestId: "req_cost_fallback",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [{ provider: "fallback", model: "fallback-model" }],
      estimateFallbackCost: () => 0.2,
      getProviderTimeout: () => 0,
    })).rejects.toBeInstanceOf(ProviderRequestError);

    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it("does not continue through fallback candidates after cancellation", async () => {
    const caller = new AbortController();
    const primary = {
      id: "primary",
      complete: vi.fn(async () => { throw new ProviderRequestError(400, "bad request", "test"); }),
      stream: vi.fn(),
    };
    const fallback = {
      id: "fallback",
      complete: vi.fn(async () => {
        caller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
      stream: vi.fn(),
    };
    const secondFallback = {
      id: "second-fallback",
      complete: vi.fn(async () => "should-not-run"),
      stream: vi.fn(),
    };
    const resolved = policy({ allowFallback: true });
    const { pipeline, budget } = setup(primary.complete, resolved, {
      adapters: { test: primary, fallback, second: secondFallback },
    });

    await expect(pipeline.runComplete({
      requestId: "req_cancel_fallback",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      callerSignal: caller.signal,
      fallbackCandidates: () => [
        { provider: "fallback", model: "fallback-model" },
        { provider: "second", model: "second-model" },
      ],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(secondFallback.complete).not.toHaveBeenCalled();
    expect(budget.report().activeReservations).toBe(0);
  });

  it("terminates the request when cancellation interrupts backoff", async () => {
    const caller = new AbortController();
    const resolved = policy({ retry: { maxRetries: 1, retryableStatuses: new Set([503]), retryableNetworkErrors: false } });
    const { pipeline, budget, events } = setup(async () => {
      throw new ProviderRequestError(503, "busy", "test");
    }, resolved, {
      sleep: async () => {
        caller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });

    await expect(pipeline.runComplete({
      requestId: "req_cancel_backoff",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      callerSignal: caller.signal,
      fallbackCandidates: () => [],
      estimateFallbackCost: () => 0,
      getProviderTimeout: () => 0,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(events).toEqual(["request.retrying", "request.failed"]);
    expect(budget.report().activeReservations).toBe(0);
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
