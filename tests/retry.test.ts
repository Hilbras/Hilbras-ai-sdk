import { describe, it, expect } from "vitest";
import {
  createRetryConfig,
  shouldRetry,
  shouldRetryNetworkError,
} from "../src/reliability/retry.js";
import { calculateBackoff } from "../src/reliability/backoff.js";

describe("calculateBackoff", () => {
  it("returns non-negative delay", () => {
    const delay = calculateBackoff(0);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
  it("increases with attempt number on average", () => {
    // With jitter, individual calls vary; check the base-delay trend
    // by disabling jitter for deterministic output.
    const d0 = calculateBackoff(0, { jitter: 0 });
    const d1 = calculateBackoff(1, { jitter: 0 });
    const d2 = calculateBackoff(2, { jitter: 0 });
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });
  it("caps at maxDelayMs", () => {
    const delay = calculateBackoff(100, { maxDelayMs: 1000, jitter: 0 });
    expect(delay).toBeLessThanOrEqual(1000);
  });
});

describe("createRetryConfig", () => {
  it("returns config with defaults", () => {
    const config = createRetryConfig();
    expect(config.maxRetries).toBeGreaterThan(0);
    expect(config.retryableStatuses.size).toBeGreaterThan(0);
    expect(config.retryableNetworkErrors).toBe(true);
  });
  it("applies overrides", () => {
    const config = createRetryConfig({ maxRetries: 7 });
    expect(config.maxRetries).toBe(7);
  });
});

describe("shouldRetry", () => {
  it("retries 429", () => {
    expect(shouldRetry(429, 0)).toBe(true);
  });
  it("retries 500-series", () => {
    expect(shouldRetry(500, 0)).toBe(true);
    expect(shouldRetry(502, 0)).toBe(true);
    expect(shouldRetry(503, 0)).toBe(true);
  });
  it("does not retry 400-series client errors", () => {
    expect(shouldRetry(400, 0)).toBe(false);
    expect(shouldRetry(401, 0)).toBe(false);
    expect(shouldRetry(403, 0)).toBe(false);
    expect(shouldRetry(404, 0)).toBe(false);
  });
  it("respects maxRetries", () => {
    const config = createRetryConfig({ maxRetries: 2 });
    expect(shouldRetry(500, 0, config)).toBe(true);
    expect(shouldRetry(500, 1, config)).toBe(true);
    expect(shouldRetry(500, 2, config)).toBe(false);
  });
});

describe("shouldRetryNetworkError", () => {
  it("returns true when under retry limit", () => {
    expect(shouldRetryNetworkError(0)).toBe(true);
  });
  it("returns false at max retries", () => {
    expect(shouldRetryNetworkError(3)).toBe(false);
  });
  it("respects custom config", () => {
    const config = createRetryConfig({ maxRetries: 1 });
    expect(shouldRetryNetworkError(0, config)).toBe(true);
    expect(shouldRetryNetworkError(1, config)).toBe(false);
  });
});
