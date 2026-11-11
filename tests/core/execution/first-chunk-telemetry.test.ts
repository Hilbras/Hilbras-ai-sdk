/**
 * @hilbras/sdk — Stream first-chunk telemetry (C7)
 *
 * `stream.first_chunk` carries "time from adapter call start to first chunk",
 * but the emit hardcoded `latencyMs: 0`, and a request served by a fallback
 * emitted no first-chunk event at all — so TTFT was either zero or missing.
 */

import { describe, expect, it, vi } from "vitest";
import { BudgetTracker } from "../../../src/cost/tracker.js";
import { RequestExecutor } from "../../../src/core/execution/request-executor.js";
import { RequestPipeline } from "../../../src/core/execution/request-pipeline.js";
import type { AdapterPort } from "../../../src/core/execution/ports.js";
import { ProviderRequestError } from "../../../src/errors/index.js";
import type { ResolvedPolicy } from "../../../src/types/policy.js";
import type { Message } from "../../../src/types/messages.js";
import type { HookEvent } from "../../../src/types/observability.js";
import type { StreamChunk } from "../../../src/types/streams.js";

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

type StreamImpl = (tick: (ms: number) => void, params: { model: string }) => AsyncGenerator<StreamChunk>;

function setup(streamImpl: StreamImpl, resolved = policy()) {
  const clock = { t: 0 };
  const tick = (ms: number): void => {
    clock.t += ms;
  };

  const adapter = {
    id: "test-adapter",
    complete: vi.fn(async () => "unused"),
    stream: vi.fn((params: { model: string }) => streamImpl(tick, params)),
  };
  const executor = new RequestExecutor({
    policy: { resolve: () => resolved },
    circuitBreakers: {
      getOrCreate: () => ({
        stats: { failureCount: 0 },
        isAvailable: () => true,
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(),
      }),
    },
    adapters: { get: () => adapter as unknown as AdapterPort },
  });

  const events: HookEvent[] = [];
  const pipeline = new RequestPipeline({
    executor,
    budget: new BudgetTracker({ sessionBudget: 10 }),
    emit: (event) => events.push(event),
    now: () => clock.t,
    plugins: {
      fireRequest: vi.fn(async () => {}),
      fireResponse: vi.fn(async () => {}),
      fireError: vi.fn(async () => {}),
    },
    sleep: async () => {},
  });

  return { pipeline, events };
}

const streamInput = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  requestId,
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
  ...overrides,
});

function firstChunkLatencies(events: HookEvent[]): number[] {
  return events
    .filter((event) => event.type === "stream.first_chunk")
    .map((event) => (event as unknown as { latencyMs: number }).latencyMs);
}

describe("stream first-chunk telemetry (C7)", () => {
  it("reports the real time to the first chunk", async () => {
    const { pipeline, events } = setup(async function* (tick) {
      tick(40); // provider takes 40ms to produce its first chunk
      yield { type: "text", text: "hi" };
    });

    for await (const _chunk of pipeline.runStream(streamInput("req_stream") as never)) {
      void _chunk;
    }

    expect(firstChunkLatencies(events)).toEqual([40]);
  });

  it("emits a first-chunk event for a stream served by the fallback", async () => {
    const { pipeline, events } = setup(async function* (tick, params) {
      if (params.model === "other") {
        tick(70);
        yield { type: "text", text: "fallback" };
        return;
      }
      throw new ProviderRequestError(400, "bad request", "test");
    }, policy({ allowFallback: true }));

    for await (const _chunk of pipeline.runStream(
      streamInput("req_fallback", {
        fallbackCandidates: () => [{ provider: "test", model: "other" }],
      }) as never,
    )) {
      void _chunk;
    }

    expect(firstChunkLatencies(events)).toEqual([70]);
  });
});
