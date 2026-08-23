/**
 * @hilbras/sdk — v0.7.0 Execution Optimization Tests
 *
 * Tests: ExecutionPlan, advanced scoring, fallback, determinism,
 * explainability, concurrency, adversarial inputs.
 */

import { describe, it, expect } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { ModelRouter } from "../src/router/model-router.js";
import { resolvePolicy } from "../src/reliability/presets.js";
import type { TaskRequirement } from "../src/types/router.js";
import type { ExecutionPolicy } from "../src/types/policy.js";

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Execution Plan
// ═══════════════════════════════════════════════════════════════════════════

describe("ExecutionPlan", () => {
  const router = new ModelRouter();

  it("plan() returns ExecutionPlan with primary, fallbacks, and cost estimate", () => {
    const plan = router.plan({ task: "coding", needsTools: true }, "req_1");
    expect(plan).not.toBeNull();
    expect(plan!.requestId).toBe("req_1");
    expect(plan!.primary.provider).toBeTruthy();
    expect(plan!.primary.model).toBeTruthy();
    expect(plan!.primary.score).toBeGreaterThan(0);
    expect(plan!.primary.estimatedCost).toBeGreaterThanOrEqual(0);
    expect(plan!.primary.reasons.length).toBeGreaterThan(0);
    expect(plan!.estimatedTotalCost).toBeGreaterThanOrEqual(0);
    expect(plan!.allCandidates.length).toBeGreaterThan(0);
  });

  it("plan() includes fallback candidates", () => {
    const plan = router.plan({ task: "coding", needsTools: true }, "req_2");
    expect(plan!.fallbacks).toBeDefined();
    expect(Array.isArray(plan!.fallbacks)).toBe(true);
    expect(plan!.fallbacks.length).toBeGreaterThan(0);
  });

  it("plan() returns null when no models match", () => {
    const plan = router.plan({ excludeModels: router.evaluate({}).map((r) => r.model) }, "req_3");
    expect(plan).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Advanced Scoring
// ═══════════════════════════════════════════════════════════════════════════

describe("Advanced Scoring", () => {
  const router = new ModelRouter();

  it("results include scoreBreakdown with all dimensions", () => {
    const results = router.evaluate({ task: "coding", needsTools: true });
    expect(results.length).toBeGreaterThan(0);
    const best = results[0];
    expect(best.scoreBreakdown).toBeDefined();
    expect(typeof best.scoreBreakdown!.capabilityFit).toBe("number");
    expect(typeof best.scoreBreakdown!.taskFit).toBe("number");
    expect(typeof best.scoreBreakdown!.contextFit).toBe("number");
    expect(typeof best.scoreBreakdown!.costEfficiency).toBe("number");
    expect(typeof best.scoreBreakdown!.latency).toBe("number");
    expect(typeof best.scoreBreakdown!.budgetAlignment).toBe("number");
    expect(typeof best.scoreBreakdown!.providerPreference).toBe("number");
    expect(typeof best.scoreBreakdown!.structuredOutputFit).toBe("number");
    expect(typeof best.scoreBreakdown!.toolFit).toBe("number");
    expect(typeof best.scoreBreakdown!.finalScore).toBe("number");
  });

  it("all score dimensions are within 0-100", () => {
    const results = router.evaluate({});
    for (const r of results.slice(0, 5)) {
      const b = r.scoreBreakdown!;
      expect(b.capabilityFit).toBeGreaterThanOrEqual(0);
      expect(b.capabilityFit).toBeLessThanOrEqual(100);
      expect(b.taskFit).toBeGreaterThanOrEqual(0);
      expect(b.costEfficiency).toBeGreaterThanOrEqual(0);
      expect(b.latency).toBeGreaterThanOrEqual(0);
    }
  });

  it("task fit is higher for coding+tools than for coding alone", () => {
    const codingTools = router.evaluate({ task: "coding", needsTools: true });
    const codingOnly = router.evaluate({ task: "coding" });
    expect(codingTools[0].scoreBreakdown!.taskFit).toBeGreaterThanOrEqual(codingOnly[0].scoreBreakdown!.taskFit);
  });

  it("structured output fit is 10 when needsStructuredOutput", () => {
    const results = router.evaluate({ needsStructuredOutput: true });
    for (const r of results) {
      expect(r.scoreBreakdown!.structuredOutputFit).toBe(10);
    }
  });

  it("provider preference bonus is 5 when preferred provider matches", () => {
    const results = router.evaluate({ preferredProvider: "openai" });
    expect(results[0].scoreBreakdown!.providerPreference).toBe(5);
  });

  it("provider preference bonus is 0 when no preference", () => {
    const results = router.evaluate({});
    // At least one result should have 0 preference bonus
    expect(results.some((r) => r.scoreBreakdown!.providerPreference === 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Automatic Fallback
// ═══════════════════════════════════════════════════════════════════════════

describe("Automatic Fallback", () => {
  it("ExecutionPolicy has allowFallback and maxFallbackCost", () => {
    const policy = resolvePolicy({ preset: "production", allowFallback: true, maxFallbackCost: 0.1 });
    expect(policy.allowFallback).toBe(true);
    expect(policy.maxFallbackCost).toBe(0.1);
  });

  it("balanced preset has allowFallback=false by default", () => {
    const policy = resolvePolicy({});
    expect(policy.allowFallback).toBe(false);
    expect(policy.maxFallbackCost).toBeNull();
  });

  it("production preset has allowFallback=true by default", () => {
    const policy = resolvePolicy({ preset: "production" });
    expect(policy.allowFallback).toBe(true);
  });

  it("allowFallback can be overridden per-request", () => {
    const policy = resolvePolicy({ preset: "balanced", allowFallback: true });
    expect(policy.allowFallback).toBe(true);
  });

  it("RoutingResult includes fallback candidates", () => {
    const router = new ModelRouter();
    const results = router.evaluate({ task: "coding" });
    expect(results[0].fallbacks).toBeDefined();
    expect(results[0].fallbacks!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Explainability
// ═══════════════════════════════════════════════════════════════════════════

describe("Enhanced Explainability", () => {
  const router = new ModelRouter();

  it("explain() returns scoreBreakdown", () => {
    const result = router.explain({ task: "coding", needsTools: true });
    expect(result).not.toBeNull();
    expect(result!.scoreBreakdown).toBeDefined();
    expect(result!.scoreBreakdown!.finalScore).toBeGreaterThan(0);
  });

  it("explain() and best() return the same model", () => {
    const req: TaskRequirement = { task: "reasoning" };
    const best = router.best(req);
    const explained = router.explain(req);
    expect(best?.model).toBe(explained?.model);
    expect(best?.scoreBreakdown?.finalScore).toBe(explained?.scoreBreakdown?.finalScore);
  });

  it("plan() returns full ExecutionPlan with fallbacks", () => {
    const plan = router.plan({ task: "coding", needsTools: true }, "req_test");
    expect(plan).not.toBeNull();
    expect(plan!.fallbacks.length).toBeGreaterThan(0);
    expect(plan!.fallbacks[0].model).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 16: Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("Determinism", () => {
  const router = new ModelRouter();

  it("1000 identical evaluations produce identical results", () => {
    const req: TaskRequirement = { task: "coding", needsTools: true, budget: "medium" };
    const results: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const r = router.best(req);
      results.push(`${r?.provider}/${r?.model}:${r?.scoreBreakdown?.finalScore}`);
    }
    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });

  it("score breakdowns are deterministic", () => {
    const req: TaskRequirement = { task: "analysis", needsVision: true };
    const b1 = router.best(req)?.scoreBreakdown;
    const b2 = router.best(req)?.scoreBreakdown;
    expect(b1).toEqual(b2);
  });

  it("candidate ordering is deterministic", () => {
    const req: TaskRequirement = { task: "general" };
    const r1 = router.evaluate(req).map((r) => r.model);
    const r2 = router.evaluate(req).map((r) => r.model);
    expect(r1).toEqual(r2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 17: Adversarial
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial Inputs", () => {
  const router = new ModelRouter();

  it("invalid task type falls back to general weights", () => {
    expect(() => router.evaluate({ task: "nonexistent" as any })).not.toThrow();
    const results = router.evaluate({ task: "nonexistent" as any });
    expect(results.length).toBeGreaterThan(0);
  });

  it("negative maxCost is handled gracefully", () => {
    expect(() => router.evaluate({ maxCost: -100 })).not.toThrow();
  });

  it("maxCost=0 means no constraint", () => {
    const all = router.evaluate({});
    const filtered = router.evaluate({ maxCost: 0 });
    expect(filtered.length).toBe(all.length);
  });

  it("plan() with no models returns null", () => {
    const allModels = router.evaluate({});
    const plan = router.plan({ excludeModels: allModels.map((r) => r.model) }, "req_edge");
    expect(plan).toBeNull();
  });

  it("extreme context window values handled", () => {
    expect(() => router.evaluate({ minContextWindow: 999_999_999 })).not.toThrow();
    expect(() => router.evaluate({ minContextWindow: 0 })).not.toThrow();
  });

  it("all score values are finite numbers", () => {
    const results = router.evaluate({});
    for (const r of results) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(Number.isFinite(r.estimatedCost)).toBe(true);
      if (r.scoreBreakdown) {
        expect(Number.isFinite(r.scoreBreakdown.finalScore)).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("Concurrency", () => {
  it("concurrent routing decisions are consistent", async () => {
    const router = new ModelRouter();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(router.best({ task: "coding" })))
    );
    const models = results.map((r) => r?.model);
    expect(new Set(models).size).toBe(1);
  });

  it("separate clients have independent state", () => {
    const c1 = new HilbrasClient();
    const c2 = new HilbrasClient();
    c1.addProvider({
      name: "P1", baseUrl: "https://a.com", authentication: { type: "none" },
      adapter: "openai", models: [{ id: "m", contextWindow: 1000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
    });
    expect(c1.listProviders()).toHaveLength(1);
    expect(c2.listProviders()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Security", () => {
  it("malicious task string does not crash router", () => {
    const router = new ModelRouter();
    expect(() => router.evaluate({ task: "code; DROP TABLE; --" as any })).not.toThrow();
  });

  it("extreme budget values handled", () => {
    const router = new ModelRouter();
    expect(() => router.evaluate({ maxCost: Number.MAX_SAFE_INTEGER })).not.toThrow();
  });

  it("API keys not exposed in errors", async () => {
    const client = new HilbrasClient();
    client.addProvider({
      name: "Test", baseUrl: "https://test.com",
      authentication: { type: "bearer", apiKey: "sk-super-secret-12345" },
      adapter: "openai",
      models: [{ id: "m", contextWindow: 1000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
    });
    try {
      await client.complete({ provider: "Test", model: "m", messages: [{ role: "user", content: "hi" }] });
    } catch (err) {
      expect(String(err)).not.toContain("sk-super-secret-12345");
    }
  });
});
