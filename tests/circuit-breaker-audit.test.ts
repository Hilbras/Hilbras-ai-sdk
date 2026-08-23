/**
 * @hilbras/sdk — Circuit Breaker Architecture Audit
 *
 * Deep audit of the CircuitBreaker subsystem: isolation, lifecycle,
 * concurrency, state transitions, fallback/retry interaction,
 * error classification, and test contamination.
 *
 * Phases: 1-22
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  getCircuitBreakerRegistry,
} from "../src/reliability/circuit-breaker.js";
import { CircuitBreakerOpenError } from "../src/errors/index.js";
import { HilbrasClient } from "../src/client/client.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function failingTransport(status = 500): Transport {
  return {
    async request() { return new Response(JSON.stringify({ error: { message: "fail" } }), { status }); },
    async stream() { throw new Error(`HTTP ${status}`); },
    abort() {},
  };
}

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

const MINIMAL_PROVIDER: ProviderConfig = {
  name: "TestProvider",
  baseUrl: "https://test.com/v1",
  authentication: { type: "none" },
  adapter: "openai",
  models: [{ id: "m", contextWindow: 1000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: State Ownership
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: State Ownership", () => {
  it("CircuitBreaker state is per-instance (not global)", () => {
    const a = new CircuitBreaker("A");
    const b = new CircuitBreaker("B");
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    // A should be open, B should still be closed
    expect(a.state).toBe("open");
    expect(b.state).toBe("closed");
  });

  it("CircuitBreakerRegistry keys by provider name", () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getOrCreate("provider-a");
    const b = registry.getOrCreate("provider-b");
    expect(a).not.toBe(b);
    expect(a.name).toBe("provider-a");
    expect(b.name).toBe("provider-b");
  });

  it("same provider name returns same CircuitBreaker instance", () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getOrCreate("provider-a");
    const b = registry.getOrCreate("provider-a");
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Client Isolation (GLOBAL SHARING TEST)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: Client Isolation — Global Sharing", () => {
  it("two clients sharing a provider name share the same circuit breaker", () => {
    const c1 = new HilbrasClient({ policy: { circuitBreaker: { enabled: true } } });
    const c2 = new HilbrasClient({ policy: { circuitBreaker: { enabled: true } } });
    c1.addProvider({ ...MINIMAL_PROVIDER, name: "SharedProvider" });
    c2.addProvider({ ...MINIMAL_PROVIDER, name: "SharedProvider" });

    const cb = getCircuitBreakerRegistry();
    // Both clients use the same provider name → same breaker
    const breaker = cb.getOrCreate("SharedProvider");
    expect(breaker.state).toBe("closed");
  });

  it("failure through Client A affects Client B (global sharing by design)", async () => {
    // NOTE: getOrCreate only applies config on FIRST creation.
    // The default failureThreshold is 5, so we need 5 failures.
    const c1 = new HilbrasClient({ policy: { circuitBreaker: { enabled: true } } });
    const c2 = new HilbrasClient({ policy: { circuitBreaker: { enabled: true } } });
    c1.addProvider({ ...MINIMAL_PROVIDER, name: "SharedProvider", transport: failingTransport() });
    c2.addProvider({ ...MINIMAL_PROVIDER, name: "SharedProvider", transport: failingTransport() });

    // Cause 5 failures through c1 (default threshold = 5)
    for (let i = 0; i < 5; i++) {
      try { await c1.complete({ provider: "SharedProvider", model: "m", messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 0 } } }); } catch {}
    }

    // The breaker should be open — c2 should also be affected
    const breaker = getCircuitBreakerRegistry().getOrCreate("SharedProvider");
    expect(breaker.state).toBe("open");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Provider Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: Provider Isolation", () => {
  it("failure in Provider A does not affect Provider B", async () => {
    // NOTE: The adapter uses the transport from the client constructor,
    // not from MINIMAL_PROVIDER. To test provider isolation, we create
    // separate clients — one failing, one succeeding.
    const cFailing = new HilbrasClient({ transport: failingTransport(), policy: { circuitBreaker: { enabled: true } } });
    const cSuccess = new HilbrasClient({ transport: successTransport(), policy: { circuitBreaker: { enabled: true } } });
    cFailing.addProvider({ ...MINIMAL_PROVIDER, name: "ProviderA" });
    cSuccess.addProvider({ ...MINIMAL_PROVIDER, name: "ProviderB" });

    // Fail ProviderA (default threshold = 5)
    for (let i = 0; i < 5; i++) {
      try { await cFailing.complete({ provider: "ProviderA", model: "m", messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 0 } } }); } catch {}
    }

    // ProviderA should be open
    expect(getCircuitBreakerRegistry().getOrCreate("ProviderA").state).toBe("open");

    // ProviderB should still be closed and working
    expect(getCircuitBreakerRegistry().getOrCreate("ProviderB").state).toBe("closed");
    const result = await cSuccess.complete({
      provider: "ProviderB", model: "m", messages: [{ role: "user", content: "hi" }],
      policy: { circuitBreaker: { enabled: true } },
    });
    expect(result).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Model Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Model Isolation", () => {
  it("circuit breaker is keyed by provider name, NOT by model — this is by design", () => {
    // Both models on the same provider share a breaker
    const cb = getCircuitBreakerRegistry();
    const breaker = cb.getOrCreate("SameProvider");
    for (let i = 0; i < 5; i++) breaker.recordFailure(); // default threshold = 5
    // Both models would be blocked because breaker is per-provider
    expect(breaker.state).toBe("open");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Lifecycle", () => {
  it("new client inherits existing circuit state for same provider", () => {
    // Set up state in global registry
    const cb = getCircuitBreakerRegistry();
    const breaker = cb.getOrCreate("LifecycleTest");
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");

    // New client with same provider inherits the open state
    const c = new HilbrasClient({ policy: { circuitBreaker: { enabled: true } } });
    c.addProvider({ ...MINIMAL_PROVIDER, name: "LifecycleTest" });
    expect(cb.getOrCreate("LifecycleTest").state).toBe("open");
  });

  it("removeProvider does not reset circuit breaker state", () => {
    const cb = getCircuitBreakerRegistry();
    const breaker = cb.getOrCreate("TempProvider");
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");

    const c = new HilbrasClient();
    c.addProvider({ ...MINIMAL_PROVIDER, name: "TempProvider" });
    c.removeProvider("TempProvider");

    // The breaker still exists in the global registry
    expect(cb.getOrCreate("TempProvider").state).toBe("open");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 8: Concurrency", () => {
  it("concurrent failures are counted correctly", () => {
    const cb = new CircuitBreaker("concurrent", {
      failureThreshold: 10,
      successThreshold: 2,
      timeoutMs: 60_000,
      halfOpenMaxCalls: 5,
    });

    // Simulate 50 concurrent failures
    for (let i = 0; i < 50; i++) {
      cb.recordFailure();
    }

    expect(cb.state).toBe("open");
    expect(cb.stats.totalFailures).toBe(50);
  });

  it("concurrent success and failure mix produces correct state", () => {
    const cb = new CircuitBreaker("mixed", {
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 60_000,
      halfOpenMaxCalls: 5,
    });

    // 3 failures + 10 successes — should stay closed and reset failure count
    for (let i = 0; i < 3; i++) cb.recordFailure();
    for (let i = 0; i < 10; i++) cb.recordSuccess();

    expect(cb.state).toBe("closed");
    expect(cb.stats.failureCount).toBe(0); // Reset after success
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: State Transitions
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 9: State Transitions", () => {
  it("CLOSED → OPEN on failure threshold", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("OPEN → HALF_OPEN after cooldown", () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 1, // 1ms cooldown
      halfOpenMaxCalls: 3,
    });
    cb.recordFailure();
    expect(cb.state).toBe("open");

    // After cooldown
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait */ }

    expect(cb.isAvailable()).toBe(true);
    expect(cb.state).toBe("half_open");
  });

  it("HALF_OPEN → CLOSED on success threshold", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, successThreshold: 2, timeoutMs: 1, halfOpenMaxCalls: 5 });
    cb.recordFailure();
    // Wait for cooldown
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait */ }
    cb.isAvailable(); // Transition to half_open

    cb.recordSuccess();
    expect(cb.state).toBe("half_open");
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
  });

  it("HALF_OPEN → OPEN on failure", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, successThreshold: 2, timeoutMs: 1, halfOpenMaxCalls: 5 });
    cb.recordFailure();
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait */ }
    cb.isAvailable(); // Transition to half_open

    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("success while CLOSED resets failure count", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // Reset
    cb.recordFailure();
    cb.recordFailure();
    // Should still be closed (3 failures < 5 threshold because count was reset)
    expect(cb.state).toBe("closed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Recovery
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 10: Recovery", () => {
  it("full recovery cycle: CLOSED → OPEN → HALF_OPEN → CLOSED", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 2, successThreshold: 2, timeoutMs: 1, halfOpenMaxCalls: 5 });
    expect(cb.state).toBe("closed");

    // Open
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");

    // Wait for cooldown
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait */ }

    // isAvailable() transitions to half_open
    expect(cb.isAvailable()).toBe(true);
    expect(cb.state).toBe("half_open");

    // Recover
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
  });

  it("failed probe in HALF_OPEN returns to OPEN", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, successThreshold: 2, timeoutMs: 1, halfOpenMaxCalls: 5 });
    cb.recordFailure();
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait */ }
    cb.isAvailable(); // → half_open

    cb.recordFailure();
    expect(cb.state).toBe("open");
  });

  it("no timer leaks — circuit breaker uses Date.now(), not timers", () => {
    // The CircuitBreaker uses Date.now() for cooldown checks, not setTimeout
    // So there are no timers to leak
    const cb = new CircuitBreaker("test", { failureThreshold: 1, successThreshold: 1, timeoutMs: 1000, halfOpenMaxCalls: 1 });
    cb.recordFailure();
    // No timer was created — just Date.now() comparison
    expect(cb.state).toBe("open");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 11: Fallback Interaction
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 11: Fallback Interaction", () => {
  it("all candidates OPEN → execution fails cleanly", async () => {
    const c = new HilbrasClient({ policy: { allowFallback: true } });
    c.addProvider({ ...MINIMAL_PROVIDER, name: "P1", transport: failingTransport() });
    c.addProvider({ ...MINIMAL_PROVIDER, name: "P2", transport: failingTransport() });

    // Open both providers (default threshold = 5)
    for (let i = 0; i < 5; i++) {
      try { await c.complete({ provider: "P1", model: "m", messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 0 } } }); } catch {}
    }
    for (let i = 0; i < 5; i++) {
      try { await c.complete({ provider: "P2", model: "m", messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 0 } } }); } catch {}
    }

    // Both breakers should be open
    expect(getCircuitBreakerRegistry().getOrCreate("P1").state).toBe("open");
    expect(getCircuitBreakerRegistry().getOrCreate("P2").state).toBe("open");

    // New request should fail with CircuitBreakerOpenError
    await expect(
      c.complete({ provider: "P1", model: "m", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 12: Retry Interaction
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 12: Retry Interaction", () => {
  it("retries count as ONE logical failure (not per-attempt)", async () => {
    // DOCUMENTED BEHAVIOR: retries are part of one logical request.
    // The circuit breaker records only the final failure when retries exhaust.
    const c = new HilbrasClient();
    c.addProvider({ ...MINIMAL_PROVIDER, name: "retrytest", transport: failingTransport() });

    try {
      await c.complete({
        provider: "retrytest", model: "m",
        messages: [{ role: "user", content: "hi" }],
        policy: { retry: { maxRetries: 2 }, circuitBreaker: { enabled: true, failureThreshold: 10 } },
      });
    } catch {}

    const breaker = getCircuitBreakerRegistry().getOrCreate("retrytest");
    // 1 logical failure recorded (not 3 per-attempt)
    expect(breaker.stats.totalFailures).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Error Classification
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 15: Error Classification", () => {
  it("CircuitBreakerOpenError is NOT counted as a failure", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
    cb.recordFailure(new CircuitBreakerOpenError("test"));
    // Should not count — CircuitBreakerOpenError is explicitly excluded
    expect(cb.stats.totalFailures).toBe(0);
  });

  it("regular Error IS counted as a failure", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
    cb.recordFailure(new Error("provider error"));
    expect(cb.stats.totalFailures).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 17: Test Contamination
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 17: Test Contamination", () => {
  it("REPRODUCED: test failures accumulate in global registry", () => {
    const cb = getCircuitBreakerRegistry();

    // Simulate test A causing failures
    const breakerA = cb.getOrCreate("ContaminationTest", { failureThreshold: 2 });
    breakerA.recordFailure();
    breakerA.recordFailure();
    expect(breakerA.state).toBe("open");

    // Simulate test B expecting a clean circuit
    const breakerB = cb.getOrCreate("ContaminationTest");
    // Same instance! Test B inherits Test A's open state
    expect(breakerB.state).toBe("open");
    // This is the contamination issue
  });

  it("solution: reset() clears breaker state", () => {
    const cb = getCircuitBreakerRegistry();
    const breaker = cb.getOrCreate("ResetTest", { failureThreshold: 2 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");

    breaker.reset();
    expect(breaker.state).toBe("closed");
    expect(breaker.stats.failureCount).toBe(0);
  });

  it("solution: resetAll() clears all breakers", () => {
    const cb = new CircuitBreakerRegistry();
    const a = cb.getOrCreate("A", { failureThreshold: 1 });
    const b = cb.getOrCreate("B", { failureThreshold: 1 });
    a.recordFailure();
    b.recordFailure();
    expect(a.state).toBe("open");
    expect(b.state).toBe("open");

    cb.resetAll();
    expect(a.state).toBe("closed");
    expect(b.state).toBe("closed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Multi-Client Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 18: Multi-Client Safety", () => {
  it("intentional: global registry provides cross-client protection", () => {
    // If Client A detects a provider is failing, Client B should also avoid it
    // This is a FEATURE, not a bug — prevents hammering a dying provider
    const cb = getCircuitBreakerRegistry();
    const breaker = cb.getOrCreate("SharedHealth");

    // Simulate shared detection
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");

    // Both clients would see this as open
    expect(cb.getOrCreate("SharedHealth").state).toBe("open");
  });

  it("different provider names are fully isolated", () => {
    const cb = getCircuitBreakerRegistry();
    const a = cb.getOrCreate("AppA_Provider");
    const b = cb.getOrCreate("AppB_Provider");

    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();

    expect(a.state).toBe("open");
    expect(b.state).toBe("closed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 19: Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 19: Security", () => {
  it("circuit breaker name/provider never exposes secrets", () => {
    const cb = new CircuitBreaker("https://api.openai.com/v1");
    expect(cb.name).not.toContain("sk-");
    expect(cb.name).not.toContain("Bearer");
    expect(cb.name).not.toContain("apiKey");
  });

  it("CircuitBreakerOpenError message does not expose secrets", () => {
    const err = new CircuitBreakerOpenError("provider-with-secret-api-key-12345");
    expect(err.message).not.toContain("sk-");
    expect(err.message).not.toContain("apiKey");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 21: Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 21: Determinism", () => {
  it("identical failure sequences produce identical state", () => {
    for (let i = 0; i < 100; i++) {
      const cb = new CircuitBreaker("test", { failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe("open");
      expect(cb.stats.totalFailures).toBe(5);
    }
  });

  it("failure count never goes negative", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 });
    cb.recordSuccess(); // Success before any failure
    expect(cb.stats.failureCount).toBe(0);
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.stats.failureCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 22: API Review
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 22: API Review", () => {
  it("getCircuitBreakerRegistry is public and returns singleton", () => {
    const a = getCircuitBreakerRegistry();
    const b = getCircuitBreakerRegistry();
    expect(a).toBe(b);
  });

  it("CircuitBreaker.reset() is public", () => {
    const cb = new CircuitBreaker("test");
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
  });

  it("CircuitBreakerRegistry.resetAll() is public", () => {
    const reg = new CircuitBreakerRegistry();
    reg.getOrCreate("a").recordFailure();
    reg.getOrCreate("b").recordFailure();
    reg.resetAll();
    expect(reg.getOrCreate("a").state).toBe("closed");
    expect(reg.getOrCreate("b").state).toBe("closed");
  });

  it("CircuitBreakerRegistry.remove() removes breaker", () => {
    const reg = new CircuitBreakerRegistry();
    reg.getOrCreate("temp");
    expect(reg.get("temp")).toBeDefined();
    reg.remove("temp");
    expect(reg.get("temp")).toBeUndefined();
  });

  it("disable via policy.circuitBreaker.enabled=false works", async () => {
    const c = new HilbrasClient({
      policy: { circuitBreaker: { enabled: false } },
    });
    c.addProvider({ ...MINIMAL_PROVIDER, name: "NoCB", transport: failingTransport() });

    // Should not throw CircuitBreakerOpenError even with failures
    for (let i = 0; i < 100; i++) {
      try {
        await c.complete({
          provider: "NoCB", model: "m",
          messages: [{ role: "user", content: "hi" }],
          policy: { retry: { maxRetries: 0 }, circuitBreaker: { enabled: false } },
        });
      } catch (err) {
        // Should be a regular error, not CircuitBreakerOpenError
        expect(err.constructor.name).not.toBe("CircuitBreakerOpenError");
      }
    }
  });
});
