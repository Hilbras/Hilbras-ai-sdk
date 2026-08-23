/**
 * @hilbras/sdk — v0.9.1/v0.9.2 Deep Reservation Audit
 *
 * Adversarial tests attacking the atomic reservation system.
 * Goal: can any sequence of calls cause incorrect financial accounting?
 */

import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { HilbrasClient } from "../src/client/client.js";
import type { Transport } from "../src/transport/transport.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

const MODEL = "gpt-5.6-sol";

function provider(name = "Test"): { name: string; baseUrl: string; authentication: { type: "none" }; adapter: "openai"; models: Array<{ id: string; contextWindow: number; capabilities: { streaming: boolean; tools: boolean; vision: boolean; reasoning: boolean; structuredOutput: boolean; parallelTools: boolean; systemPrompts: boolean } }> } {
  return {
    name, baseUrl: `https://${name.toLowerCase()}.com/v1`,
    authentication: { type: "none" }, adapter: "openai",
    models: [{ id: MODEL, contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
  };
}

/** Assert budget invariants hold */
function assertBudgetInvariant(tracker: BudgetTracker) {
  const r = tracker.report();
  expect(r.totalActual).toBeGreaterThanOrEqual(0);
  expect(r.totalReserved).toBeGreaterThanOrEqual(0);
  expect(r.committedCost).toBeGreaterThanOrEqual(0);
  expect(r.activeReservations).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(r.totalActual)).toBe(true);
  expect(Number.isFinite(r.totalReserved)).toBe(true);
  expect(Number.isFinite(r.committedCost)).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Reservation Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Reservation Lifecycle", () => {
  it("reserve → settle completes lifecycle", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.4, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBeCloseTo(0.4);
    expect(t.report().totalReserved).toBe(0);
  });

  it("reserve → release completes lifecycle", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBe(0);
    expect(t.report().totalReserved).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Double Settlement
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: Double Settlement", () => {
  it("double settle does not double-count actual cost", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" }); // double settle
    // Second settle is harmless — reservation already removed
    expect(t.report().totalActual).toBeCloseTo(0.3); // NOT 0.6
    expect(t.report().totalReserved).toBe(0);
    assertBudgetInvariant(t);
  });

  it("double settle does not corrupt remaining budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    const beforeSecond = t.report().remainingBudget;
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().remainingBudget).toBe(beforeSecond);
  });

  it("double settle with random values is safe", () => {
    for (let i = 0; i < 100; i++) {
      const t = new BudgetTracker({ sessionBudget: 10.0 });
      t.reserve("r1", 1.0);
      t.settle("r1", Math.random(), { provider: "p", model: "m", phase: "execute" });
      t.settle("r1", Math.random(), { provider: "p", model: "m", phase: "execute" });
      assertBudgetInvariant(t);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Double Release
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: Double Release", () => {
  it("double release does not corrupt budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    const afterFirst = t.report().totalReserved;
    t.release("r1"); // double release
    expect(t.report().totalReserved).toBe(afterFirst); // unchanged
    assertBudgetInvariant(t);
  });

  it("double release does not create negative reserved", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    t.release("r1");
    expect(t.report().totalReserved).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Settle After Release
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Settle After Release", () => {
  it("settle after release does not create phantom spending", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    const before = t.report().totalActual;
    t.settle("r1", 0.25, { provider: "p", model: "m", phase: "execute" });
    // Should be harmless — reservation already released
    expect(t.report().totalActual).toBe(before);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Release After Settle
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Release After Settle", () => {
  it("release after settle cannot refund twice", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    const before = t.report().remainingBudget;
    t.release("r1"); // harmless
    expect(t.report().remainingBudget).toBe(before);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Reservation ID Collision
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 7: Reservation ID Collision", () => {
  it("same ID used twice — second reserve rejected, accounting invariant preserved", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("same-id", 0.5);
    const second = t.reserve("same-id", 0.3); // rejected
    expect(second).toBeNull();
    // First reservation remains intact
    t.settle("same-id", 0.2, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBeCloseTo(0.2);
    expect(t.report().totalReserved).toBe(0);
    assertBudgetInvariant(t);
  });

  it("empty string ID works", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("", 0.5);
    t.settle("", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBeCloseTo(0.3);
  });

  it("very long ID works", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    const longId = "x".repeat(10_000);
    t.reserve(longId, 0.5);
    t.settle(longId, 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBeCloseTo(0.3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: Negative / Invalid Reservations
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 8: Negative / Invalid Reservations", () => {
  it("negative amount returns null", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("r1", -1)).toBeNull();
  });

  it("zero amount succeeds", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("r1", 0)).not.toBeNull();
  });

  it("NaN amount returns null", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("r1", NaN)).toBeNull();
  });

  it("Infinity amount returns null", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("r1", Infinity)).toBeNull();
  });

  it("MAX_SAFE_INTEGER returns null when exceeds budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("r1", Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: Actual Cost Attacks
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 9: Actual Cost Attacks", () => {
  it("settle with negative cost does not corrupt totals", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", -100, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
  });

  it("settle with NaN cost does not corrupt totals", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", NaN, { provider: "p", model: "m", phase: "execute" });
    const report = t.report();
    expect(Number.isNaN(report.totalActual)).toBe(false);
    assertBudgetInvariant(t);
  });

  it("settle with Infinity cost: budget is exhausted, state is consistent", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", Infinity, { provider: "p", model: "m", phase: "execute" });
    // Infinity >= 1.0 → budget exhausted (correct behavior)
    expect(t.isBudgetExhausted()).toBe(true);
    assertBudgetInvariant(t);
  });

  it("settle with huge cost does not break", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    t.reserve("r1", 0.5);
    t.settle("r1", 999_999, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Over-Settlement
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 10: Over-Settlement", () => {
  it("actual cost > reservation: budget accounting correct", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.4);
    t.settle("r1", 0.9, { provider: "p", model: "m", phase: "execute" }); // $0.50 overage
    expect(t.report().totalActual).toBeCloseTo(0.9);
    expect(t.report().totalReserved).toBe(0);
    assertBudgetInvariant(t);
  });

  it("over-settlement does not corrupt budget state", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.8, { provider: "p", model: "m", phase: "execute" }); // $0.30 overage
    // Budget accounting remains consistent even with overage
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBeCloseTo(0.8);
    expect(t.report().totalReserved).toBe(0);
  });

  it("future reservations respect committed cost after overage", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.9, { provider: "p", model: "m", phase: "execute" }); // $0.90 actual
    // Only $0.10 remains
    expect(t.reserve("r2", 0.2)).toBeNull(); // rejected
    expect(t.reserve("r3", 0.1)).not.toBeNull(); // fits in remaining $0.10
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 11: Under-Settlement
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 11: Under-Settlement", () => {
  it("actual cost < reservation: budget refunded", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().remainingBudget).toBeCloseTo(0.8);
  });

  it("1000 random settle/release cycles reconcile", () => {
    const t = new BudgetTracker({ sessionBudget: 100.0 });
    for (let i = 0; i < 1000; i++) {
      const amt = Math.random() * 0.1;
      const r = t.reserve(`r${i}`, amt);
      if (r) {
        if (Math.random() > 0.3) {
          t.settle(`r${i}`, Math.random() * amt, { provider: "p", model: "m", phase: "execute" });
        } else {
          t.release(`r${i}`);
        }
      }
    }
    assertBudgetInvariant(t);
    expect(t.report().activeReservations).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 12: Concurrent Reservations
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 12: Concurrent Reservations", () => {
  it("1000 concurrent reserve calls respect budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
      if (t.reserve(`r${i}`, 0.02)) accepted++;
    }
    // 1.0 / 0.02 = 50 max
    expect(accepted).toBeLessThanOrEqual(50);
    assertBudgetInvariant(t);
  });

  it("100 concurrent reserve + settle cycles", async () => {
    const t = new BudgetTracker({ sessionBudget: 100 });
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        const r = t.reserve(`r${i}`, 0.5);
        if (r) t.settle(`r${i}`, 0.3, { provider: "p", model: "m", phase: "execute" });
      })
    );
    await Promise.all(promises);
    assertBudgetInvariant(t);
    expect(t.report().activeReservations).toBe(0);
  });

  it("1000 test runs with 100 concurrent reservations each", () => {
    for (let run = 0; run < 1000; run++) {
      const t = new BudgetTracker({ sessionBudget: 1.0 });
      let accepted = 0;
      for (let i = 0; i < 100; i++) {
        if (t.reserve(`r${i}`, 0.03)) accepted++;
      }
      expect(accepted).toBeLessThanOrEqual(34);
      assertBudgetInvariant(t);
    }
  });

  it("mixed costs under concurrency", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    const costs = [0.01, 0.05, 0.10, 0.20, 0.50];
    let totalReserved = 0;
    for (let i = 0; i < 200; i++) {
      const cost = costs[i % costs.length];
      const r = t.reserve(`r${i}`, cost);
      if (r) totalReserved += cost;
    }
    expect(totalReserved).toBeLessThanOrEqual(1.0);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 13: Floating Point Attacks
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 13: Floating Point Attacks", () => {
  it("0.1 + 0.2 floating point: second reserve correctly rejected", () => {
    const t = new BudgetTracker({ sessionBudget: 0.3 });
    expect(t.reserve("r1", 0.1)).not.toBeNull();
    // 0.1 + 0.2 = 0.30000000000000004 in JS — correctly > 0.3, so rejected
    expect(t.reserve("r2", 0.2)).toBeNull();
  });

  it("repeated 0.1 additions don't bypass budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    let accepted = 0;
    for (let i = 0; i < 20; i++) {
      if (t.reserve(`r${i}`, 0.1)) accepted++;
    }
    // Should be exactly 10 (1.0 / 0.1)
    expect(accepted).toBe(10);
  });

  it("settling with floating point values", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.3);
    t.settle("r1", 0.1 + 0.2, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 14: Retry Accounting
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 14: Retry Accounting", () => {
  it("retries reuse same reservation (one lifecycle)", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 1.0 },
    });
    client.addProvider(provider());

    await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    expect(report.totalReserved).toBe(0);
  });

  it("after failed retries, reservation released", async () => {
    const client = new HilbrasClient({
      transport: { async request() { throw new TypeError("fail"); }, async stream() { throw new Error("unused"); }, abort() {} },
      budget: { sessionBudget: 1.0 },
    });
    client.addProvider(provider());

    try {
      await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 2 } } });
    } catch { /* expected */ }

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    expect(report.totalReserved).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Fallback Accounting
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 15: Fallback Accounting", () => {
  it("after failure with fallback attempts, no leaked reservations", async () => {
    const failingTransport: Transport = {
      async request() { return new Response(JSON.stringify({ error: { message: "fail" } }), { status: 500 }); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const client = new HilbrasClient({ transport: failingTransport, budget: { sessionBudget: 10.0 } });
    client.addProvider(provider("FailProvider"));

    try {
      await client.complete({ provider: "FailProvider", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { preset: "fast", retry: { maxRetries: 0 } } });
    } catch { /* expected */ }

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 22: Client Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 22: Client Isolation", () => {
  it("separate clients have independent reservations", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });

    c1.cost.reserve("r1", 0.05);
    expect(c1.costReport().totalReserved).toBeCloseTo(0.05);
    expect(c2.costReport().totalReserved).toBe(0);
  });

  it("settle in client B does not affect client A", () => {
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
// PHASE 24: Memory / Leak Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 24: Memory / Leak Audit", () => {
  it("terminal reservations are removed", () => {
    const t = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 1000; i++) {
      t.reserve(`r${i}`, 0.01);
      t.settle(`r${i}`, 0.005, { provider: "p", model: "m", phase: "execute" });
    }
    expect(t.report().activeReservations).toBe(0);
    expect(t.reservations()).toHaveLength(0);
  });

  it("released reservations are removed", () => {
    const t = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 1000; i++) {
      t.reserve(`r${i}`, 0.01);
      t.release(`r${i}`);
    }
    expect(t.report().activeReservations).toBe(0);
  });

  it("reset clears all reservations", () => {
    const t = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 100; i++) t.reserve(`r${i}`, 0.01);
    t.reset();
    expect(t.report().activeReservations).toBe(0);
    expect(t.reservations()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 25: Security Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 25: Security Audit", () => {
  it("reservation objects contain no secrets", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    const r = t.reserve("r1", 0.5);
    const str = JSON.stringify(r);
    expect(str).not.toContain("sk-");
    expect(str).not.toContain("apiKey");
    expect(str).not.toContain("Bearer");
  });

  it("cost reports contain no secrets", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "openai", model: "gpt-5.6-sol", phase: "execute" });
    const str = JSON.stringify(t.report());
    expect(str).not.toContain("sk-");
    expect(str).not.toContain("apiKey");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 26: API Abuse
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 26: API Abuse", () => {
  it("rapid reserve/settle/release cycles", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    for (let i = 0; i < 10000; i++) {
      t.reserve(`r${i}`, 0.0001);
      t.settle(`r${i}`, 0.00005, { provider: "p", model: "m", phase: "execute" });
    }
    assertBudgetInvariant(t);
    expect(t.report().activeReservations).toBe(0);
  });

  it("alternating reserve/release", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    for (let i = 0; i < 1000; i++) {
      t.reserve(`r${i}`, 0.1);
      t.release(`r${i}`);
    }
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBe(0);
  });

  it("record() still works alongside reservations", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.record({ requestId: "legacy", provider: "p", model: "m", phase: "execute", estimatedCost: 0.1, actualCost: 0.1, timestamp: 1 });
    t.reserve("r1", 0.3);
    t.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBeCloseTo(0.3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 27: Cost Report Reconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 27: Cost Report Reconciliation", () => {
  it("byProvider sums match totalActual", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "openai", model: "m", phase: "execute" });
    t.reserve("r2", 0.5);
    t.settle("r2", 0.2, { provider: "anthropic", model: "m", phase: "retry" });

    const report = t.report();
    const providerSum = Object.values(report.byProvider).reduce((s, p) => s + p.actual, 0);
    expect(providerSum).toBeCloseTo(report.totalActual, 10);
  });

  it("byPhase sums match totalActual", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    t.reserve("r2", 0.5);
    t.settle("r2", 0.2, { provider: "p", model: "m", phase: "fallback" });

    const report = t.report();
    const phaseSum = Object.values(report.byPhase).reduce((s, p) => s + p, 0);
    expect(phaseSum).toBeCloseTo(report.totalActual, 10);
  });

  it("committedCost = totalActual + totalReserved", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 1 });
    t.reserve("r2", 0.3);
    const report = t.report();
    expect(report.committedCost).toBeCloseTo(report.totalActual + report.totalReserved, 10);
  });

  it("remainingBudget = sessionBudget - committedCost", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 1 });
    t.reserve("r2", 0.3);
    const report = t.report();
    expect(report.remainingBudget).toBeCloseTo(1.0 - report.committedCost, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 28: Fuzz Testing
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 28: Fuzz Testing", () => {
  it("1000 randomized scenarios maintain invariants", () => {
    for (let scenario = 0; scenario < 1000; scenario++) {
      const budget = Math.random() * 10 + 0.1;
      const t = new BudgetTracker({ sessionBudget: budget });
      let accepted = 0;

      for (let i = 0; i < 50; i++) {
        const cost = Math.random() * 0.5;
        const r = t.reserve(`r${scenario}_${i}`, cost);
        if (r) {
          accepted++;
          if (Math.random() > 0.5) {
            t.settle(`r${scenario}_${i}`, Math.random() * cost, { provider: "p", model: "m", phase: "execute" });
          } else {
            t.release(`r${scenario}_${i}`);
          }
        }
      }

      assertBudgetInvariant(t);
      expect(t.report().activeReservations).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 29: Performance
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 29: Performance", () => {
  it("10000 reserve/settle cycles complete in reasonable time", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      t.reserve(`r${i}`, 0.01);
      t.settle(`r${i}`, 0.005, { provider: "p", model: "m", phase: "execute" });
    }
    const elapsed = performance.now() - start;
    // Should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });

  it("100000 reserve/release cycles complete in reasonable time", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      t.reserve(`r${i}`, 0.001);
      t.release(`r${i}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 21: Callback Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 21: Callback Safety", () => {
  it("throwing warning callback does not corrupt reservations", () => {
    const t = new BudgetTracker({
      sessionBudget: 100,
      onBudgetWarning: () => { throw new Error("boom"); },
    });
    t.reserve("r1", 90);
    t.settle("r1", 80, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBe(80);
  });

  it("throwing exceeded callback does not corrupt reservations", () => {
    const t = new BudgetTracker({
      sessionBudget: 100,
      onBudgetExceeded: () => { throw new Error("boom"); },
    });
    t.record({ requestId: "r0", provider: "p", model: "m", phase: "execute", estimatedCost: 110, actualCost: 110, timestamp: 1 });
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// v0.9.2: Duplicate Reservation ID Rejection
// ═══════════════════════════════════════════════════════════════════════════

describe("v0.9.2: Duplicate Reservation ID Rejection", () => {
  it("duplicate ID returns null — accounting invariant preserved", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    expect(t.reserve("r1", 0.3)).toBeNull(); // rejected
    expect(t.report().totalReserved).toBe(0.5); // first reservation intact
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBeCloseTo(0.3);
    expect(t.report().totalReserved).toBe(0);
  });

  it("duplicate ID does not modify existing reservation amount", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.reserve("r1", 0.9); // rejected
    expect(t.reservations()[0].amount).toBe(0.5);
  });

  it("duplicate ID does not increase totalReserved", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.reserve("r1", 0.3); // rejected
    expect(t.report().totalReserved).toBe(0.5); // not 0.8
  });

  it("release after rejected duplicate remains correct", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.reserve("r1", 0.3); // rejected
    t.release("r1");
    expect(t.report().totalReserved).toBe(0);
    expect(t.report().totalActual).toBe(0);
  });

  it("settle after rejected duplicate remains correct", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.reserve("r1", 0.3); // rejected
    t.settle("r1", 0.4, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBeCloseTo(0.4);
    expect(t.report().totalReserved).toBe(0);
  });

  it("repeated duplicate attempts remain safe", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    for (let i = 0; i < 100; i++) {
      expect(t.reserve("r1", 0.1)).toBeNull();
    }
    expect(t.report().totalReserved).toBe(0.5);
    assertBudgetInvariant(t);
  });

  it("duplicate IDs under concurrency", () => {
    const t = new BudgetTracker({ sessionBudget: 100 });
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
      if (t.reserve("same-id", 0.01)) accepted++;
    }
    expect(accepted).toBe(1); // only first succeeds
    expect(t.report().totalReserved).toBeCloseTo(0.01);
  });

  it("random collision scenarios — 1000 randomized operations", () => {
    for (let scenario = 0; scenario < 1000; scenario++) {
      const t = new BudgetTracker({ sessionBudget: 10.0 });
      const ids = ["A", "B", "C", "D"]; // deliberately small pool
      for (let i = 0; i < 20; i++) {
        const id = ids[i % ids.length]; // generates collisions
        const cost = Math.random() * 0.1;
        if (Math.random() > 0.3) {
          t.reserve(id, cost);
        } else {
          t.settle(id, Math.random() * cost, { provider: "p", model: "m", phase: "execute" });
        }
      }
      assertBudgetInvariant(t);
      expect(t.report().activeReservations).toBeGreaterThanOrEqual(0);
    }
  });

  it("reserve after settle on same ID succeeds (ID is freed)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    // ID is freed after settle — new reservation with same ID should work
    expect(t.reserve("r1", 0.2)).not.toBeNull();
    expect(t.report().activeReservations).toBe(1);
  });

  it("reserve after release on same ID succeeds (ID is freed)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    // ID is freed after release — new reservation with same ID should work
    expect(t.reserve("r1", 0.2)).not.toBeNull();
    expect(t.report().activeReservations).toBe(1);
  });

  it("client-generated IDs are unique (requestId counter)", () => {
    const provider = { name: "Test", baseUrl: "https://test.com/v1", authentication: { type: "none" } as const, adapter: "openai" as const, models: [{ id: "gpt-5.6-sol", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }] };
    const client = new HilbrasClient({ transport: successTransport(), budget: { sessionBudget: 100 } });
    client.addProvider(provider);
    const promises = Array.from({ length: 10 }, (_, i) =>
      client.complete({ provider: "Test", model: "gpt-5.6-sol", messages: [{ role: "user", content: `msg ${i}` }] }).catch(() => {})
    );
    return Promise.all(promises).then(() => {
      expect(client.costReport().activeReservations).toBe(0);
    });
  });
});
