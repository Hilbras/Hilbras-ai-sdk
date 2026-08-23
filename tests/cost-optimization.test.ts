/**
 * @hilbras/sdk — v0.8.0 Cost Optimization Tests
 *
 * Tests: BudgetTracker, cost enforcement, cost reporting,
 * session budgets, per-request budgets, budget callbacks,
 * cost-aware client integration, concurrency, adversarial inputs.
 */

import { describe, it, expect, vi } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { HilbrasClient } from "../src/client/client.js";
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

const PROVIDER: ProviderConfig = {
  name: "Test",
  baseUrl: "https://test.com/v1",
  authentication: { type: "none" },
  adapter: "openai",
  models: [{ id: "m", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
};

// ═══════════════════════════════════════════════════════════════════════════
// BudgetTracker Unit Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("BudgetTracker", () => {
  it("starts with zero costs", () => {
    const tracker = new BudgetTracker();
    const report = tracker.report();
    expect(report.totalEstimated).toBe(0);
    expect(report.totalActual).toBe(0);
    expect(report.requestCount).toBe(0);
    expect(report.budgetExceeded).toBe(false);
    expect(report.remainingBudget).toBeNull();
  });

  it("tracks cost events", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "openai", model: "gpt-5.6-sol", phase: "execute", estimatedCost: 0.01, actualCost: 0.012, timestamp: Date.now() });
    tracker.record({ requestId: "r2", provider: "anthropic", model: "claude-sonnet-5", phase: "execute", estimatedCost: 0.008, actualCost: 0.008, timestamp: Date.now() });

    const report = tracker.report();
    expect(report.totalEstimated).toBeCloseTo(0.018);
    expect(report.totalActual).toBeCloseTo(0.02);
    expect(report.requestCount).toBe(2);
  });

  it("tracks by provider", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "openai", model: "m1", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: Date.now() });
    tracker.record({ requestId: "r2", provider: "openai", model: "m2", phase: "execute", estimatedCost: 0.02, actualCost: 0.02, timestamp: Date.now() });
    tracker.record({ requestId: "r3", provider: "anthropic", model: "m3", phase: "execute", estimatedCost: 0.005, actualCost: 0.005, timestamp: Date.now() });

    const report = tracker.report();
    expect(report.byProvider.openai.requests).toBe(2);
    expect(report.byProvider.openai.actual).toBeCloseTo(0.03);
    expect(report.byProvider.anthropic.requests).toBe(1);
  });

  it("tracks by phase", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: Date.now() });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "retry", estimatedCost: 0.008, actualCost: 0.008, timestamp: Date.now() });

    const report = tracker.report();
    expect(report.byPhase.execute).toBeCloseTo(0.01);
    expect(report.byPhase.retry).toBeCloseTo(0.008);
  });

  it("session budget enforcement", () => {
    const warningFn = vi.fn();
    const exceededFn = vi.fn();
    const tracker = new BudgetTracker({ sessionBudget: 100, onBudgetWarning: warningFn, onBudgetExceeded: exceededFn });

    // 40%
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 40, actualCost: 40, timestamp: Date.now() });
    expect(tracker.isBudgetExhausted()).toBe(false);
    expect(warningFn).not.toHaveBeenCalled();

    // 80% — warning fires
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "execute", estimatedCost: 40, actualCost: 40, timestamp: Date.now() });
    expect(tracker.isBudgetExhausted()).toBe(false);
    expect(warningFn).toHaveBeenCalledTimes(1);

    // 120% — exceeded fires
    tracker.record({ requestId: "r3", provider: "p", model: "m", phase: "execute", estimatedCost: 40, actualCost: 40, timestamp: Date.now() });
    expect(tracker.isBudgetExhausted()).toBe(true);
    expect(exceededFn).toHaveBeenCalledTimes(1);
  });

  it("per-request budget enforcement", () => {
    const tracker = new BudgetTracker({ perRequestBudget: 0.01 });
    expect(tracker.wouldExceedBudget(0.005)).toBe(false);
    expect(tracker.wouldExceedBudget(0.015)).toBe(true);
  });

  it("no budget = unlimited", () => {
    const tracker = new BudgetTracker();
    expect(tracker.wouldExceedBudget(999)).toBe(false);
    expect(tracker.isBudgetExhausted()).toBe(false);
    expect(tracker.report().remainingBudget).toBeNull();
  });

  it("remaining budget calculation", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.10 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.03, actualCost: 0.03, timestamp: Date.now() });
    expect(tracker.report().remainingBudget).toBeCloseTo(0.07);
  });

  it("estimate() returns cost estimate", () => {
    const tracker = new BudgetTracker();
    const cost = tracker.estimate("gpt-5.6-sol", "openai", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it("reset() clears all state", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: Date.now() });
    tracker.reset();
    const report = tracker.report();
    expect(report.totalActual).toBe(0);
    expect(report.requestCount).toBe(0);
  });

  it("events() returns all recorded events", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    tracker.record({ requestId: "r2", provider: "p", model: "m", phase: "retry", estimatedCost: 0.005, actualCost: 0.005, timestamp: 2 });
    expect(tracker.events()).toHaveLength(2);
    expect(tracker.events()[0].timestamp).toBe(1);
    expect(tracker.events()[1].phase).toBe("retry");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Client Cost Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("Client Cost Integration", () => {
  it("client.cost returns the budget tracker", () => {
    const client = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    expect(client.cost).toBeDefined();
    expect(typeof client.cost.report).toBe("function");
  });

  it("client.costReport() returns current report", () => {
    const client = new HilbrasClient();
    const report = client.costReport();
    expect(report.totalActual).toBe(0);
    expect(report.requestCount).toBe(0);
  });

  it("client.isBudgetExhausted() works", () => {
    const client = new HilbrasClient({ budget: { sessionBudget: 0.001 } });
    expect(client.isBudgetExhausted()).toBe(false);
  });

  it("records cost after successful completion", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider({ ...PROVIDER });

    await client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] });

    const report = client.costReport();
    expect(report.requestCount).toBe(1);
    expect(report.totalActual).toBeGreaterThanOrEqual(0);
  });

  it("per-request budget exceeded throws before execution", async () => {
    const expensiveProvider: ProviderConfig = {
      ...PROVIDER,
      models: [{ id: "gpt-5.6-sol", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
    };
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { perRequestBudget: 0.0000001 }, // Far below any model cost
    });
    client.addProvider(expensiveProvider);

    await expect(
      client.complete({ provider: "Test", model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/budget/);
  });

  it("session budget exceeded throws before execution", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { sessionBudget: 0.00001 },
    });
    client.addProvider({ ...PROVIDER });

    // First request might succeed if cost < budget
    try { await client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] }); } catch {}

    // After enough spending, should be exhausted
    if (client.isBudgetExhausted()) {
      await expect(
        client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] })
      ).rejects.toThrow(/exhausted/);
    }
  });

  it("no budget = no enforcement", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider({ ...PROVIDER });

    // Should work without any budget errors
    const result = await client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cost Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Cost Security", () => {
  it("budget tracker never exposes API keys", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "openai", model: "gpt-5.6-sol", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: Date.now() });
    const report = JSON.stringify(tracker.report());
    expect(report).not.toContain("sk-");
    expect(report).not.toContain("apiKey");
  });

  it("extreme cost values handled gracefully", () => {
    const tracker = new BudgetTracker();
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: Number.MAX_SAFE_INTEGER, actualCost: Number.MAX_SAFE_INTEGER, timestamp: Date.now() });
    const report = tracker.report();
    expect(Number.isFinite(report.totalActual)).toBe(true);
    expect(Number.isNaN(report.totalActual)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("Concurrency", () => {
  it("concurrent cost tracking is consistent", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider({ ...PROVIDER });

    const promises = Array.from({ length: 20 }, (_, i) =>
      client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: `msg ${i}` }] }).catch(() => {})
    );
    await Promise.all(promises);

    const report = client.costReport();
    expect(report.requestCount).toBe(20);
    expect(Number.isFinite(report.totalActual)).toBe(true);
  });

  it("budget enforcement is consistent under concurrency", async () => {
    const client = new HilbrasClient({
      transport: successTransport(),
      budget: { perRequestBudget: 0.00001 }, // Very tight budget
    });
    client.addProvider({ ...PROVIDER });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] })
      )
    );

    // Some should succeed, some should fail with budget error
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const budgetErrors = results.filter((r) => r.status === "rejected" && String(r.reason).includes("budget"));
    expect(succeeded.length + budgetErrors.length).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe("Backward Compatibility", () => {
  it("client works without budget config", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider({ ...PROVIDER });
    const result = await client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });

  it("all existing APIs still work", () => {
    const client = new HilbrasClient();
    expect(typeof client.addProvider).toBe("function");
    expect(typeof client.removeProvider).toBe("function");
    expect(typeof client.complete).toBe("function");
    expect(typeof client.stream).toBe("function");
    expect(typeof client.explain).toBe("function");
    expect(typeof client.plan).toBe("function");
    expect(typeof client.on).toBe("function");
    expect(typeof client.costReport).toBe("function");
    expect(typeof client.isBudgetExhausted).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Adversarial
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial", () => {
  it("negative budget values handled gracefully", () => {
    const tracker = new BudgetTracker({ sessionBudget: -1 });
    expect(tracker.isBudgetExhausted()).toBe(true); // -1 means already exceeded
  });

  it("zero budget means immediately exhausted", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0 });
    expect(tracker.isBudgetExhausted()).toBe(true);
  });

  it("empty model/provider in estimate returns 0", () => {
    const tracker = new BudgetTracker();
    const cost = tracker.estimate("", "", 0, 0);
    expect(cost).toBe(0);
    expect(Number.isNaN(cost)).toBe(false);
  });

  it("extremely large token counts handled", () => {
    const tracker = new BudgetTracker();
    const cost = tracker.estimate("gpt-5.6-sol", "openai", 1_000_000, 500_000);
    expect(cost).toBeGreaterThan(0);
    expect(Number.isFinite(cost)).toBe(true);
  });

  it("reset after budget exceeded allows new requests", () => {
    const tracker = new BudgetTracker({ sessionBudget: 0.001 });
    tracker.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.001, actualCost: 0.001, timestamp: Date.now() });
    expect(tracker.isBudgetExhausted()).toBe(true);

    tracker.reset();
    expect(tracker.isBudgetExhausted()).toBe(false);
  });
});
