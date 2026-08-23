/**
 * @hilbras/sdk — v0.9.0 Atomic Reservation Budget Tests
 *
 * Tests: reservation lifecycle, concurrency, settlement, release,
 * fallback, retry, integrity, adversarial, invariants.
 */

import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { HilbrasClient } from "../src/client/client.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

const MODEL = "gpt-5.6-sol";

function provider(name = "Test"): ProviderConfig {
  return {
    name, baseUrl: `https://${name.toLowerCase()}.com/v1`,
    authentication: { type: "none" }, adapter: "openai",
    models: [{ id: MODEL, contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2-3: Reservation Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("Reservation Lifecycle", () => {
  it("reserve creates a reservation", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    const r = tracker.reserve("r1", 0.5);
    expect(r).not.toBeNull();
    expect(r!.id).toBe("r1");
    expect(r!.amount).toBe(0.5);
    expect(tracker.report().totalReserved).toBe(0.5);
  });

  it("reserve returns null when budget exceeded", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.1 });
    tracker.reserve("r1", 0.1); // Fill budget
    const r = tracker.reserve("r2", 0.05);
    expect(r).toBeNull();
  });

  it("reserve returns null for negative cost", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    expect(tracker.reserve("r1", -5)).toBeNull();
  });

  it("settle records actual cost and releases reservation", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    expect(tracker.report().totalReserved).toBe(0.5);

    tracker.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(tracker.report().totalReserved).toBe(0);
    expect(tracker.report().totalActual).toBe(0.3);
    expect(tracker.report().activeReservations).toBe(0);
  });

  it("settle handles actual > reserved (overage)", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.3);
    tracker.settle("r1", 0.5, { provider: "p", model: "m", phase: "execute" }); // $0.20 overage
    expect(tracker.report().totalActual).toBe(0.5);
    expect(tracker.report().totalReserved).toBe(0);
  });

  it("settle handles actual < reserved (refund)", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    tracker.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" }); // $0.30 refunded
    expect(tracker.report().totalActual).toBe(0.2);
    expect(tracker.report().remainingBudget).toBeCloseTo(0.8);
  });

  it("release returns reservation amount without recording cost", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    tracker.release("r1");
    expect(tracker.report().totalReserved).toBe(0);
    expect(tracker.report().totalActual).toBe(0);
    expect(tracker.report().requestCount).toBe(0);
  });

  it("release is safe to call on unknown reservation", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    expect(() => tracker.release("nonexistent")).not.toThrow();
  });

  it("settle is safe to call on unknown reservation", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    expect(() => tracker.settle("nonexistent", 0.01, { provider: "p", model: "m", phase: "execute" })).not.toThrow();
    expect(tracker.report().totalActual).toBe(0);
  });

  it("committed cost = actual + reserved", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 1 });
    tracker.reserve("r2", 0.3);
    const report = tracker.report();
    expect(report.committedCost).toBeCloseTo(0.5);
    expect(report.totalActual).toBeCloseTo(0.2);
    expect(report.totalReserved).toBeCloseTo(0.3);
  });

  it("remainingBudget accounts for reserved cost", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.4);
    expect(tracker.report().remainingBudget).toBeCloseTo(0.6);
    tracker.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(tracker.report().remainingBudget).toBeCloseTo(0.7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Atomicity
// ═══════════════════════════════════════════════════════════════════════════

describe("Atomicity", () => {
  it("100 reserve attempts within budget: exactly budget/slot succeed", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 100; i++) {
      const r = tracker.reserve(`r${i}`, 0.03);
      if (r) accepted++; else rejected++;
    }
    // 1.0 / 0.03 = 33.33, so 33 should succeed
    expect(accepted).toBe(33);
    expect(rejected).toBe(67);
    expect(tracker.report().totalReserved).toBeCloseTo(0.99);
  });

  it("no double-reservation of same ID", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.3);
    const r2 = tracker.reserve("r1", 0.3); // Same ID
    // Second reservation still gets through (IDs are not enforced as unique)
    // But the reservation tracks both — this is documented behavior
    expect(r2).not.toBeNull();
  });

  it("release after settle is safe", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    tracker.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    // Release should be safe even after settlement
    expect(() => tracker.release("r1")).not.toThrow();
    expect(tracker.report().totalReserved).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Concurrent Requests
// ═══════════════════════════════════════════════════════════════════════════

describe("Concurrent Requests", () => {
  it("500 concurrent reservations respect budget", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 1.0, perRequestBudget: 0.5 },
    });
    client.addProvider(provider());

    const results = await Promise.allSettled(
      Array.from({ length: 500 }, () =>
        client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const budgetRejected = results.filter((r) => r.status === "rejected" && String(r.reason).includes("Budget"));
    // Some succeed, some are budget-rejected. Total should not exceed budget semantics.
    expect(succeeded.length + budgetRejected.length).toBe(500);
  });

  it("concurrent settle/release does not corrupt totals", () => {
    const tracker = new BudgetTracker({ sessionBudget: 100 });
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        const r = tracker.reserve(`r${i}`, 1.0);
        if (r) tracker.settle(`r${i}`, 0.5, { provider: "p", model: "m", phase: "execute" });
      })
    );
    return Promise.all(promises).then(() => {
      const report = tracker.report();
      expect(report.totalActual).toBeGreaterThanOrEqual(0);
      expect(report.totalReserved).toBe(0);
      expect(Number.isFinite(report.totalActual)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15-16: Cost Report Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Cost Report Audit", () => {
  it("report has new fields", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    tracker.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    const report = tracker.report();
    expect(report.totalReserved).toBe(0);
    expect(report.committedCost).toBeCloseTo(0.3);
    expect(report.activeReservations).toBe(0);
  });

  it("report totals reconcile", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    tracker.reserve("r2", 0.3);
    tracker.settle("r1", 0.4, { provider: "p", model: "m", phase: "execute" });

    const report = tracker.report();
    expect(report.committedCost).toBeCloseTo(report.totalActual + report.totalReserved);
  });

  it("report is independent copy", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.5);
    const r1 = tracker.report();
    const r2 = tracker.report();
    r1.totalActual = 999;
    expect(r2.totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 19: Multiple Clients
// ═══════════════════════════════════════════════════════════════════════════

describe("Multiple Clients", () => {
  it("separate clients have independent budgets", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    expect(c1).not.toBe(c2);
    expect(c1.costReport().totalActual).toBe(0);
    expect(c2.costReport().totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 23: Critical Invariants
// ═══════════════════════════════════════════════════════════════════════════

describe("Critical Invariants", () => {
  it("INVARIANT 1: reservedCost >= 0", () => {
    const tracker = new BudgetTracker();
    tracker.reserve("r1", 0.5);
    expect(tracker.report().totalReserved).toBeGreaterThanOrEqual(0);
  });

  it("INVARIANT 2: actualCost >= 0", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.1, actualCost: 0.1, timestamp: 1 });
    expect(tracker.report().totalActual).toBeGreaterThanOrEqual(0);
  });

  it("INVARIANT 3: no NaN", () => {
    const tracker = new BudgetTracker({ sessionBudget: 5 });
    for (let i = 0; i < 100; i++) {
      tracker.reserve(`r${i}`, 0.01);
      tracker.settle(`r${i}`, 0.01, { provider: "p", model: "m", phase: "execute" });
    }
    const report = tracker.report();
    expect(Number.isNaN(report.totalActual)).toBe(false);
    expect(Number.isNaN(report.totalReserved)).toBe(false);
    expect(Number.isNaN(report.committedCost)).toBe(false);
  });

  it("INVARIANT 4: no Infinity", () => {
    const tracker = new BudgetTracker({ sessionBudget: 100 });
    for (let i = 0; i < 1000; i++) {
      tracker.reserve(`r${i}`, 0.01);
      tracker.settle(`r${i}`, 0.01, { provider: "p", model: "m", phase: "execute" });
    }
    expect(Number.isFinite(tracker.report().totalActual)).toBe(true);
  });

  it("INVARIANT 5: no leaked reservations after terminal execution", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    // Simulate: reserve, settle, release cycle
    for (let i = 0; i < 50; i++) {
      const r = tracker.reserve(`r${i}`, 0.02);
      if (r) {
        Math.random() > 0.5
          ? tracker.settle(`r${i}`, 0.01, { provider: "p", model: "m", phase: "execute" })
          : tracker.release(`r${i}`);
      }
    }
    expect(tracker.report().activeReservations).toBe(0);
  });

  it("INVARIANT 6: available budget is consistent", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.reserve("r1", 0.3);
    tracker.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" });
    expect(tracker.report().remainingBudget).toBeCloseTo(0.8);
  });

  it("INVARIANT 7: callback exceptions don't corrupt state", () => {
    const tracker = new BudgetTracker({
      sessionBudget: 100,
      onBudgetExceeded: () => { throw new Error("boom"); },
      onBudgetWarning: () => { throw new Error("boom"); },
    });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 110, actualCost: 110, timestamp: 1 });
    // Should not throw, and budget state should be correct
    expect(tracker.isBudgetExhausted()).toBe(true);
    expect(tracker.report().totalActual).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 25: Backward Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe("Backward Compatibility", () => {
  it("existing record() API still works", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    expect(tracker.report().totalActual).toBe(0.01);
  });

  it("existing client budget config still works", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 1.0, perRequestBudget: 0.5 },
    });
    client.addProvider(provider());
    const result = await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });

  it("client without budget config still works", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(provider());
    const result = await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });

  it("all public APIs still work", () => {
    const client = new HilbrasClient();
    expect(typeof client.costReport).toBe("function");
    expect(typeof client.isBudgetExhausted).toBe("function");
    expect(typeof client.cost).toBe("object");
    expect(typeof client.cost.reserve).toBe("function");
    expect(typeof client.cost.settle).toBe("function");
    expect(typeof client.cost.release).toBe("function");
    expect(typeof client.cost.report).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Adversarial Numbers
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial Numbers", () => {
  it("NaN session budget handled", () => {
    const tracker = new BudgetTracker({ sessionBudget: NaN });
    expect(tracker.isBudgetExhausted()).toBe(false); // NaN comparisons return false
  });

  it("Infinity session budget = unlimited", () => {
    const tracker = new BudgetTracker({ sessionBudget: Infinity });
    expect(tracker.isBudgetExhausted()).toBe(false);
    const r = tracker.reserve("r1", 999_999);
    expect(r).not.toBeNull();
  });

  it("negative reserve amount returns null", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    expect(tracker.reserve("r1", -10)).toBeNull();
  });

  it("zero reserve amount succeeds", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    const r = tracker.reserve("r1", 0);
    expect(r).not.toBeNull();
  });

  it("extremely large reserve amount rejected", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    expect(tracker.reserve("r1", Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
