import { describe, it, expect } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
} from "../src/reliability/circuit-breaker.js";
import { CircuitBreakerOpenError } from "../src/errors/index.js";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 1000,
      halfOpenMaxCalls: 3,
    });
    expect(cb.state).toBe("closed");
  });

  it("is available when closed", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 2,
      successThreshold: 1,
      timeoutMs: 1000,
      halfOpenMaxCalls: 3,
    });
    expect(cb.isAvailable()).toBe(true);
  });

  it("opens after threshold failures", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 2,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("is unavailable when open", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(cb.isAvailable()).toBe(false);
  });

  it("resets failure count on success", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 3,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.stats.failureCount).toBe(0);
  });

  it("tracks stats", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordSuccess();
    cb.recordFailure();
    const stats = cb.stats;
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalSuccesses).toBe(1);
    expect(stats.totalFailures).toBe(1);
    expect(stats.lastSuccessTime).toBeTypeOf("number");
    expect(stats.lastFailureTime).toBeTypeOf("number");
  });

  it("ignores CircuitBreakerOpenError in recordFailure", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure(new CircuitBreakerOpenError("test"));
    // Should NOT have incremented failure count
    expect(cb.stats.totalFailures).toBe(0);
  });

  it("reset brings back to closed", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
  });
});

describe("CircuitBreakerRegistry", () => {
  it("creates and retrieves breakers", () => {
    const registry = new CircuitBreakerRegistry();
    const cb = registry.getOrCreate("provider1");
    expect(cb).toBeInstanceOf(CircuitBreaker);
    expect(registry.get("provider1")).toBe(cb);
  });

  it("returns same instance for same name", () => {
    const registry = new CircuitBreakerRegistry();
    const cb1 = registry.getOrCreate("provider1");
    const cb2 = registry.getOrCreate("provider1");
    expect(cb1).toBe(cb2);
  });

  it("removes breakers", () => {
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate("provider1");
    expect(registry.remove("provider1")).toBe(true);
    expect(registry.get("provider1")).toBeUndefined();
  });

  it("resets all breakers", () => {
    const registry = new CircuitBreakerRegistry();
    const cb = registry.getOrCreate("provider1", {
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 60000,
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    expect(cb.state).toBe("open");
    registry.resetAll();
    expect(cb.state).toBe("closed");
  });

  it("reports all stats", () => {
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate("a");
    registry.getOrCreate("b");
    const all = registry.getAllStats();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.a).toBeDefined();
    expect(all.b).toBeDefined();
  });
});
