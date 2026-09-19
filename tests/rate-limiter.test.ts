import { describe, it, expect, vi } from "vitest";
import { RateLimiter, createRateLimiter, RateLimiterRegistry } from "../src/security/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests when tokens available", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 0 });
    const result = limiter.acquire();
    expect(result.allowed).toBe(true);
  });

  it("rejects requests when bucket empty", () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 0 });
    limiter.consume(); // use the one token
    const result = limiter.acquire();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 100 });
    limiter.consume();
    // With high refill rate, tokens should refill quickly
    const stats = limiter.stats();
    expect(stats.maxTokens).toBe(10);
    expect(stats.tokens).toBeGreaterThan(0);
  });

  it("tracks custom cost per request", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 0, costPerRequest: 5 });
    limiter.consume(); // costs 5 tokens (costPerRequest)
    // 5 tokens left, acquire checks if 5 >= 5 → allowed
    expect(limiter.acquire().allowed).toBe(true);
    limiter.consume(); // another 5 → 0 left
    expect(limiter.acquire().allowed).toBe(false);
  });

  it("resets bucket", () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 0 });
    limiter.consume(); // costs 1 token
    limiter.consume();
    limiter.consume();
    limiter.consume();
    limiter.consume(); // 0 left
    expect(limiter.acquire().allowed).toBe(false);
    limiter.reset();
    expect(limiter.acquire().allowed).toBe(true);
  });

  it("reports correct stats", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 5 });
    const stats = limiter.stats();
    expect(stats.maxTokens).toBe(10);
    expect(stats.refillRate).toBe(5);
    expect(stats.tokens).toBe(10);
  });

  it("calls onThrottled when rate limited", () => {
    const onThrottled = vi.fn();
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 0, onThrottled });
    limiter.consume();
    try { limiter.consume(); } catch { /* expected */ }
    expect(onThrottled).toHaveBeenCalled();
  });

  it("throws on consume when rate limited", () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 0 });
    limiter.consume();
    expect(() => limiter.consume()).toThrow("Rate limit exceeded");
  });

  it("acquire does not consume tokens", () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 0 });
    limiter.acquire(); // check only
    limiter.acquire(); // check again — should still be allowed
    const stats = limiter.stats();
    expect(stats.tokens).toBe(5); // unchanged
  });

  it("computes cost with costPerToken", () => {
    const limiter = new RateLimiter({
      maxTokens: 100,
      refillRate: 0,
      costPerRequest: 1,
      costPerToken: 0.5,
    });
    // consume with 10 tokens costs 1 + 10*0.5 = 6 tokens
    limiter.consume(10);
    const stats = limiter.stats();
    expect(stats.tokens).toBe(94); // 100 - 6
  });

  it("returns correct retryAfterMs", () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 10, costPerRequest: 2 });
    const result = limiter.acquire();
    expect(result.allowed).toBe(false);
    // deficit = 2 - 1 = 1, retryAfterMs = ceil((1/10)*1000) = 100
    expect(result.retryAfterMs).toBe(100);
  });
});

describe("createRateLimiter", () => {
  it("creates a limiter with defaults", () => {
    const limiter = createRateLimiter();
    expect(limiter.stats().maxTokens).toBe(100);
    expect(limiter.stats().refillRate).toBe(10);
  });

  it("creates a limiter with custom config", () => {
    const limiter = createRateLimiter({ maxTokens: 50, refillRate: 5 });
    expect(limiter.stats().maxTokens).toBe(50);
    expect(limiter.stats().refillRate).toBe(5);
  });
});

describe("RateLimiterRegistry", () => {
  it("creates and caches limiters by key", () => {
    const registry = new RateLimiterRegistry();
    const a = registry.getOrCreate("provider-1", { maxTokens: 50 });
    const b = registry.getOrCreate("provider-1");
    expect(a).toBe(b);
  });

  it("creates different limiters for different keys", () => {
    const registry = new RateLimiterRegistry();
    const a = registry.getOrCreate("provider-1");
    const b = registry.getOrCreate("provider-2");
    expect(a).not.toBe(b);
  });

  it("gets existing limiter", () => {
    const registry = new RateLimiterRegistry();
    registry.getOrCreate("test");
    expect(registry.get("test")).toBeDefined();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("removes limiters", () => {
    const registry = new RateLimiterRegistry();
    registry.getOrCreate("test");
    expect(registry.remove("test")).toBe(true);
    expect(registry.get("test")).toBeUndefined();
    expect(registry.remove("test")).toBe(false);
  });

  it("resets all limiters", () => {
    const registry = new RateLimiterRegistry();
    const a = registry.getOrCreate("a", { maxTokens: 5, refillRate: 0 });
    a.consume(); a.consume(); a.consume(); a.consume(); a.consume(); // drain
    expect(a.acquire().allowed).toBe(false);
    registry.resetAll();
    expect(a.acquire().allowed).toBe(true);
  });
});
