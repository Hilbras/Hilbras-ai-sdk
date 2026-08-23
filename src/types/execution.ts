/**
 * @hilbras/sdk — Execution Plan Types
 *
 * An ExecutionPlan represents the SDK's decision about how to execute
 * a request. It contains the primary model, fallback candidates, cost
 * estimates, and the reasoning behind the decision.
 *
 * The execution plan is deterministic for the same inputs.
 */

import type { RoutingResult } from "./router.js";
import type { ExecutionPolicy } from "./policy.js";

/** A single candidate in the execution plan */
export interface ExecutionCandidate {
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** Match score 0-100 */
  score: number;
  /** Estimated cost per request in USD */
  estimatedCost: number;
  /** Human-readable reasons for selection/rejection */
  reasons: string[];
  /** Whether this candidate was rejected and why */
  rejected?: boolean;
  rejectionReason?: string;
}

/** Score breakdown for explainability */
export interface ScoreBreakdown {
  /** Capability match score (0-100) */
  capabilityFit: number;
  /** Task compatibility score (0-100) */
  taskFit: number;
  /** Context window fit score (0-100) */
  contextFit: number;
  /** Cost efficiency score (0-100) */
  costEfficiency: number;
  /** Latency score (0-100) */
  latency: number;
  /** Budget alignment score (0-100) */
  budgetAlignment: number;
  /** Provider preference bonus (0-10) */
  providerPreference: number;
  /** Structured output compatibility (0-10) */
  structuredOutputFit: number;
  /** Tool compatibility (0-10) */
  toolFit: number;
  /** Final weighted score */
  finalScore: number;
}

/** The execution plan — the SDK's decision about how to execute a request */
export interface ExecutionPlan {
  /** Unique request ID */
  requestId: string;
  /** The primary model to try first */
  primary: ExecutionCandidate;
  /** Fallback candidates in priority order */
  fallbacks: ExecutionCandidate[];
  /** All evaluated candidates (including rejected) */
  allCandidates: ExecutionCandidate[];
  /** Estimated total cost (primary + potential retries + potential repairs) */
  estimatedTotalCost: number;
  /** The execution policy that was applied */
  policy: ExecutionPolicy;
  /** Why this plan was selected */
  reasoning: string[];
}
