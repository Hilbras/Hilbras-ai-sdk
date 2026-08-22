/**
 * @hilbras/sdk — Intelligent Model Router
 *
 * Evaluates all available models across registered providers and selects
 * the best one based on task requirements, capabilities, cost, and constraints.
 *
 * Usage:
 *   const router = new ModelRouter();
 *   const result = router.evaluate({ task: "coding", needsTools: true, budget: "medium" });
 *   console.log(result.provider, result.model, result.score);
 */

import type { TaskRequirement, RoutingResult } from "../types/router.js";
import type { ModelEntry } from "../catalog/models.js";
import { BUILTIN_MODELS } from "../catalog/models.js";
import { estimateCost } from "../tokens/counter.js";

/** Task-specific scoring weights */
const TASK_WEIGHTS: Record<string, { reasoning: number; tools: number; speed: number; cost: number }> = {
  coding:     { reasoning: 30, tools: 30, speed: 15, cost: 25 },
  writing:    { reasoning: 20, tools: 5,  speed: 20, cost: 55 },
  analysis:   { reasoning: 35, tools: 15, speed: 15, cost: 35 },
  translation:{ reasoning: 10, tools: 5,  speed: 30, cost: 55 },
  general:    { reasoning: 15, tools: 15, speed: 25, cost: 45 },
};

const DEFAULT_WEIGHTS = TASK_WEIGHTS.general;

/** Budget tier cost caps (per request, USD) */
const BUDGET_CAPS: Record<string, number> = {
  low: 0.01,
  medium: 0.05,
  high: Infinity,
};

/** Latency tier context window minimums (larger = typically slower) */
const LATENCY_CONTEXT_MAX: Record<string, number> = {
  fast: 200_000,      // Smaller models tend to be faster
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
   * If no registered providers are set, returns all catalog models.
   */
  evaluate(requirements: TaskRequirement): RoutingResult[] {
    const candidates = this._filter(requirements);
    if (candidates.length === 0) return [];

    const scored = candidates.map((entry) => ({
      result: this._score(entry, requirements),
      entry,
    }));

    scored.sort((a, b) => b.result.score - a.result.score);
    return scored.map((s) => s.result);
  }

  /** Get the single best model */
  best(requirements: TaskRequirement): RoutingResult | null {
    const results = this.evaluate(requirements);
    return results.length > 0 ? results[0] : null;
  }

  // ─── Filtering ──────────────────────────────────────────────────────────

  private _filter(req: TaskRequirement): ModelEntry[] {
    return this._models.filter((m) => {
      // Exclude by ID or alias
      if (req.excludeModels?.includes(m.id)) return false;
      if (req.excludeModels?.some((ex) => m.aliases?.includes(ex))) return false;

      // Must be from a registered provider (if any are registered)
      if (this._registeredProviders.size > 0 && !this._registeredProviders.has(m.provider)) {
        return false;
      }

      // Capability requirements
      if (req.needsVision && !m.capabilities.vision) return false;
      if (req.needsTools && !m.capabilities.tools) return false;
      if (req.needsReasoning && !m.capabilities.reasoning) return false;
      if (req.needsStructuredOutput && !m.capabilities.structuredOutput) return false;

      // Context window requirement
      if (req.minContextWindow && m.contextWindow < req.minContextWindow) return false;

      // Cost constraint
      if (req.maxCost && req.maxCost > 0) {
        const cost = this._estimateCost(m);
        if (cost > req.maxCost) return false;
      }

      // Budget constraint
      if (req.budget) {
        const cap = BUDGET_CAPS[req.budget] ?? Infinity;
        if (cap < Infinity) {
          const cost = this._estimateCost(m);
          if (cost > cap) return false;
        }
      }

      // Latency constraint
      if (req.maxLatency && req.maxLatency !== "any") {
        const maxContext = LATENCY_CONTEXT_MAX[req.maxLatency] ?? Infinity;
        if (m.contextWindow > maxContext) return false;
      }

      return true;
    });
  }

  // ─── Scoring ────────────────────────────────────────────────────────────

  private _score(entry: ModelEntry, req: TaskRequirement): RoutingResult {
    const weights = TASK_WEIGHTS[req.task ?? "general"] ?? DEFAULT_WEIGHTS;
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

    // Cost score (0-100) — lower cost = higher score
    const cost = this._estimateCost(entry);
    const costScore = cost === 0 ? 100 : Math.max(0, 100 - (cost * 2000));

    // Speed score (0-100) — smaller context = faster
    const speedScore = Math.max(0, 100 - (entry.contextWindow / 20_000));

    // Reasoning bonus
    const reasoningBonus = (req.needsReasoning && entry.capabilities.reasoning) ? 20 : 0;

    // Weighted combination
    score = (capScore * (weights.reasoning + weights.tools) / 100)
          + (costScore * weights.cost / 100)
          + (speedScore * weights.speed / 100)
          + reasoningBonus;

    // Provider preference bonus
    if (req.preferredProvider && entry.provider === req.preferredProvider) {
      score += 5;
    }

    // Clamp to 0-100
    score = Math.min(100, Math.max(0, Math.round(score)));

    return {
      provider: entry.provider,
      model: entry.id,
      entry,
      score,
      estimatedCost: cost,
    };
  }

  // ─── Cost Estimation ────────────────────────────────────────────────────

  private _estimateCost(entry: ModelEntry): number {
    // Estimate 1000 input + 500 output tokens as a representative request
    const result = estimateCost(1000, 500, entry.provider, entry.id);
    return result.totalCost;
  }
}
