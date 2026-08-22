/**
 * @hilbras/sdk — Model Router Types
 *
 * Describes what a task needs so the router can pick the best model
 * across all registered providers.
 *
 * The router is "policy-based" for v0.5.x — deterministic, explainable
 * routing based on constraints and scoring. Will evolve into data-driven
 * "intelligent" routing once benchmark and telemetry data are available.
 */

import type { ModelEntry } from "../catalog/models.js";

/** Controlled task taxonomy — each task type has associated scoring weights */
export type TaskType =
  | "coding"
  | "reasoning"
  | "analysis"
  | "writing"
  | "translation"
  | "summarization"
  | "extraction"
  | "classification"
  | "general";

/** What the developer needs — the router evaluates all models against this */
export interface TaskRequirement {
  /** Task category — influences scoring weights */
  task?: TaskType;

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

/** A candidate that was evaluated but not selected */
export interface RejectedCandidate {
  provider: string;
  model: string;
  score: number;
  rejectionReason: string;
}

/** A routing decision — explainable, with full audit trail */
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
  /** Human-readable reasons why this model was selected */
  reasons: string[];
  /** Other candidates that were evaluated and why they were rejected */
  candidates?: RejectedCandidate[];
}
