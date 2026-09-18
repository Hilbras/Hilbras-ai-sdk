/**
 * @hilbras/eval — Evaluate
 *
 * Core evaluation function that runs metrics against a dataset.
 */

import type {
  EvalDataset,
  EvalConfig,
  EvalResult,
  EvalItemResult,
  EvalEvent,
  MetricConfig,
  MetricResult,
} from "./types.js";
import { exactMatch, contains, similarity, toxicity, coherence } from "./metrics.js";

function getMetricFn(name: string, config?: MetricConfig): (output: string, item: EvalDatasetItem) => MetricResult | Promise<MetricResult> {
  switch (name) {
    case "exact_match": return exactMatch;
    case "contains": return contains;
    case "similarity": return similarity;
    case "toxicity": return toxicity;
    case "coherence": return coherence;
    default:
      if (config?.custom) return config.custom;
      throw new UnknownMetricError(name);
  }
}

export class UnknownMetricError extends Error {
  constructor(metric: string) {
    super(`Unknown metric "${metric}". Use built-in metrics (exact_match, contains, similarity, toxicity, coherence) or provide a custom function.`);
    this.name = "UnknownMetricError";
  }
}

/**
 * Evaluate a dataset against metrics.
 *
 * @example
 * ```typescript
 * const result = await evaluate({
 *   dataset: {
 *     name: "math-qa",
 *     items: [
 *       { id: "1", input: "What is 2+2?", expected: "4" },
 *       { id: "2", input: "What is 3+3?", expected: "6" },
 *     ],
 *   },
 *   config: {
 *     metrics: [
 *       { name: "exact_match", threshold: 1 },
 *       { name: "contains", threshold: 0.5 },
 *     ],
 *   },
 * });
 * console.log(result.passRate); // 1.0
 * ```
 */
export async function evaluate(params: {
  dataset: EvalDataset;
  config: EvalConfig;
  /** Function to generate output from input */
  generate: (input: string) => Promise<string>;
}): Promise<EvalResult> {
  const { dataset, config, generate } = params;
  const { metrics: metricConfigs, concurrency = 5, signal, onEvent } = config;

  const startTime = Date.now();
  const results: EvalItemResult[] = [];

  // Process items with concurrency limit
  const queue = [...dataset.items.entries()];
  const active: Promise<void>[] = [];

  async function processItem(index: number, item: EvalDatasetItem): Promise<void> {
    if (signal?.aborted) return;

    onEvent?.({ type: "item_start", index, item });

    let output: string;
    try {
      output = await generate(item.input);
    } catch (error) {
      const result: EvalItemResult = {
        item,
        output: "",
        metrics: [],
        passed: false,
        error: (error as Error).message,
      };
      results[index] = result;
      onEvent?.({ type: "item_complete", index, result });
      return;
    }

    // Compute metrics
    const metricResults: MetricResult[] = [];
    let allPassed = true;

    for (const metricConfig of metricConfigs) {
      if (signal?.aborted) break;

      const threshold = metricConfig.threshold ?? 0.7;
      const metricFn = getMetricFn(metricConfig.name, metricConfig);

      try {
        const metricResult = await metricFn(output, item);
        // Override threshold
        metricResult.passed = metricResult.score >= threshold;
        metricResults.push(metricResult);

        if (!metricResult.passed) allPassed = false;

        onEvent?.({ type: "metric_complete", index, metric: metricResult });
      } catch (error) {
        metricResults.push({
          name: metricConfig.name,
          score: 0,
          passed: false,
          explanation: (error as Error).message,
        });
        allPassed = false;
      }
    }

    const result: EvalItemResult = {
      item,
      output,
      metrics: metricResults,
      passed: allPassed,
    };
    results[index] = result;
    onEvent?.({ type: "item_complete", index, result });
  }

  // Process with concurrency
  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const [index, item] = queue.shift()!;
      const p = processItem(index, item).then(() => {
        active.splice(active.indexOf(p), 1);
      });
      active.push(p);
    }
    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  // Compute aggregates
  const validResults = results.filter(Boolean);
  const totalItems = validResults.length;
  const passedItems = validResults.filter((r) => r.passed).length;

  const aggregates: Record<string, number> = {};
  for (const metricConfig of metricConfigs) {
    const metricScores = validResults
      .map((r) => r.metrics.find((m) => m.name === metricConfig.name))
      .filter(Boolean)
      .map((m) => m!.score);
    aggregates[metricConfig.name] = metricScores.length > 0
      ? metricScores.reduce((a, b) => a + b, 0) / metricScores.length
      : 0;
  }

  const evalResult: EvalResult = {
    dataset: dataset.name,
    items: validResults,
    aggregates,
    passRate: totalItems > 0 ? passedItems / totalItems : 0,
    totalItems,
    passedItems,
    failedItems: totalItems - passedItems,
    durationMs: Date.now() - startTime,
  };

  onEvent?.({ type: "complete", result: evalResult });
  return evalResult;
}
