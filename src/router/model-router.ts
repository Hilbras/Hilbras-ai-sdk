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
import type { ScoreBreakdown } from "../types/execution.js";
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
      const { score, reasons, breakdown } = this._score(entry, requirements);
      return { entry, score, reasons, breakdown };
    });

    scored.sort((a, b) => b.score - a.score);

    // Build fallback candidates from accepted models (excluding primary)
    const fallbacks = scored.slice(1, 6).map((s) => ({
      provider: s.entry.provider,
      model: s.entry.id,
      score: s.score,
    }));

    return scored.map((s, i) => ({
      provider: s.entry.provider,
      model: s.entry.id,
      entry: s.entry,
      score: s.score,
      estimatedCost: this._estimateCost(s.entry),
      reasons: s.reasons,
      candidates: includeCandidates ? rejected : undefined,
      scoreBreakdown: s.breakdown,
      fallbacks: i === 0 && includeCandidates ? fallbacks : undefined,
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

  /**
   * Create an execution plan — the full decision about how to execute a request.
   * Includes primary model, fallbacks, cost estimates, and reasoning.
   */
  plan(requirements: TaskRequirement, requestId: string, estimatedRetries = 1, estimatedRepairs = 0): import("../types/execution.js").ExecutionPlan | null {
    const results = this.evaluate(requirements, true);
    if (results.length === 0) return null;

    const primary = results[0];
    const fallbacks = (primary.fallbacks ?? []);
    const allCandidates = [
      { provider: primary.provider, model: primary.model, score: primary.score, estimatedCost: primary.estimatedCost, reasons: primary.reasons },
      ...fallbacks.map((f) => ({ provider: f.provider, model: f.model, score: f.score, estimatedCost: 0, reasons: [f.rejectionReason ?? ""] })),
    ];

    // Estimate total cost: primary + retries + repairs + possible fallback
    const retryCostPerAttempt = primary.estimatedCost * 0.8; // Assume retries are slightly cheaper (backoff reduces load)
    const repairCostPerAttempt = primary.estimatedCost * 0.5; // Repairs send less data
    const estimatedTotalCost =
      primary.estimatedCost
      + (retryCostPerAttempt * estimatedRetries)
      + (repairCostPerAttempt * estimatedRepairs);

    return {
      requestId,
      primary: allCandidates[0],
      fallbacks: allCandidates.slice(1),
      allCandidates,
      estimatedTotalCost,
      policy: {},
      reasoning: primary.reasons,
    };
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

  private _score(entry: ModelEntry, req: TaskRequirement): { score: number; reasons: string[]; breakdown: ScoreBreakdown } {
    const weights = TASK_WEIGHTS[req.task ?? "general"] ?? TASK_WEIGHTS.general;
    const reasons: string[] = [];

    // Capability score (0-100)
    let capCount = 0;
    if (entry.capabilities.streaming) capCount++;
    if (entry.capabilities.tools) capCount++;
    if (entry.capabilities.vision) capCount++;
    if (entry.capabilities.reasoning) capCount++;
    if (entry.capabilities.structuredOutput) capCount++;
    if (entry.capabilities.parallelTools) capCount++;
    const capabilityFit = (capCount / 6) * 100;

    if (req.needsTools && entry.capabilities.tools) reasons.push("Supports required tools");
    if (req.needsVision && entry.capabilities.vision) reasons.push("Supports required vision");
    if (req.needsReasoning && entry.capabilities.reasoning) reasons.push("Supports required reasoning");
    if (req.needsStructuredOutput && entry.capabilities.structuredOutput) reasons.push("Supports structured output");

    // Task fit score (0-100) — how well the model's capabilities match the task
    const taskFit = this._computeTaskFit(entry, req);

    // Context fit score (0-100)
    const contextFit = this._computeContextFit(entry, req);

    // Cost score (0-100) — lower cost = higher score
    const cost = this._estimateCost(entry);
    const costEfficiency = cost === 0 ? 100 : Math.max(0, 100 - (cost * 2000));

    if (req.maxCost && cost <= req.maxCost) reasons.push(`Within budget ($${cost.toFixed(4)} of $${req.maxCost})`);
    else if (req.budget) reasons.push(`Within ${req.budget} budget`);

    // Latency score (0-100) — smaller context = faster
    const latency = Math.max(0, 100 - (entry.contextWindow / 20_000));

    if (req.maxLatency && req.maxLatency !== "any") {
      const maxContext = LATENCY_CONTEXT_MAX[req.maxLatency] ?? Infinity;
      if (entry.contextWindow <= maxContext) reasons.push(`Meets ${req.maxLatency} latency preference`);
    }

    // Budget alignment (0-100)
    const budgetAlignment = this._computeBudgetAlignment(entry, req);

    // Provider preference bonus (0-10)
    const providerPreference = (req.preferredProvider && entry.provider === req.preferredProvider) ? 5 : 0;
    if (providerPreference > 0) reasons.push(`Preferred provider (${entry.provider})`);

    // Structured output fit (0-10)
    const structuredOutputFit = (req.needsStructuredOutput && entry.capabilities.structuredOutput) ? 10 : 0;

    // Tool fit (0-10)
    const toolFit = (req.needsTools && entry.capabilities.tools) ? 10 : 0;

    // Context window reason
    if (req.minContextWindow && entry.contextWindow >= req.minContextWindow) {
      reasons.push(`Context window sufficient (${entry.contextWindow.toLocaleString()} tokens)`);
    }

    // Weighted combination
    const finalScore = (capabilityFit * (weights.reasoning + weights.tools + weights.structured) / 100)
          + (taskFit * 10 / 100)
          + (contextFit * 10 / 100)
          + (costEfficiency * weights.cost / 100)
          + (latency * weights.speed / 100)
          + (budgetAlignment * 10 / 100)
          + providerPreference
          + structuredOutputFit
          + toolFit;

    const breakdown: ScoreBreakdown = {
      capabilityFit: Math.round(capabilityFit),
      taskFit: Math.round(taskFit),
      contextFit: Math.round(contextFit),
      costEfficiency: Math.round(costEfficiency),
      latency: Math.round(latency),
      budgetAlignment: Math.round(budgetAlignment),
      providerPreference,
      structuredOutputFit,
      toolFit,
      finalScore: Math.min(100, Math.max(0, Math.round(finalScore * 10) / 10)),
    };

    const score = breakdown.finalScore;

    if (reasons.length === 0) reasons.push("Best available match");

    return { score, reasons, breakdown };
  }

  // ─── Scoring Helpers ─────────────────────────────────────────────────────

  private _computeTaskFit(entry: ModelEntry, req: TaskRequirement): number {
    let fit = 50; // baseline
    if (req.task === "coding" && entry.capabilities.tools) fit += 30;
    if (req.task === "coding" && entry.capabilities.reasoning) fit += 20;
    if (req.task === "reasoning" && entry.capabilities.reasoning) fit += 40;
    if (req.task === "analysis" && entry.capabilities.reasoning) fit += 20;
    if (req.task === "analysis" && entry.capabilities.structuredOutput) fit += 20;
    if (req.task === "writing" && entry.capabilities.structuredOutput) fit += 10;
    if (req.task === "extraction" && entry.capabilities.structuredOutput) fit += 30;
    return Math.min(100, fit);
  }

  private _computeContextFit(entry: ModelEntry, req: TaskRequirement): number {
    if (!req.minContextWindow) return 70; // No preference
    const ratio = entry.contextWindow / req.minContextWindow;
    if (ratio >= 2) return 100; // Much larger than needed
    if (ratio >= 1) return 80; // Sufficient
    if (ratio >= 0.5) return 40; // Tight
    return 10; // Too small (should be filtered, but handle gracefully)
  }

  private _computeBudgetAlignment(entry: ModelEntry, req: TaskRequirement): number {
    if (!req.budget) return 50; // No preference
    const cost = this._estimateCost(entry);
    const BUDGET_SCORES: Record<string, { max: number; score: number }> = {
      low: { max: 0.01, score: 90 },
      medium: { max: 0.05, score: 70 },
      high: { max: Infinity, score: 50 },
    };
    const tier = BUDGET_SCORES[req.budget] ?? BUDGET_SCORES.high;
    if (cost <= tier.max * 0.3) return 100; // Well under budget
    if (cost <= tier.max * 0.6) return 75;  // Moderate
    if (cost <= tier.max) return 50;        // At budget
    return 20;                              // Over budget (should be filtered)
  }

  // ─── Cost Estimation ────────────────────────────────────────────────────

  private _estimateCost(entry: ModelEntry): number {
    // Estimate 1000 input + 500 output tokens as a representative request
    const result = estimateCost(1000, 500, entry.provider, entry.id);
    return result.totalCost;
  }
}
