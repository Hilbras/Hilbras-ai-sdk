/**
 * @hilbras/sdk — Model Router tests
 */

import { describe, it, expect } from "vitest";
import { ModelRouter } from "../src/router/model-router.js";

describe("ModelRouter", () => {
  const router = new ModelRouter(["openai", "anthropic", "google-genai", "groq", "ollama"]);

  it("returns results for empty requirements (all models)", () => {
    const results = router.evaluate({});
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].provider).toBeTruthy();
    expect(results[0].model).toBeTruthy();
  });

  it("filters by needsVision", () => {
    const results = router.evaluate({ needsVision: true });
    for (const r of results) {
      expect(r.entry.capabilities.vision).toBe(true);
    }
  });

  it("filters by needsReasoning", () => {
    const results = router.evaluate({ needsReasoning: true });
    for (const r of results) {
      expect(r.entry.capabilities.reasoning).toBe(true);
    }
  });

  it("filters by needsTools", () => {
    const results = router.evaluate({ needsTools: true });
    for (const r of results) {
      expect(r.entry.capabilities.tools).toBe(true);
    }
  });

  it("filters by minContextWindow", () => {
    const results = router.evaluate({ minContextWindow: 500_000 });
    for (const r of results) {
      expect(r.entry.contextWindow).toBeGreaterThanOrEqual(500_000);
    }
  });

  it("filters by maxCost", () => {
    const results = router.evaluate({ maxCost: 0.001 });
    for (const r of results) {
      expect(r.estimatedCost).toBeLessThanOrEqual(0.001);
    }
  });

  it("filters by budget low", () => {
    const results = router.evaluate({ budget: "low" });
    for (const r of results) {
      expect(r.estimatedCost).toBeLessThanOrEqual(0.01);
    }
  });

  it("excludes specific models", () => {
    const results = router.evaluate({ excludeModels: ["gpt-5.6-sol"] });
    for (const r of results) {
      expect(r.model).not.toBe("gpt-5.6-sol");
    }
  });

  it("best() returns single top result or null", () => {
    const best = router.best({ task: "coding" });
    if (best) {
      expect(best.score).toBeGreaterThan(0);
      expect(best.provider).toBeTruthy();
    }
  });

  it("best() returns null when no models match", () => {
    const best = router.best({ minContextWindow: 999_999_999 });
    expect(best).toBeNull();
  });

  it("preferredProvider gives bonus", () => {
    const withPref = router.evaluate({ preferredProvider: "openai" });
    const withoutPref = router.evaluate({});
    // At least one openai model should rank higher with preference
    const topWithPref = withPref[0];
    expect(topWithPref.provider).toBe("openai");
  });

  it("scores results in descending order", () => {
    const results = router.evaluate({ task: "coding" });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it("all results have valid RoutingResult shape with reasons", () => {
    const results = router.evaluate({ task: "general" });
    for (const r of results.slice(0, 5)) {
      expect(typeof r.provider).toBe("string");
      expect(typeof r.model).toBe("string");
      expect(typeof r.score).toBe("number");
      expect(typeof r.estimatedCost).toBe("number");
      expect(r.entry).toBeDefined();
      expect(typeof r.entry.contextWindow).toBe("number");
      // Explainable routing — reasons array
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("includes rejected candidates with reasons", () => {
    const results = router.evaluate({ needsVision: true, maxCost: 0.001 });
    expect(results.length).toBeGreaterThan(0);
    const best = results[0];
    // Should have candidates array with rejected models
    expect(Array.isArray(best.candidates)).toBe(true);
    const rejected = best.candidates!.filter((c) => c.rejectionReason);
    expect(rejected.length).toBeGreaterThan(0);
    // Each rejection has a reason
    for (const r of rejected) {
      expect(typeof r.rejectionReason).toBe("string");
      expect(r.rejectionReason.length).toBeGreaterThan(0);
    }
  });

  it("reasons reflect task requirements", () => {
    const results = router.evaluate({ needsTools: true, task: "coding" });
    expect(results.length).toBeGreaterThan(0);
    const reasons = results[0].reasons;
    expect(reasons.some((r) => r.includes("tools"))).toBe(true);
  });

  it("can suppress candidates in evaluate()", () => {
    const results = router.evaluate({ task: "coding" }, false);
    expect(results[0].candidates).toBeUndefined();
  });
});
