/**
 * @hilbras/sdk — Reliability hardening (C2, C4)
 *
 * C2: half-open probe slots are only released by recordSuccess/recordFailure,
 * so a probe that is admitted and never reported back used to refuse every
 * later request for the rest of the process lifetime.
 * C4: backoff jitter pushed the delay above `maxDelayMs`, and
 * `createRetryConfig` handed out the module's own status Set.
 */

import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../src/reliability/circuit-breaker.js";
import { calculateBackoff } from "../src/reliability/backoff.js";
import { createRetryConfig, shouldRetry } from "../src/reliability/retry.js";

describe("CircuitBreaker half-open escape (C2)", () => {
  it("admits a fresh probe round when every slot is leaked", () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker("provider", {
        failureThreshold: 1,
        successThreshold: 2,
        timeoutMs: 1000,
        halfOpenMaxCalls: 2,
      });

      breaker.recordFailure(new Error("boom"));
      expect(breaker.state).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(breaker.isAvailable()).toBe(true); // open -> half_open, probe 1
      expect(breaker.isAvailable()).toBe(true); // probe 2

      // Both probes were taken and never reported back (aborted request, or a
      // provider that turned out not to be registered).
      vi.advanceTimersByTime(100);
      expect(breaker.isAvailable()).toBe(false); // still inside the window

      // A full stuck window must not lock the provider out permanently.
      vi.advanceTimersByTime(1000);
      expect(breaker.isAvailable()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still closes the circuit when a probe succeeds", () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker("provider", {
        failureThreshold: 1,
        successThreshold: 1,
        timeoutMs: 1000,
        halfOpenMaxCalls: 2,
      });

      breaker.recordFailure(new Error("boom"));
      vi.advanceTimersByTime(1000);
      expect(breaker.isAvailable()).toBe(true);

      breaker.recordSuccess();
      expect(breaker.state).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("calculateBackoff (C4)", () => {
  it("never exceeds maxDelayMs", () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const delay = calculateBackoff(attempt, { baseDelayMs: 500, maxDelayMs: 30_000, jitter: 0.3 });
      expect(delay).toBeLessThanOrEqual(30_000);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("createRetryConfig (C4)", () => {
  it("returns an independent status set", () => {
    const custom = createRetryConfig();
    custom.retryableStatuses.add(418);

    expect(shouldRetry(418, 0, custom)).toBe(true);
    expect(shouldRetry(418, 0, createRetryConfig())).toBe(false);
    // The module default must be untouched too.
    expect(shouldRetry(418, 0)).toBe(false);
  });
});
