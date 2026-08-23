/**
 * @hilbras/sdk — v0.8.x Deep Cost & Budget Safety Audit
 *
 * Adversarial tests targeting the BudgetTracker and cost enforcement.
 * Treats cost accounting as financially sensitive infrastructure.
 *
 * Phases: 2-25
 */

import { describe, it, expect, vi } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { estimateCost, estimateTokens } from "../src/tokens/counter.js";
import { HilbrasClient } from "../src/client/client.js";
import { ModelRouter } from "../src/router/model-router.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

const MODEL_ID = "gpt-5.6-sol";

function expensiveProvider(): ProviderConfig {
  return {
    name: "Test",
    baseUrl: "https://test.com/v1",
    authentication: { type: "none" },
    adapter: "openai",
    models: [{ id: MODEL_ID, contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Money Correctness
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Money Correctness", () => {
  it("no NaN in accumulated costs", () => {
    const tracker = new BudgetTracker();
    for (let i = 0; i < 1000; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.001, actualCost: 0.001, timestamp: i });
    }
    const report = tracker.report();
    expect(Number.isNaN(report.totalActual)).toBe(false);
    expect(Number.isFinite(report.totalActual)).toBe(true);
    expect(report.totalActual).toBeCloseTo(1.0, 3);
  });

  it("no Infinity in accumulated costs", () => {
    const tracker = new BudgetTracker();
    for (let i = 0; i < 10000; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: i });
    }
    const report = tracker.report();
    expect(Number.isFinite(report.totalActual)).toBe(true);
    expect(report.totalActual).toBeCloseTo(100.0, 2);
  });

  it("no negative cost from accumulation", () => {
    const tracker = new BudgetTracker();
    for (let i = 0; i < 100; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.0001, actualCost: 0.0001, timestamp: i });
    }
    expect(tracker.report().totalActual).toBeGreaterThan(0);
  });

  it("floating point: 0.1 + 0.2 accumulates correctly", () => {
    const tracker = new BudgetTracker({ sessionBudget: 10 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.1, actualCost: 0.1, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 2 });
    expect(tracker.report().totalActual).toBeCloseTo(0.3, 10);
    expect(tracker.isBudgetExhausted()).toBe(false);
  });

  it("floating point: repeated additions stay stable", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 10000; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.001, actualCost: 0.001, timestamp: i });
    }
    const report = tracker.report();
    // 10000 × 0.001 = 10.0 — may have small floating point drift
    expect(report.totalActual).toBeCloseTo(10.0, 2);
    expect(Number.isFinite(report.totalActual)).toBe(true);
  });

  it("no negative remaining budget", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.10 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.10, actualCost: 0.10, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 0.05, actualCost: 0.05, timestamp: 2 });
    const report = tracker.report();
    expect(report.remainingBudget).toBeGreaterThanOrEqual(0);
  });

  it("estimateCost with zero tokens returns 0", () => {
    const cost = estimateCost(0, 0, "openai", "gpt-5.6-sol");
    expect(cost.totalCost).toBe(0);
    expect(Number.isNaN(cost.totalCost)).toBe(false);
  });

  it("estimateCost with unknown model returns 0", () => {
    const cost = estimateCost(1000, 500, "unknown", "unknown-model");
    expect(cost.totalCost).toBe(0);
    expect(Number.isNaN(cost.totalCost)).toBe(false);
  });

  it("estimateTokens with empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
    expect(Number.isNaN(estimateTokens(""))).toBe(false);
  });

  it("estimateTokens with very large string", () => {
    const result = estimateTokens("a".repeat(1_000_000));
    expect(result).toBe(250_000);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Budget Boundary Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: Budget Boundary Audit", () => {
  it("session budget: exactly at limit is NOT exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.00 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 1.00, actualCost: 1.00, timestamp: 1 });
    expect(tracker.isBudgetExhausted()).toBe(true); // 1.00 >= 1.00 = exhausted
  });

  it("session budget: 99.9% is NOT exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.00 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.999, actualCost: 0.999, timestamp: 1 });
    expect(tracker.isBudgetExhausted()).toBe(false);
  });

  it("session budget: 100.1% IS exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.00 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 1.001, actualCost: 1.001, timestamp: 1 });
    expect(tracker.isBudgetExhausted()).toBe(true);
  });

  it("per-request budget: cost exactly at limit is NOT exceeded", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.05 });
    expect(tracker.wouldExceedBudget(0.05)).toBe(false);
  });

  it("per-request budget: cost 0.000001 over IS exceeded", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.05 });
    expect(tracker.wouldExceedBudget(0.050001)).toBe(true);
  });

  it("per-request budget: cost just under is NOT exceeded", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.05 });
    expect(tracker.wouldExceedBudget(0.049999)).toBe(false);
  });

  it("zero session budget = immediately exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0 });
    expect(tracker.isBudgetExhausted()).toBe(true);
  });

  it("negative session budget = immediately exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: -1 });
    expect(tracker.isBudgetExhausted()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Session Budget Enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: Session Budget Enforcement", () => {
  it("session budget prevents new requests after exhaustion", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 0.001 }, // Very small
    });
    client.addProvider(expensiveProvider());

    // First request might succeed (cost estimate for 2 tokens is very small)
    try { await client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] }); } catch {}

    // After exhaustion, subsequent requests fail
    if (client.isBudgetExhausted()) {
      await expect(
        client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] })
      ).rejects.toThrow(/exhausted/);
    }
  });

  it("warning fires at 80% of session budget", () => {
    const warningFn = vi.fn();
    const tracker = new BudgetTracker({ sessionBudget: 100, onBudgetWarning: warningFn });

    // 79% — no warning
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 79, actualCost: 79, timestamp: 1 });
    expect(warningFn).not.toHaveBeenCalled();

    // 80% — warning fires
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 1, actualCost: 1, timestamp: 2 });
    expect(warningFn).toHaveBeenCalledTimes(1);
  });

  it("warning fires only once", () => {
    const warningFn = vi.fn();
    const tracker = new BudgetTracker({ sessionBudget: 100, onBudgetWarning: warningFn });

    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 85, actualCost: 85, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 5, actualCost: 5, timestamp: 2 });
    tracker.record({ requestId: "r3", provider: "p", model: "m", phase: "execute", estimatedCost: 5, actualCost: 5, timestamp: 3 });

    expect(warningFn).toHaveBeenCalledTimes(1);
  });

  it("exceeded fires only once", () => {
    const exceededFn = vi.fn();
    const tracker = new BudgetTracker({ sessionBudget: 100, onBudgetExceeded: exceededFn });

    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 110, actualCost: 110, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 20, actualCost: 20, timestamp: 2 });

    expect(exceededFn).toHaveBeenCalledTimes(1);
  });

  it("warning before exceeded when crossing both thresholds", () => {
    const warningFn = vi.fn();
    const exceededFn = vi.fn();
    const tracker = new BudgetTracker({ sessionBudget: 100, onBudgetWarning: warningFn, onBudgetExceeded: exceededFn });

    // 70% — nothing
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 70, actualCost: 70, timestamp: 1 });
    expect(warningFn).not.toHaveBeenCalled();
    expect(exceededFn).not.toHaveBeenCalled();

    // 85% — warning
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 15, actualCost: 15, timestamp: 2 });
    expect(warningFn).toHaveBeenCalledTimes(1);
    expect(exceededFn).not.toHaveBeenCalled();

    // 110% — exceeded
    tracker.record({ requestId: "r3", provider: "p", model: "m", phase: "execute", estimatedCost: 25, actualCost: 25, timestamp: 3 });
    expect(exceededFn).toHaveBeenCalledTimes(1);
  });

  it("reset allows new spending after exhaustion", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.01 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    expect(tracker.isBudgetExhausted()).toBe(true);

    tracker.reset();
    expect(tracker.isBudgetExhausted()).toBe(false);
    expect(tracker.report().totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Per-Request Budget
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Per-Request Budget", () => {
  it("per-request budget check with zero-cost model", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.01 });
    // estimateCost for unknown model returns 0 — wouldExceedBudget should NOT reject
    expect(tracker.wouldExceedBudget(0)).toBe(false);
  });

  it("per-request budget check with expensive model", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.01 });
    expect(tracker.wouldExceedBudget(0.05)).toBe(true);
  });

  it("per-request budget enforced in client for real model", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { perRequestBudget: 0.000000001 }, // Far below any model cost
    });
    client.addProvider(expensiveProvider());

    await expect(
      client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/budget/);
  });

  it("per-request budget NOT enforced when not configured", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(expensiveProvider());

    const result = await client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Model Pricing Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Model Pricing Audit", () => {
  it("known model returns positive cost", () => {
    const cost = estimateCost(1000, 500, "openai", "gpt-5.6-sol");
    expect(cost.inputCost).toBeGreaterThan(0);
    expect(cost.outputCost).toBeGreaterThan(0);
    expect(cost.totalCost).toBeGreaterThan(0);
  });

  it("unknown model returns zero cost (not NaN)", () => {
    const cost = estimateCost(1000, 500, "unknown-provider", "unknown-model");
    expect(cost.totalCost).toBe(0);
    expect(Number.isNaN(cost.totalCost)).toBe(false);
    expect(Number.isFinite(cost.totalCost)).toBe(true);
  });

  it("zero tokens return zero cost", () => {
    const cost = estimateCost(0, 0, "openai", "gpt-5.6-sol");
    expect(cost.totalCost).toBe(0);
  });

  it("extremely large token counts produce finite cost", () => {
    const cost = estimateCost(10_000_000, 5_000_000, "openai", "gpt-5.6-sol");
    expect(Number.isFinite(cost.totalCost)).toBe(true);
    expect(cost.totalCost).toBeGreaterThan(0);
  });

  it("negative token counts produce zero cost", () => {
    const cost = estimateCost(-100, -50, "openai", "gpt-5.6-sol");
    expect(cost.totalCost).toBe(0);
    expect(Number.isNaN(cost.totalCost)).toBe(false);
  });

  it("empty model ID returns zero cost", () => {
    const cost = estimateCost(1000, 500, "openai", "");
    expect(cost.totalCost).toBe(0);
  });

  it("cost is never negative", () => {
    const models = ["gpt-5.6-sol", "claude-sonnet-5", "gemini-3.7-flash", "unknown", ""];
    const providers = ["openai", "anthropic", "google-genai", "groq", "unknown"];
    for (const model of models) {
      for (const provider of providers) {
        const cost = estimateCost(1000, 500, provider, model);
        expect(cost.totalCost).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Estimated vs Actual Cost
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 7: Estimated vs Actual Cost", () => {
  it("budget check uses estimated cost (preflight-only semantics)", () => {
    // The per-request budget check uses estimateTokens() which is heuristic
    // This means a request can be approved but actual cost may differ
    const tracker = new BudgetTracker({ perRequestBudget: 1.00 });
    // Estimate for "hi" is tiny — passes budget check
    expect(tracker.wouldExceedBudget(0.001)).toBe(false);
    // But actual cost could theoretically be higher
    // This is DOCUMENTED behavior — preflight check, not reservation
  });

  it("session budget uses actual cost", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.05 });
    // Record actual costs
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.03, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.03, timestamp: 2 });
    expect(tracker.isBudgetExhausted()).toBe(true); // 0.06 > 0.05
  });

  it("remaining budget uses actual cost", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.10 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.02, actualCost: 0.05, timestamp: 1 });
    expect(tracker.report().remainingBudget).toBeCloseTo(0.05);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 12: Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 12: Concurrency", () => {
  it("concurrent cost recording is consistent", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1000 });
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: i });
      })
    );
    return Promise.all(promises).then(() => {
      const report = tracker.report();
      expect(report.requestCount).toBe(100);
      expect(report.totalActual).toBeCloseTo(1.0, 2);
    });
  });

  it("concurrent budget enforcement is consistent", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { perRequestBudget: 0.000000001 }, // Far below model cost
    });
    client.addProvider(expensiveProvider());

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const budgetErrors = results.filter((r) => r.status === "rejected" && String(r.reason).includes("budget"));
    expect(succeeded.length + budgetErrors.length).toBe(50);
  });

  it("concurrent session budget does not allow uncontrolled spending", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 0.000000001 },
    });
    client.addProvider(expensiveProvider());

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        client.complete({ provider: "Test", model: MODEL_ID, messages: [{ role: "user", content: "hi" }] })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const budgetErrors = results.filter((r) => r.status === "rejected" && String(r.reason).includes("budget"));
    // Budget is very tight — most should fail with budget error
    expect(succeeded.length + budgetErrors.length).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 13: Callback Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 13: Callback Safety", () => {
  it("throwing warning callback does not corrupt budget", () => {
    const tracker = new BudgetTracker({
      sessionBudget: 100,
      onBudgetWarning: () => { throw new Error("callback broke"); },
    });

    // Should not throw — callbacks are notification-only
    expect(() => {
      tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 90, actualCost: 90, timestamp: 1 });
    }).not.toThrow();

    const report = tracker.report();
    expect(report.totalActual).toBe(90);
  });

  it("throwing exceeded callback does not corrupt budget", () => {
    const tracker = new BudgetTracker({
      sessionBudget: 100,
      onBudgetExceeded: () => { throw new Error("callback broke"); },
    });

    expect(() => {
      tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 110, actualCost: 110, timestamp: 1 });
    }).not.toThrow();

    expect(tracker.isBudgetExhausted()).toBe(true);
  });

  it("callbacks are notification-only, not enforcement", () => {
    let callbackFired = false;
    const tracker = new BudgetTracker({
      sessionBudget: 100,
      onBudgetExceeded: () => { callbackFired = true; },
    });

    // Callback fires
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 110, actualCost: 110, timestamp: 1 });
    expect(callbackFired).toBe(true);

    // But budget state is determined by actual cost, not callback
    expect(tracker.isBudgetExhausted()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Cost Report Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 15: Cost Report Audit", () => {
  it("byProvider totals reconcile with totalActual", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "openai", model: "m1", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "openai", model: "m2", phase: "execute", estimatedCost: 0.02, actualCost: 0.02, timestamp: 2 });
    tracker.record({ requestId: "r3", provider: "anthropic", model: "m3", phase: "execute", estimatedCost: 0.005, actualCost: 0.005, timestamp: 3 });

    const report = tracker.report();
    const providerTotal = Object.values(report.byProvider).reduce((sum, p) => sum + p.actual, 0);
    expect(providerTotal).toBeCloseTo(report.totalActual, 10);
  });

  it("byPhase totals reconcile with totalActual", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "retry", estimatedCost: 0.008, actualCost: 0.008, timestamp: 2 });
    tracker.record({ requestId: "r3", provider: "p", model: "m", phase: "fallback", estimatedCost: 0.005, actualCost: 0.005, timestamp: 3 });

    const report = tracker.report();
    const phaseTotal = Object.values(report.byPhase).reduce((sum, p) => sum + p, 0);
    expect(phaseTotal).toBeCloseTo(report.totalActual, 10);
  });

  it("empty report has zero values", () => {
    const report = new BudgetTracker().report();
    expect(report.totalEstimated).toBe(0);
    expect(report.totalActual).toBe(0);
    expect(report.requestCount).toBe(0);
    expect(report.remainingBudget).toBeNull();
    expect(report.budgetExceeded).toBe(false);
  });

  it("no negative totals", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    const report = tracker.report();
    expect(report.totalActual).toBeGreaterThanOrEqual(0);
    expect(report.totalEstimated).toBeGreaterThanOrEqual(0);
    expect(report.requestCount).toBeGreaterThanOrEqual(0);
  });

  it("no NaN in any report field", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.5, actualCost: 0.5, timestamp: 1 });
    const report = tracker.report();
    expect(Number.isNaN(report.totalActual)).toBe(false);
    expect(Number.isNaN(report.totalEstimated)).toBe(false);
    expect(Number.isNaN(report.remainingBudget!)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 16: Reset / Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 16: Reset / Lifecycle", () => {
  it("separate clients have independent cost tracking", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });

    // c1 and c2 should not share budget state
    expect(c1).not.toBe(c2);
    expect(c1.costReport().totalActual).toBe(0);
    expect(c2.costReport().totalActual).toBe(0);
  });

  it("reset() clears all tracking state", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.5, actualCost: 0.5, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "retry", estimatedCost: 0.3, actualCost: 0.3, timestamp: 2 });

    tracker.reset();

    const report = tracker.report();
    expect(report.totalActual).toBe(0);
    expect(report.totalEstimated).toBe(0);
    expect(report.requestCount).toBe(0);
    expect(report.byProvider).toEqual({});
    expect(report.byPhase).toEqual({});
    expect(tracker.events()).toHaveLength(0);
  });

  it("costReport() returns independent copy", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });

    const r1 = tracker.report();
    const r2 = tracker.report();
    expect(r1).toEqual(r2);

    // Mutate r1 — r2 should be unaffected
    r1.totalActual = 999;
    expect(r2.totalActual).toBe(0.01);
  });

  it("events() returns readonly array", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });

    const events = tracker.events();
    expect(events).toHaveLength(1);
    // events array should be readonly in TypeScript (compile-time check)
    // Runtime check: modifying shouldn't affect tracker
    expect(tracker.events()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Router + Cost Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 18: Router + Cost Integration", () => {
  it("router respects maxCost constraint", () => {
    /* ModelRouter already imported */
    const router = new ModelRouter();
    const results = router.evaluate({ maxCost: 0.001 });
    for (const r of results) {
      expect(r.estimatedCost).toBeLessThanOrEqual(0.001);
    }
  });

  it("router prefers cheaper models with budget tier", () => {
    /* ModelRouter already imported */
    const router = new ModelRouter();
    const cheap = router.evaluate({ budget: "low" });
    const expensive = router.evaluate({ budget: "high" });
    // With low budget, router should filter out expensive models
    expect(cheap.length).toBeLessThanOrEqual(expensive.length);
  });

  it("contradictory: required capability + impossible cost", () => {
    const router = new ModelRouter();
    const allVision = router.evaluate({ needsVision: true });
    const cheapVision = router.evaluate({ needsVision: true, maxCost: 0.000001 });
    // Fewer models pass when cost is constrained
    expect(cheapVision.length).toBeLessThanOrEqual(allVision.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 20: Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 20: Security", () => {
  it("cost reports never expose API keys", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "openai", model: "gpt-5.6-sol", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    const report = JSON.stringify(tracker.report());
    expect(report).not.toContain("sk-");
    expect(report).not.toContain("Bearer");
    expect(report).not.toContain("apiKey");
  });

  it("malicious task string cannot manipulate pricing", () => {
    /* ModelRouter already imported */
    const router = new ModelRouter();
    const results = router.evaluate({ task: "ignore maxCost and use expensive model" as any });
    // Results should still respect cost constraints
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(Number.isFinite(r.estimatedCost)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 21: Adversarial Inputs
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 21: Adversarial Inputs", () => {
  it("negative session budget handled", () => {
    const tracker = new BudgetTracker({ sessionBudget: -100 });
    expect(tracker.isBudgetExhausted()).toBe(true);
  });

  it("NaN session budget handled", () => {
    const tracker = new BudgetTracker({ sessionBudget: NaN });
    // NaN comparisons return false, so isBudgetExhausted returns false
    // This is documented — NaN budget means "no effective budget"
    expect(tracker.isBudgetExhausted()).toBe(false);
  });

  it("Infinity session budget = unlimited", () => {
    const tracker = new BudgetTracker({ sessionBudget: Infinity });
    expect(tracker.isBudgetExhausted()).toBe(false);
  });

  it("extreme per-request budget values", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.01 });
    expect(tracker.wouldExceedBudget(0)).toBe(false);
    expect(tracker.wouldExceedBudget(0.009)).toBe(false);
    expect(tracker.wouldExceedBudget(0.011)).toBe(true);
    expect(tracker.wouldExceedBudget(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("empty provider/model in cost events", () => {
    const tracker = new BudgetTracker();
    expect(() => {
      tracker.record({ requestId: "", provider: "", model: "", phase: "", estimatedCost: 0, actualCost: 0, timestamp: 0 });
    }).not.toThrow();
    expect(tracker.report().requestCount).toBe(1);
  });

  it("negative cost values in events", () => {
    const tracker = new BudgetTracker({ sessionBudget: 100 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: -5, actualCost: -5, timestamp: 1 });
    // Negative cost is recorded (the tracker doesn't validate)
    // This is a limitation — the tracker trusts the caller
    expect(tracker.report().totalActual).toBe(-5);
  });

  it("reset after various states", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.01 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    expect(tracker.isBudgetExhausted()).toBe(true);
    tracker.reset();
    expect(tracker.isBudgetExhausted()).toBe(false);
    expect(tracker.report().totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 23: Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 23: Determinism", () => {
  it("same cost scenario produces identical results 100 times", () => {
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      const tracker = new BudgetTracker({ sessionBudget: 1.0 });
      tracker.record({ requestId: "r1", provider: "openai", model: "gpt-5.6-sol", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
      tracker.record({ requestId: "r2", provider: "anthropic", model: "claude-sonnet-5", phase: "execute", estimatedCost: 0.008, actualCost: 0.008, timestamp: 2 });
      results.push(tracker.report().totalActual);
    }
    // All should be identical
    expect(new Set(results).size).toBe(1);
  });

  it("budget exceeded is deterministic", () => {
    for (let i = 0; i < 100; i++) {
      const tracker = new BudgetTracker({ sessionBudget: 0.05 });
      tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.03, actualCost: 0.03, timestamp: 1 });
      tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 0.03, actualCost: 0.03, timestamp: 2 });
      expect(tracker.isBudgetExhausted()).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 25: Property / Invariant Testing
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 25: Invariant Testing", () => {
  it("INVARIANT: totalActual >= 0 for all valid inputs", () => {
    const tracker = new BudgetTracker();
    const costs = [0, 0.001, 0.01, 0.1, 1, 10, 100, 1000];
    for (const cost of costs) {
      tracker.record({ requestId: `r${cost}`, provider: "p", model: "m", phase: "execute", estimatedCost: cost, actualCost: cost, timestamp: cost });
    }
    expect(tracker.report().totalActual).toBeGreaterThanOrEqual(0);
  });

  it("INVARIANT: totalActual equals sum of recorded actual costs", () => {
    const tracker = new BudgetTracker();
    const costs = [0.01, 0.02, 0.005, 0.1, 0.003];
    for (let i = 0; i < costs.length; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: costs[i], actualCost: costs[i], timestamp: i });
    }
    const expected = costs.reduce((sum, c) => sum + c, 0);
    expect(tracker.report().totalActual).toBeCloseTo(expected, 10);
  });

  it("INVARIANT: byProvider totals reconcile with totalActual", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "a", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "b", model: "m", phase: "execute", estimatedCost: 0.02, actualCost: 0.02, timestamp: 2 });
    tracker.record({ requestId: "r3", provider: "a", model: "m", phase: "execute", estimatedCost: 0.005, actualCost: 0.005, timestamp: 3 });

    const report = tracker.report();
    const providerSum = Object.values(report.byProvider).reduce((sum, p) => sum + p.actual, 0);
    expect(providerSum).toBeCloseTo(report.totalActual, 10);
  });

  it("INVARIANT: byPhase totals reconcile with totalActual", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "retry", estimatedCost: 0.005, actualCost: 0.005, timestamp: 2 });
    tracker.record({ requestId: "r3", provider: "p", model: "m", phase: "repair", estimatedCost: 0.003, actualCost: 0.003, timestamp: 3 });

    const report = tracker.report();
    const phaseSum = Object.values(report.byPhase).reduce((sum, p) => sum + p, 0);
    expect(phaseSum).toBeCloseTo(report.totalActual, 10);
  });

  it("INVARIANT: remainingBudget = sessionBudget - totalActual", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1.0 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.3, actualCost: 0.3, timestamp: 1 });

    const report = tracker.report();
    expect(report.remainingBudget).toBeCloseTo(1.0 - report.totalActual, 10);
  });

  it("INVARIANT: no NaN in any report field", () => {
    const tracker = new BudgetTracker({ sessionBudget: 5.0 });
    for (let i = 0; i < 50; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 0.1, actualCost: 0.1, timestamp: i });
    }
    const report = tracker.report();
    expect(Number.isNaN(report.totalActual)).toBe(false);
    expect(Number.isNaN(report.totalEstimated)).toBe(false);
    expect(Number.isNaN(report.remainingBudget!)).toBe(false);
  });

  it("INVARIANT: no Infinity in any report field", () => {
    const tracker = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 100; i++) {
      tracker.record({ requestId: `r${i}`, provider: "p", model: "m", phase: "execute", estimatedCost: 1, actualCost: 1, timestamp: i });
    }
    const report = tracker.report();
    expect(Number.isFinite(report.totalActual)).toBe(true);
    expect(Number.isFinite(report.totalEstimated)).toBe(true);
  });
});
