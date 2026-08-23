/**
 * @hilbras/sdk — Policy-Based Model Router
 *
 * Deterministic, explainable routing based on constraints and scoring.
 * Evaluates all available models across registered providers and selects
 * the best one based on task requirements, capabilities, cost, and constraints.
 *
 * This is a "policy-based" router — not data-driven intelligence.
 * It will evolve into an "intelligent router" once benchmark and telemetry
 * data are available.
 *
 * Usage:
 *   const router = new ModelRouter();
 *   const result = router.evaluate({ task: "coding", needsTools: true, budget: "medium" });
 *   console.log(result[0].reasons);  // ["Supports required tools", "Within budget", ...]
 */

import type { TaskRequirement, RoutingResult, RejectedCandidate, TaskType } from "../types/router.js";
import type { ModelEntry } from "../catalog/models.js";
import { BUILTIN_MODELS } from "../catalog/models.js";
import { estimateCost } from "../tokens/counter.js";

/** Task-specific scoring weights — defines what matters for each task type */
const TASK_WEIGHTS: Record<TaskType, { reasoning: number; tools: number; speed: number; cost: number; structured: number }> = {
  coding:         { reasoning: 25, tools: 25, speed: 15, cost: 20, structured: 15 },
  reasoning:      { reasoning: 40, tools: 10, speed: 10, cost: 25, structured: 15 },
  analysis:       { reasoning: 30, tools: 15, speed: 15, cost: 25, structured: 15 },
  writing:        { reasoning: 15, tools: 5,  speed: 20, cost: 45, structured: 15 },
  translation:    { reasoning: 10, tools: 5,  speed: 30, cost: 45, structured: 10 },
  summarization:  { reasoning: 20, tools: 5,  speed: 25, cost: 40, structured: 10 },
  extraction:     { reasoning: 20, tools: 10, speed: 20, cost: 30, structured: 20 },
  classification: { reasoning: 25, tools: 10, speed: 20, cost: 30, structured: 15 },
  general:        { reasoning: 15, tools: 15, speed: 25, cost: 40, structured: 5 },
};

/** Budget tier cost caps (per request, USD) */
const BUDGET_CAPS: Record<string, number> = {
  low: 0.01,
  medium: 0.05,
  high: Infinity,
};

/** Latency tier context window maximums (larger = typically slower) */
const LATENCY_CONTEXT_MAX: Record<string, number> = {
  fast: 200_000,
  standard: 1_000_000,
  any: Infinity,
};

export class ModelRouter {
  private _models: ModelEntry[];
  private _registeredProviders: Set<string>;

  constructor(registeredProviders?: string[]) {
    this._models = [...BUILTIN_MODELS];
    this._registeredProviders = new Set(registeredProviders ?? []);
  }

  /** Update the list of registered providers (called when addProvider/removeProvider happen) */
  updateProviders(providers: string[]): void {
    this._registeredProviders = new Set(providers);
  }

  /** Add custom models to the catalog */
  addModels(models: ModelEntry[]): void {
    this._models.push(...models);
  }

  /**
   * Evaluate all models against requirements and return sorted results.
   * The first result is the best match.
   */
  evaluate(requirements: TaskRequirement, includeCandidates = true): RoutingResult[] {
    const { accepted, rejected } = this._filterWithRejection(requirements);
    if (accepted.length === 0) return [];

    const scored = accepted.map((entry) => {
      const { score, reasons } = this._score(entry, requirements);
      return { entry, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map((s, i) => ({
      provider: s.entry.provider,
      model: s.entry.id,
      entry: s.entry,
      score: s.score,
      estimatedCost: this._estimateCost(s.entry),
      reasons: s.reasons,
      candidates: includeCandidates ? rejected : undefined,
    }));
  }

  /** Get the single best model */
  best(requirements: TaskRequirement): RoutingResult | null {
    const results = this.evaluate(requirements);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Explain a routing decision — returns the best model with full audit trail.
   * Always includes rejected candidates for debugging.
   *
   * @example
   * const decision = client.router.explain({ task: "coding", needsTools: true, maxCost: 0.05 });
   * console.log(decision.reasons);  // ["Supports required tools", "Within budget"]
   * console.log(decision.candidates); // [{ model: "...", rejectionReason: "..." }]
   */
  explain(requirements: TaskRequirement): RoutingResult | null {
    const results = this.evaluate(requirements, true);
    return results.length > 0 ? results[0] : null;
  }

  // ─── Filtering with Rejection Reasons ──────────────────────────────────

  private _filterWithRejection(req: TaskRequirement): { accepted: ModelEntry[]; rejected: RejectedCandidate[] } {
    const accepted: ModelEntry[] = [];
    const rejected: RejectedCandidate[] = [];

    for (const m of this._models) {
      const rejection = this._checkRejection(m, req);
      if (rejection) {
        rejected.push({
          provider: m.provider,
          model: m.id,
          score: 0,
          rejectionReason: rejection,
        });
      } else {
        accepted.push(m);
      }
    }

    return { accepted, rejected };
  }

  /** Returns rejection reason if the model should be excluded, null if valid */
  private _checkRejection(entry: ModelEntry, req: TaskRequirement): string | null {
    // Exclude by ID or alias
    if (req.excludeModels?.includes(entry.id)) return "Excluded by excludeModels";
    if (req.excludeModels?.some((ex) => entry.aliases?.includes(ex))) return "Excluded by alias";

    // Must be from a registered provider (if any are registered)
    if (this._registeredProviders.size > 0 && !this._registeredProviders.has(entry.provider)) {
      return `Provider '${entry.provider}' is not registered`;
    }

    // Capability requirements
    if (req.needsVision && !entry.capabilities.vision) return "Missing required capability: vision";
    if (req.needsTools && !entry.capabilities.tools) return "Missing required capability: tools";
    if (req.needsReasoning && !entry.capabilities.reasoning) return "Missing required capability: reasoning";
    if (req.needsStructuredOutput && !entry.capabilities.structuredOutput) return "Missing required capability: structuredOutput";

    // Context window requirement
    if (req.minContextWindow && entry.contextWindow < req.minContextWindow) {
      return `Context window too small (${entry.contextWindow} < ${req.minContextWindow})`;
    }

    // Cost constraint
    if (req.maxCost && req.maxCost > 0) {
      const cost = this._estimateCost(entry);
      if (cost > req.maxCost) return `Estimated cost exceeds budget ($${cost.toFixed(4)} > $${req.maxCost})`;
    }

    // Budget constraint
    if (req.budget) {
      const cap = BUDGET_CAPS[req.budget] ?? Infinity;
      if (cap < Infinity) {
        const cost = this._estimateCost(entry);
        if (cost > cap) return `Estimated cost exceeds ${req.budget} budget ($${cost.toFixed(4)} > $${cap})`;
      }
    }

    // Latency constraint
    if (req.maxLatency && req.maxLatency !== "any") {
      const maxContext = LATENCY_CONTEXT_MAX[req.maxLatency] ?? Infinity;
      if (entry.contextWindow > maxContext) {
        return `Context window too large for ${req.maxLatency} latency preference`;
      }
    }

    return null; // Not rejected
  }

  // ─── Scoring ────────────────────────────────────────────────────────────

  private _score(entry: ModelEntry, req: TaskRequirement): { score: number; reasons: string[] } {
    const weights = TASK_WEIGHTS[req.task ?? "general"];
    const reasons: string[] = [];
    let score = 0;

    // Capability score (0-100)
    let capCount = 0;
    if (entry.capabilities.streaming) capCount++;
    if (entry.capabilities.tools) capCount++;
    if (entry.capabilities.vision) capCount++;
    if (entry.capabilities.reasoning) capCount++;
    if (entry.capabilities.structuredOutput) capCount++;
    if (entry.capabilities.parallelTools) capCount++;
    const capScore = (capCount / 6) * 100;

    if (req.needsTools && entry.capabilities.tools) reasons.push("Supports required tools");
    if (req.needsVision && entry.capabilities.vision) reasons.push("Supports required vision");
    if (req.needsReasoning && entry.capabilities.reasoning) reasons.push("Supports required reasoning");
    if (req.needsStructuredOutput && entry.capabilities.structuredOutput) reasons.push("Supports structured output");

    // Cost score (0-100) — lower cost = higher score
    const cost = this._estimateCost(entry);
    const costScore = cost === 0 ? 100 : Math.max(0, 100 - (cost * 2000));

    if (req.maxCost && cost <= req.maxCost) reasons.push(`Within budget ($${cost.toFixed(4)} of $${req.maxCost})`);
    else if (req.budget) reasons.push(`Within ${req.budget} budget`);

    // Speed score (0-100) — smaller context = faster
    const speedScore = Math.max(0, 100 - (entry.contextWindow / 20_000));

    if (req.maxLatency && req.maxLatency !== "any") {
      const maxContext = LATENCY_CONTEXT_MAX[req.maxLatency] ?? Infinity;
      if (entry.contextWindow <= maxContext) reasons.push(`Meets ${req.maxLatency} latency preference`);
    }

    // Reasoning bonus
    const reasoningBonus = (req.needsReasoning && entry.capabilities.reasoning) ? 20 : 0;

    // Weighted combination
    score = (capScore * (weights.reasoning + weights.tools + weights.structured) / 100)
          + (costScore * weights.cost / 100)
          + (speedScore * weights.speed / 100)
          + reasoningBonus;

    // Provider preference bonus
    if (req.preferredProvider && entry.provider === req.preferredProvider) {
      score += 5;
      reasons.push(`Preferred provider (${entry.provider})`);
    }

    // Context window reason
    if (req.minContextWindow && entry.contextWindow >= req.minContextWindow) {
      reasons.push(`Context window sufficient (${entry.contextWindow.toLocaleString()} tokens)`);
    }

    // Clamp to 0-100
    score = Math.min(100, Math.max(0, Math.round(score * 10) / 10));

    if (reasons.length === 0) reasons.push("Best available match");

    return { score, reasons };
  }

  // ─── Cost Estimation ────────────────────────────────────────────────────

  private _estimateCost(entry: ModelEntry): number {
    // Estimate 1000 input + 500 output tokens as a representative request
    const result = estimateCost(1000, 500, entry.provider, entry.id);
    return result.totalCost;
  }
}
