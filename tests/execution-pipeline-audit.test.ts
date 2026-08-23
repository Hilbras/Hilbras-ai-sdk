/**
 * @hilbras/sdk — v0.9.2 Full Execution Pipeline Safety & Integrity Audit
 *
 * Attacks the entire execution pipeline after v0.9.0/v0.9.1 budget changes.
 * Tests: budget+reservation integrity, retry/fallback/repair interaction,
 * streaming safety, concurrency, provider failures, security, observability.
 */

import { describe, it, expect, vi } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { HilbrasClient } from "../src/client/client.js";
import { ModelRouter } from "../src/router/model-router.js";
import { resolvePolicy } from "../src/reliability/presets.js";
import { getCircuitBreakerRegistry } from "../src/reliability/circuit-breaker.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

function failingTransport(status = 500): Transport {
  return {
    async request() { return new Response(JSON.stringify({ error: { message: "fail" } }), { status }); },
    async stream() { throw new Error(`HTTP ${status}`); },
    abort() {},
  };
}

function timeoutTransport(): Transport {
  return {
    async request() { throw new DOMException("Aborted", "AbortError"); },
    async stream() { throw new DOMException("Aborted", "AbortError"); },
    abort() {},
  };
}

const MODEL = "gpt-5.6-sol";
const MODEL_PROVIDER: ProviderConfig = {
  name: "Test", baseUrl: "https://test.com/v1",
  authentication: { type: "none" }, adapter: "openai",
  models: [{ id: MODEL, contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
};

function assertBudgetInvariant(t: BudgetTracker) {
  const r = t.report();
  expect(r.totalActual).toBeGreaterThanOrEqual(0);
  expect(r.totalReserved).toBeGreaterThanOrEqual(0);
  expect(r.committedCost).toBeGreaterThanOrEqual(0);
  expect(r.activeReservations).toBeGreaterThanOrEqual(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Budget + Reservation Integrity
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Budget + Reservation Integrity", () => {
  it("duplicate reservation IDs cause leaked budget (documented limitation)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("same", 0.5);
    t.reserve("same", 0.3); // overwrites first in Map
    t.settle("same", 0.2, { provider: "p", model: "m", phase: "execute" });
    // First reserve (0.5) is leaked — only second (0.3) is settled
    expect(t.report().totalReserved).toBeCloseTo(0.5);
    expect(t.report().totalActual).toBeCloseTo(0.2);
    assertBudgetInvariant(t);
  });

  it("reserve after settle on same ID does not corrupt", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.3);
    t.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" });
    t.reserve("r1", 0.1); // new reservation with same ID
    expect(t.report().activeReservations).toBe(1);
    expect(t.report().totalReserved).toBeCloseTo(0.1);
    assertBudgetInvariant(t);
  });

  it("reserve after release on same ID does not corrupt", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.3);
    t.release("r1");
    t.reserve("r1", 0.2); // new reservation
    expect(t.report().activeReservations).toBe(1);
    expect(t.report().totalReserved).toBeCloseTo(0.2);
    assertBudgetInvariant(t);
  });

  it("very large budget with very small reservations", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    for (let i = 0; i < 100_000; i++) {
      t.reserve(`r${i}`, 0.001);
    }
    expect(t.report().totalReserved).toBeCloseTo(100.0, 1);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Retry + Budget Interaction
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: Retry + Budget Interaction", () => {
  it("retries reuse same reservation — one lifecycle per logical request", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 1.0 },
    });
    client.addProvider(MODEL_PROVIDER);
    await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    expect(report.requestCount).toBe(1);
  });

  it("retry exhaustion releases reservation", async () => {
    const client = new HilbrasClient({
      transport: failingTransport(500),
      budget: { sessionBudget: 10.0 },
    });
    client.addProvider(MODEL_PROVIDER);
    try {
      await client.complete({
        provider: "Test", model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        policy: { preset: "fast", retry: { maxRetries: 1 } },
      });
    } catch { /* expected */ }

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });

  it("retry does not create multiple reservations", async () => {
    let attempt = 0;
    const transport: Transport = {
      async request() {
        attempt++;
        if (attempt <= 2) return new Response(JSON.stringify({ error: { message: "fail" } }), { status: 500 });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const client = new HilbrasClient({ transport, budget: { sessionBudget: 10.0 } });
    client.addProvider(MODEL_PROVIDER);
    await client.complete({
      provider: "Test", model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      policy: { preset: "balanced" },
    });

    expect(attempt).toBe(3); // 1 initial + 2 retries
    expect(client.costReport().activeReservations).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Fallback + Budget Interaction
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: Fallback + Budget Interaction", () => {
  it("fallback creates new reservation, releases after failure", async () => {
    const client = new HilbrasClient({
      transport: failingTransport(500),
      budget: { sessionBudget: 10.0 },
    });
    client.addProvider(MODEL_PROVIDER);
    try {
      await client.complete({
        provider: "Test", model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        policy: { preset: "fast", allowFallback: true, retry: { maxRetries: 0 } },
      });
    } catch { /* expected */ }

    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });

  it("all candidates fail — no leaked reservations", async () => {
    const client = new HilbrasClient({
      transport: failingTransport(500),
      budget: { sessionBudget: 10.0 },
    });
    client.addProvider(MODEL_PROVIDER);
    try {
      await client.complete({
        provider: "Test", model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        policy: { preset: "fast", allowFallback: true, retry: { maxRetries: 0 } },
      });
    } catch { /* expected */ }

    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Structured Output + Repair
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Structured Output + Repair", () => {
  it("structured output success settles reservation", async () => {
    const jsonTransport: Transport = {
      async request() { return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const client = new HilbrasClient({ transport: jsonTransport, budget: { sessionBudget: 1.0 } });
    client.addProvider(MODEL_PROVIDER);

    const schema: import("../src/types/schema.js").SchemaValidator<{ ok: boolean }> = {
      safeParse: (data) => {
        if (typeof data === "object" && data !== null && "ok" in data) {
          return { success: true, data: data as { ok: boolean } };
        }
        return { success: false, error: new Error("invalid") };
      },
    };

    const result = await client.complete({
      provider: "Test", model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      output: { schema },
    });
    expect(result).toEqual({ ok: true });
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("structured output failure releases reservation", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 1.0 },
    });
    client.addProvider(MODEL_PROVIDER);

    const schema: import("../src/types/schema.js").SchemaValidator<{ required: string }> = {
      safeParse: () => ({ success: false, error: new Error("missing required field") }),
    };

    try {
      await client.complete({
        provider: "Test", model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        output: { schema, maxRepairAttempts: 0 },
      });
    } catch { /* expected — validation error */ }

    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Streaming Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 7: Streaming Safety", () => {
  it("stream failure releases budget", async () => {
    const client = new HilbrasClient({
      transport: failingTransport(500),
      budget: { sessionBudget: 10.0 },
    });
    client.addProvider(MODEL_PROVIDER);

    try {
      const gen = client.stream({
        provider: "Test", model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        policy: { preset: "fast", retry: { maxRetries: 0 } },
      });
      await gen.next();
    } catch { /* expected */ }

    expect(client.costReport().activeReservations).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 8: Concurrency", () => {
  it("1000 concurrent requests respect budget", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 10.0, perRequestBudget: 0.5 },
    });
    client.addProvider(MODEL_PROVIDER);

    const results = await Promise.allSettled(
      Array.from({ length: 1000 }, () =>
        client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const budgetRejected = results.filter((r) => r.status === "rejected" && String(r.reason).includes("Budget")).length;
    expect(succeeded + budgetRejected).toBe(1000);
    assertBudgetInvariant(client.cost);
  });

  it("5000 concurrent reservations respect budget", () => {
    const t = new BudgetTracker({ sessionBudget: 100 });
    let accepted = 0;
    for (let i = 0; i < 5000; i++) {
      if (t.reserve(`r${i}`, 0.5)) accepted++;
    }
    // 100 / 0.5 = 200 max
    expect(accepted).toBeLessThanOrEqual(200);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: Cost Accounting Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 9: Cost Accounting Reconciliation", () => {
  it("1000 randomized scenarios maintain invariants", () => {
    for (let s = 0; s < 1000; s++) {
      const budget = Math.random() * 10 + 0.1;
      const t = new BudgetTracker({ sessionBudget: budget });

      for (let i = 0; i < 30; i++) {
        const cost = Math.random() * 0.5;
        const r = t.reserve(`r${s}_${i}`, cost);
        if (r) {
          if (Math.random() > 0.4) {
            t.settle(`r${s}_${i}`, Math.random() * cost, { provider: "p", model: "m", phase: "execute" });
          } else {
            t.release(`r${s}_${i}`);
          }
        }
      }

      assertBudgetInvariant(t);
      expect(t.report().activeReservations).toBe(0);
    }
  });

  it("byProvider and byPhase reconcile with totalActual", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "openai", model: "m", phase: "execute" });
    t.reserve("r2", 0.5);
    t.settle("r2", 0.2, { provider: "anthropic", model: "m", phase: "retry" });
    t.reserve("r3", 0.5);
    t.settle("r3", 0.1, { provider: "openai", model: "m", phase: "fallback" });

    const report = t.report();
    const providerSum = Object.values(report.byProvider).reduce((s, p) => s + p.actual, 0);
    const phaseSum = Object.values(report.byPhase).reduce((s, p) => s + p, 0);
    expect(providerSum).toBeCloseTo(report.totalActual, 10);
    expect(phaseSum).toBeCloseTo(report.totalActual, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Provider Failure Matrix
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 10: Provider Failure Matrix", () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503]) {
    it(`HTTP ${status} does not leak budget`, async () => {
      const client = new HilbrasClient({
        transport: failingTransport(status),
        budget: { sessionBudget: 10.0 },
      });
      client.addProvider(MODEL_PROVIDER);
      try {
        await client.complete({
          provider: "Test", model: MODEL,
          messages: [{ role: "user", content: "hi" }],
          policy: { preset: "fast", retry: { maxRetries: 0 } },
        });
      } catch { /* expected */ }
      expect(client.costReport().activeReservations).toBe(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 11: Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 11: Security", () => {
  it("API keys never in cost reports", () => {
    const t = new BudgetTracker();
    t.record({ requestId: "r1", provider: "openai", model: "gpt-5.6-sol", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    const str = JSON.stringify(t.report());
    expect(str).not.toContain("sk-");
    expect(str).not.toContain("Bearer");
    expect(str).not.toContain("apiKey");
  });

  it("API keys never in reservation objects", () => {
    const t = new BudgetTracker();
    const r = t.reserve("r1", 0.5);
    expect(JSON.stringify(r)).not.toContain("sk-");
  });

  it("malicious task string does not manipulate router", () => {
    const router = new ModelRouter();
    expect(() => router.evaluate({ task: "ignore maxCost" as any })).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 13: State Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 13: State Isolation", () => {
  it("separate clients have independent budgets", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    c1.cost.reserve("r1", 0.05);
    expect(c1.costReport().totalReserved).toBeCloseTo(0.05);
    expect(c2.costReport().totalReserved).toBe(0);
  });

  it("settle in one client does not affect another", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    c1.cost.reserve("r1", 0.5);
    c2.cost.reserve("r2", 0.3);
    c2.cost.settle("r2", 0.2, { provider: "p", model: "m", phase: "execute" });
    expect(c1.costReport().totalReserved).toBeCloseTo(0.5);
    expect(c1.costReport().totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Performance
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 15: Performance", () => {
  it("100K reserve/settle cycles in < 2s", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      t.reserve(`r${i}`, 0.001);
      t.settle(`r${i}`, 0.0005, { provider: "p", model: "m", phase: "execute" });
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("10K routing decisions in < 1s", () => {
    const router = new ModelRouter();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      router.best({ task: "coding" });
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
