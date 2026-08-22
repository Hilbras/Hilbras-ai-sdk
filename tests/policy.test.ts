/**
 * @hilbras/sdk — Execution Policy tests
 *
 * Verifies preset resolution, field overrides, and policy merging.
 */

import { describe, it, expect } from "vitest";
import { resolvePolicy, getPreset } from "../src/reliability/presets.js";
import type { ExecutionPolicy } from "../src/types/policy.js";

describe("resolvePolicy", () => {
  it("returns balanced defaults when no policy is provided", () => {
    const resolved = resolvePolicy(undefined);
    expect(resolved.retry.maxRetries).toBe(3);
    expect(resolved.retry.retryableStatuses).toEqual(new Set([429, 500, 502, 503, 504]));
    expect(resolved.retry.retryableNetworkErrors).toBe(true);
    expect(resolved.timeout.requestTimeoutMs).toBe(60_000);
    expect(resolved.circuitBreaker.enabled).toBe(true);
    expect(resolved.circuitBreaker.failureThreshold).toBe(5);
  });

  it("returns balanced defaults when empty policy is provided", () => {
    const resolved = resolvePolicy({});
    expect(resolved.retry.maxRetries).toBe(3);
    expect(resolved.circuitBreaker.enabled).toBe(true);
  });
});

describe("preset resolution", () => {
  it("production preset: more retries, longer timeout", () => {
    const resolved = resolvePolicy({ preset: "production" });
    expect(resolved.retry.maxRetries).toBe(5);
    expect(resolved.timeout.requestTimeoutMs).toBe(120_000);
    expect(resolved.backoff.baseDelayMs).toBe(1_000);
    expect(resolved.circuitBreaker.enabled).toBe(true);
  });

  it("fast preset: fewer retries, lower timeout", () => {
    const resolved = resolvePolicy({ preset: "fast" });
    expect(resolved.retry.maxRetries).toBe(1);
    expect(resolved.timeout.requestTimeoutMs).toBe(15_000);
    expect(resolved.backoff.baseDelayMs).toBe(200);
    expect(resolved.backoff.maxDelayMs).toBe(2_000);
    expect(resolved.circuitBreaker.enabled).toBe(true);
    expect(resolved.circuitBreaker.failureThreshold).toBe(3);
  });

  it("cheap preset: max retries, no circuit breaker", () => {
    const resolved = resolvePolicy({ preset: "cheap" });
    expect(resolved.retry.maxRetries).toBe(10);
    expect(resolved.timeout.requestTimeoutMs).toBe(300_000);
    expect(resolved.circuitBreaker.enabled).toBe(false);
  });

  it("maximum preset: aggressive everything", () => {
    const resolved = resolvePolicy({ preset: "maximum" });
    expect(resolved.retry.maxRetries).toBe(10);
    expect(resolved.timeout.requestTimeoutMs).toBe(300_000);
    expect(resolved.circuitBreaker.enabled).toBe(true);
    expect(resolved.circuitBreaker.failureThreshold).toBe(10);
    expect(resolved.circuitBreaker.successThreshold).toBe(3);
  });

  it("balanced preset: same as defaults", () => {
    const resolved = resolvePolicy({ preset: "balanced" });
    const defaults = resolvePolicy(undefined);
    expect(resolved.retry.maxRetries).toBe(defaults.retry.maxRetries);
    expect(resolved.timeout.requestTimeoutMs).toBe(defaults.timeout.requestTimeoutMs);
    expect(resolved.circuitBreaker.enabled).toBe(defaults.circuitBreaker.enabled);
  });
});

describe("field overrides", () => {
  it("overrides retry.maxRetries on top of preset", () => {
    const resolved = resolvePolicy({ preset: "fast", retry: { maxRetries: 7 } });
    expect(resolved.retry.maxRetries).toBe(7);
    // Other fast preset values preserved
    expect(resolved.timeout.requestTimeoutMs).toBe(15_000);
  });

  it("overrides timeout on top of preset", () => {
    const resolved = resolvePolicy({ preset: "production", timeout: { requestTimeoutMs: 5_000 } });
    expect(resolved.timeout.requestTimeoutMs).toBe(5_000);
    // Other production values preserved
    expect(resolved.retry.maxRetries).toBe(5);
  });

  it("overrides circuit breaker enabled", () => {
    const resolved = resolvePolicy({ preset: "balanced", circuitBreaker: { enabled: false } });
    expect(resolved.circuitBreaker.enabled).toBe(false);
    expect(resolved.retry.maxRetries).toBe(3); // balanced defaults preserved
  });

  it("overrides retryableStatuses", () => {
    const resolved = resolvePolicy({ retry: { retryableStatuses: [429, 503] } });
    expect(resolved.retry.retryableStatuses).toEqual(new Set([429, 503]));
  });

  it("overrides backoff settings", () => {
    const resolved = resolvePolicy({ backoff: { baseDelayMs: 100, maxDelayMs: 5_000, jitter: 0.5 } });
    expect(resolved.backoff.baseDelayMs).toBe(100);
    expect(resolved.backoff.maxDelayMs).toBe(5_000);
    expect(resolved.backoff.jitter).toBe(0.5);
  });

  it("multiple overrides on top of preset", () => {
    const resolved = resolvePolicy({
      preset: "production",
      retry: { maxRetries: 8 },
      timeout: { requestTimeoutMs: 10_000 },
      circuitBreaker: { failureThreshold: 2 },
    });
    expect(resolved.retry.maxRetries).toBe(8);
    expect(resolved.timeout.requestTimeoutMs).toBe(10_000);
    expect(resolved.circuitBreaker.failureThreshold).toBe(2);
    // Other production values preserved
    expect(resolved.backoff.baseDelayMs).toBe(1_000);
    expect(resolved.circuitBreaker.enabled).toBe(true);
  });
});

describe("getPreset", () => {
  it("returns a preset by name", () => {
    const preset = getPreset("fast");
    expect(preset.retry.maxRetries).toBe(1);
    expect(preset.timeout.requestTimeoutMs).toBe(15_000);
  });

  it("returns independent copies (no mutation)", () => {
    const a = getPreset("balanced");
    const b = getPreset("balanced");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("policy completeness", () => {
  it("resolved policy has all required fields filled", () => {
    const resolved = resolvePolicy({ preset: "maximum" });

    // Retry
    expect(typeof resolved.retry.maxRetries).toBe("number");
    expect(resolved.retry.retryableStatuses).toBeInstanceOf(Set);
    expect(typeof resolved.retry.retryableNetworkErrors).toBe("boolean");

    // Backoff
    expect(typeof resolved.backoff.baseDelayMs).toBe("number");
    expect(typeof resolved.backoff.maxDelayMs).toBe("number");
    expect(typeof resolved.backoff.jitter).toBe("number");

    // Timeout
    expect(typeof resolved.timeout.requestTimeoutMs).toBe("number");

    // Circuit breaker
    expect(typeof resolved.circuitBreaker.enabled).toBe("boolean");
    expect(typeof resolved.circuitBreaker.failureThreshold).toBe("number");
    expect(typeof resolved.circuitBreaker.successThreshold).toBe("number");
    expect(typeof resolved.circuitBreaker.timeoutMs).toBe("number");
    expect(typeof resolved.circuitBreaker.halfOpenMaxCalls).toBe("number");
  });
});
