/**
 * @hilbras/sdk — Pipeline reservation release (C5) and retry classification (C6)
 *
 * C5: the structured fallback branch released the primary reservation directly,
 * bypassing the `budgetReleased` guard, so the trailing cleanup released the
 * same request id a second time.
 * C6: the structured loop classified network errors without
 * `isNetworkFailure`, so a socket ECONNRESET never retried there while the same
 * error did on `complete()`.
 */

import { describe, expect, it, vi } from "vitest";
import { BudgetTracker } from "../../../src/cost/tracker.js";
import { RequestExecutor } from "../../../src/core/execution/request-executor.js";
import { RequestPipeline } from "../../../src/core/execution/request-pipeline.js";
import type { AdapterPort, BudgetPort } from "../../../src/core/execution/ports.js";
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

function setup(
  complete: (params: { model: string; messages: Message[]; signal?: AbortSignal }) => Promise<string>,
  resolved = policy(),
) {
  const circuit = {
    stats: { failureCount: 0 },
    isAvailable: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const adapter = { id: "test-adapter", complete: vi.fn(complete), stream: vi.fn() };
  const executor = new RequestExecutor({
    policy: { resolve: () => resolved },
    circuitBreakers: { getOrCreate: () => circuit },
    adapters: { get: () => adapter as AdapterPort },
  });

  const inner = new BudgetTracker({ sessionBudget: 10 });
  const released: string[] = [];
  const budget: BudgetPort = {
    estimate: (m, p, input, output) => inner.estimate(m, p, input, output),
    reserve: (id, cost) => inner.reserve(id, cost),
    settle: (id, cost, meta) => inner.settle(id, cost, meta),
    release: (id) => {
      released.push(id);
      inner.release(id);
    },
    report: () => inner.report(),
  };

  const pipeline = new RequestPipeline({
    executor,
    budget,
    emit: () => {},
    now: () => 0,
    plugins: {
      fireRequest: vi.fn(async () => {}),
      fireResponse: vi.fn(async () => {}),
      fireError: vi.fn(async () => {}),
    },
    sleep: async () => {},
  });

  return { pipeline, adapter, released };
}

const acceptingSchema = {
  safeParse: (value: unknown) =>
    value && typeof value === "object"
      ? { success: true as const, data: value }
      : { success: false as const, error: new Error("not an object") },
};

const structuredInput = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  requestId,
  startTime: 0,
  provider: "test",
  model,
  messages,
  params: { model, messages },
  estimatedCost: 0.5,
  policy: {},
  output: { schema: acceptingSchema },
  fallbackCandidates: () => [],
  estimateFallbackCost: () => 0,
  getProviderTimeout: () => 0,
  ...overrides,
});

describe("structured fallback releases the reservation once (C5)", () => {
  // The double release only happens when the fallback loop exhausts: a
  // successful fallback returns straight out at the `return validation.data`
  // above the trailing cleanup, so it never reaches the second release.
  it("does not release the primary reservation twice when the fallback also fails", async () => {
    const { pipeline, released } = setup(async () => {
      throw new ProviderRequestError(400, "bad request", "test");
    }, policy({ allowFallback: true }));

    await expect(
      pipeline.runStructuredComplete(
        structuredInput("req_primary", {
          fallbackCandidates: () => [{ provider: "test", model: "other" }],
          estimateFallbackCost: () => 0.1,
        }) as never,
      ),
    ).rejects.toThrow();

    expect(released.filter((id) => id === "req_primary")).toHaveLength(1);
  });
});

describe("structured retry classification (C6)", () => {
  it("retries a socket network error", async () => {
    let call = 0;
    const { pipeline, adapter } = setup(async () => {
      call += 1;
      if (call === 1) {
        const error = new Error("socket hang up") as Error & { code?: string };
        error.code = "ECONNRESET";
        throw error;
      }
      return '{"ok":true}';
    }, policy({
      retry: { maxRetries: 1, retryableStatuses: new Set(), retryableNetworkErrors: true },
    }));

    const result = await pipeline.runStructuredComplete(structuredInput("req_net") as never);

    expect(result).toEqual({ ok: true });
    expect(adapter.complete).toHaveBeenCalledTimes(2);
  });

  it("retries the same error on the plain complete path", async () => {
    let call = 0;
    const { adapter, pipeline } = setup(async () => {
      call += 1;
      if (call === 1) {
        const error = new Error("socket hang up") as Error & { code?: string };
        error.code = "ECONNRESET";
        throw error;
      }
      return "ok";
    }, policy({
      retry: { maxRetries: 1, retryableStatuses: new Set(), retryableNetworkErrors: true },
    }));

    const result = await pipeline.runComplete({
      requestId: "req_net_plain",
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
    expect(adapter.complete).toHaveBeenCalledTimes(2);
  });
});

describe("per-attempt timeout (C1)", () => {
  // A single timeout per logical request aborts once and never resets. The
  // fallback used to inherit the primary's already-aborted signal as its
  // `callerSignal`, so `executeComplete` returned AbortError without ever
  // calling the provider — the fallback existed precisely for this case and
  // never ran.
  it("still runs the fallback after the primary times out", async () => {
    const attempted: string[] = [];
    const { pipeline } = setup(async (params) => {
      attempted.push(params.model);
      if (params.model === "other") return "fallback-ok";

      // Hang until the attempt timeout fires, as a real adapter would.
      return new Promise<string>((_, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
        if (params.signal?.aborted) {
          abort();
          return;
        }
        params.signal?.addEventListener("abort", abort, { once: true });
      });
    }, policy({
      allowFallback: true,
      timeout: { requestTimeoutMs: 20 },
      retry: { maxRetries: 0, retryableStatuses: new Set(), retryableNetworkErrors: false },
    }));

    const result = await pipeline.runComplete({
      requestId: "req_timeout",
      startTime: 0,
      provider: "test",
      model,
      messages,
      params: { model, messages },
      estimatedCost: 0.5,
      policy: {},
      fallbackCandidates: () => [{ provider: "test", model: "other" }],
      estimateFallbackCost: () => 0.1,
      getProviderTimeout: () => 0,
    } as never);

    expect(result).toBe("fallback-ok");
    expect(attempted).toContain("other");
  });
});
