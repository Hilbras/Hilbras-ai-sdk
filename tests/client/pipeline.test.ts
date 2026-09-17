/**
 * @hilbras/sdk — tests/client/pipeline.test.ts
 *
 * v0.10.0 PR-4: focused tests for the `_prepareRequest` helper on
 * `HilbrasClient`. The full RequestPipeline migration is staged; this
 * test file pins the contract of the shared pre-flight helper that
 * `stream()` and `complete()` now use.
 */

import { describe, it, expect, afterAll } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { getCircuitBreakerRegistry } from "../../src/reliability/circuit-breaker.js";
import type { ProviderConfig } from "../../src/types/providers.js";

const MODEL_ID = "gpt-5.6-sol";

function testProvider(name = "Test"): ProviderConfig {
  return {
    name,
    baseUrl: `https://${name.toLowerCase()}.com/v1`,
    authentication: { type: "none" },
    adapter: "openai",
    models: [{ id: MODEL_ID, contextWindow: 128_000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
  };
}

type HelperSig = (id: string, name: string, cfg: ProviderConfig, policy: unknown, signal: undefined) => {
  resolved: { retry: { maxRetries: number }; timeout: { requestTimeoutMs: number } };
  signal: AbortSignal | undefined;
};

function callPrepare(client: HilbrasClient, provider: ProviderConfig, policy?: unknown): ReturnType<HelperSig> {
  return (client as unknown as { _prepareRequest: HelperSig })._prepareRequest(
    "req_test",
    provider.name,
    provider,
    policy,
    undefined,
  );
}

describe("PR-4: _prepareRequest shared pre-flight (v0.10.0)", () => {
  afterAll(() => {
    // Don't leak the seeded breaker into other test files.
    getCircuitBreakerRegistry().resetAll();
  });

  it("resolves policy from the per-request policy when provided", () => {
    const client = new HilbrasClient();
    const provider = testProvider();
    const result = callPrepare(client, provider, {
      retry: { maxRetries: 7, retryableStatuses: [500], retryableNetworkErrors: ["ECONNRESET"] },
      timeout: { requestTimeoutMs: 0, streamIdleTimeoutMs: 0 },
    });
    expect(result.resolved.retry.maxRetries).toBe(7);
    expect(result.resolved.timeout.requestTimeoutMs).toBe(0);
  });

  it("falls back to the client default policy when none is provided", () => {
    const client = new HilbrasClient({ policy: { retry: { maxRetries: 4, retryableStatuses: [502], retryableNetworkErrors: ["ETIMEDOUT"] } } });
    const provider = testProvider();
    const result = callPrepare(client, provider);
    expect(result.resolved.retry.maxRetries).toBe(4);
  });

  it("throws if the circuit breaker is open for the requested provider", () => {
    const client = new HilbrasClient();
    const provider = testProvider("OpenBreaker");
    client.addProvider(provider);

    const cb = getCircuitBreakerRegistry().getOrCreate(provider.name, {
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 60_000,
      halfOpenMaxCalls: 1,
    });
    cb.recordFailure(new Error("seed failure"));

    expect(() => callPrepare(client, provider)).toThrow(/circuit breaker is open/i);
  });

  it("passes the user signal through unchanged when no timeout is configured", () => {
    const client = new HilbrasClient();
    const provider = testProvider("PassThrough");
    const userSignal = new AbortController().signal;
    const result = (client as unknown as { _prepareRequest: (id: string, name: string, cfg: ProviderConfig, policy: unknown, signal: AbortSignal | undefined) => { signal: AbortSignal | undefined } })._prepareRequest(
      "req_test",
      provider.name,
      provider,
      { retry: { maxRetries: 0, retryableStatuses: [], retryableNetworkErrors: [] }, timeout: { requestTimeoutMs: 0, streamIdleTimeoutMs: 0 } },
      userSignal,
    );
    expect(result.signal).toBe(userSignal);
  });
});
