/**
 * @hilbras/sdk — A/B Prompt Testing
 *
 * Compare multiple prompt variants against a shared dataset to find
 * the best-performing system prompt for your use case.
 */

import type { HilbrasClient } from "../../client/client.js";
import { evaluate } from "./evaluate.js";
import type { EvalDatasetItem, EvalResult, MetricConfig } from "./types.js";

/** A prompt variant to test */
export interface PromptVariant {
  /** Display name for this variant */
  name: string;
  /** The system prompt to use */
  systemPrompt: string;
  /** Model override for this variant (uses client default if omitted) */
  model?: string;
  /** Provider override for this variant */
  provider?: string;
  /** Temperature override for this variant */
  temperature?: number;
  /** Max tokens override for this variant */
  maxTokens?: number;
}

/** Configuration for an A/B test */
export interface ABTestConfig {
  /** Prompt variants to compare */
  variants: PromptVariant[];
  /** Test dataset — input/expected pairs */
  dataset: EvalDatasetItem[];
  /** Metric configurations (default: exact_match + contains, threshold 0.7) */
  metrics?: MetricConfig[];
  /** Max concurrent evaluations (default: 5) */
  concurrency?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

/** Result for a single variant */
export interface VariantResult {
  /** Variant name */
  name: string;
  /** The system prompt used */
  systemPrompt: string;
  /** Full evaluation result from the evaluate() function */
  evalResult: EvalResult;
  /** Aggregate score across all metrics (0-1) */
  aggregateScore: number;
}

/** The complete A/B test result */
export interface ABTestResult {
  /** Results for each variant, sorted by aggregate score (best first) */
  variants: VariantResult[];
  /** The winning variant (highest aggregate score) */
  winner: VariantResult;
  /** Margin of victory over the runner-up (0 if only one variant) */
  margin: number;
}

/**
 * Run an A/B test comparing prompt variants against a dataset.
 *
 * Each variant is evaluated using the built-in metrics, and the
 * variant with the highest aggregate score wins.
 *
 * @example
 * ```ts
 * const result = await runABTest(client, {
 *   variants: [
 *     { name: "concise", systemPrompt: "Answer concisely." },
 *     { name: "detailed", systemPrompt: "Answer in detail with examples." },
 *   ],
 *   dataset: [
 *     { id: "1", input: "What is 2+2?", expected: "4" },
 *     { id: "2", input: "Capital of France?", expected: "Paris" },
 *   ],
 * });
 *
 * console.log(`Winner: ${result.winner.name} (${(result.winner.aggregateScore * 100).toFixed(1)}%)`);
 * ```
 */
export async function runABTest(
  client: HilbrasClient,
  config: ABTestConfig,
): Promise<ABTestResult> {
  const {
    variants,
    dataset,
    metrics = [
      { name: "exact_match", threshold: 0.7 },
      { name: "contains", threshold: 0.7 },
    ],
    concurrency = 5,
    signal,
  } = config;

  if (variants.length < 2) {
    throw new Error("A/B test requires at least 2 variants");
  }
  if (dataset.length === 0) {
    throw new Error("A/B test requires a non-empty dataset");
  }

  // Run evaluation for each variant
  const variantResults: VariantResult[] = [];

  for (const variant of variants) {
    if (signal?.aborted) break;

    // Create a generate function that sends the variant's system prompt
    const generate = async (input: string): Promise<string> => {
      const result = await client.complete({
        provider: variant.provider,
        model: variant.model,
        messages: [
          { role: "system", content: variant.systemPrompt },
          { role: "user", content: input },
        ],
        temperature: variant.temperature,
        maxTokens: variant.maxTokens,
        signal,
      });
      return typeof result === "string" ? result : JSON.stringify(result);
    };

    const evalResult = await evaluate({
      dataset: { name: `ab-test-${variant.name}`, items: dataset },
      config: {
        metrics,
        concurrency,
        signal,
      },
      generate,
    });

    const aggregateScore = computeAggregateScore(evalResult);

    variantResults.push({
      name: variant.name,
      systemPrompt: variant.systemPrompt,
      evalResult,
      aggregateScore,
    });
  }

  // Sort by aggregate score (best first)
  variantResults.sort((a, b) => b.aggregateScore - a.aggregateScore);

  const winner = variantResults[0];
  const runnerUp = variantResults[1];
  const margin = runnerUp
    ? winner.aggregateScore - runnerUp.aggregateScore
    : 0;

  return {
    variants: variantResults,
    winner,
    margin,
  };
}

/**
 * Compute an aggregate score from an EvalResult by averaging
 * all metric aggregates.
 */
function computeAggregateScore(result: EvalResult): number {
  const keys = Object.keys(result.aggregates);
  if (keys.length === 0) return 0;
  const total = keys.reduce((sum, k) => sum + (result.aggregates[k] ?? 0), 0);
  return total / keys.length;
}
