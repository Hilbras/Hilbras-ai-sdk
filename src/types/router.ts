/**
 * @hilbras/sdk — Model Router Types
 *
 * Describes what a task needs so the router can pick the best model
 * across all registered providers.
 *
 * Usage:
 *   client.stream({ task: "coding", messages, policy: { maxCost: 0.05 } });
 */

import type { ModelEntry } from "../catalog/models.js";

/** What the developer needs — the router evaluates all models against this */
export interface TaskRequirement {
  /** Task category — influences scoring ("coding", "writing", "analysis", "translation", "general") */
  task?: string;

  /** Required capabilities — models missing these are excluded */
  needsVision?: boolean;
  needsTools?: boolean;
  needsReasoning?: boolean;
  needsStructuredOutput?: boolean;

  /** Cost constraint — max cost per request in USD (0 = no limit) */
  maxCost?: number;

  /** Speed preference */
  maxLatency?: "fast" | "standard" | "any";

  /** Minimum context window required (tokens) */
  minContextWindow?: number;

  /** Budget tier — maps to cost ranges: low (<$0.01), medium (<$0.05), high (any) */
  budget?: "low" | "medium" | "high";

  /** Models to exclude from consideration */
  excludeModels?: string[];

  /** Preferred provider — gets a score bonus when candidates are close */
  preferredProvider?: string;
}

/** A routing decision — the best model for the given requirements */
export interface RoutingResult {
  /** Which provider to use */
  provider: string;
  /** Which model to use */
  model: string;
  /** The full model catalog entry */
  entry: ModelEntry;
  /** Match score 0-100 — higher is better */
  score: number;
  /** Estimated cost per request in USD */
  estimatedCost: number;
}
