/**
 * @hilbras/sdk — Router cost weighting (A4, A5, F1b)
 *
 * `estimateCost` returns 0 for a model with no known price, which used to score
 * as perfect cost efficiency; and the weighted score was clamped at 100 while
 * the sum can reach ~155, so most models tied and ranking fell back to catalog
 * order. Both made cost-weighted routing inert.
 *
 * `ModelRouter` always seeds the built-in catalog, so these assert on score
 * properties rather than on a specific winner.
 */

import { describe, it, expect } from "vitest";
import { ModelRouter } from "../src/router/model-router.js";
import { hasPricing, estimateCost } from "../src/tokens/counter.js";
import type { ModelEntry } from "../src/catalog/models.js";
import type { ModelCapabilities } from "../src/types/models.js";

const FULL_CAPS: ModelCapabilities = {
  streaming: true, tools: true, vision: true, reasoning: true,
  structuredOutput: true, parallelTools: true, systemPrompts: true,
  embeddings: false, imageGeneration: false, speech: false, transcription: false, reranking: false,
};

const EXTRA_MODELS: ModelEntry[] = [
  // Priced high: $4 / $20 per 1M tokens.
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: FULL_CAPS },
  // Priced low: $0.30 / $2.50 per 1M tokens.
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS },
  // No published price at all.
  { id: "acme-mystery-1", name: "Acme Mystery", provider: "acme", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS },
];

function router(): ModelRouter {
  const instance = new ModelRouter(["openai", "google-genai", "acme"]);
  instance.addModels(EXTRA_MODELS);
  return instance;
}

function breakdownFor(task: "writing", id: string) {
  const results = router().evaluate({ task, needsTools: true });
  const found = results.find((r) => r.model === id);
  expect(found, `expected ${id} to be a scored candidate`).toBeDefined();
  return found!.scoreBreakdown!;
}

describe("router cost weighting", () => {
  it("sanity: the fixtures really are priced high / low / unknown", () => {
    expect(estimateCost(1000, 500, "openai", "gpt-5.6-sol").totalCost).toBeGreaterThan(
      estimateCost(1000, 500, "google-genai", "gemini-2.5-flash").totalCost,
    );
    expect(hasPricing("openai", "gpt-5.6-sol")).toBe(true);
    expect(hasPricing("google-genai", "gemini-2.5-flash")).toBe(true);
    expect(hasPricing("acme", "acme-mystery-1")).toBe(false);
  });

  it("scores a model with no known price as worst on cost, not best", () => {
    expect(breakdownFor("writing", "acme-mystery-1").costEfficiency).toBe(0);
    expect(breakdownFor("writing", "gemini-2.5-flash").costEfficiency).toBeGreaterThan(0);
  });

  it("ranks the cheaper priced model above the more expensive one on cost", () => {
    const cheap = breakdownFor("writing", "gemini-2.5-flash").costEfficiency;
    const expensive = breakdownFor("writing", "gpt-5.6-sol").costEfficiency;

    expect(cheap).toBeGreaterThan(expensive);
  });

  it("does not collapse distinct candidates onto one clamped score", () => {
    const results = router().evaluate({ task: "writing", needsTools: true });
    const scores = results.map((r) => r.score);

    expect(scores.length).toBeGreaterThan(1);
    expect(new Set(scores).size).toBeGreaterThan(1);
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("plan() reports a real reason for every fallback and a cost for priced ones", () => {
    const plan = router().plan({ task: "writing", needsTools: true }, "req-1");

    expect(plan).not.toBeNull();
    expect(plan!.fallbacks.length).toBeGreaterThan(0);

    for (const fallback of plan!.fallbacks) {
      expect(fallback.reasons[0]).toBeTruthy();
      expect(typeof fallback.estimatedCost).toBe("number");
    }

    expect(plan!.fallbacks.some((f) => (f.estimatedCost ?? 0) > 0)).toBe(true);
  });
});
