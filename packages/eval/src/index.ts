/**
 * @hilbras/eval — Evaluation & Testing Framework
 *
 * LLM output evaluation with built-in metrics and custom metric support.
 */

export { evaluate, UnknownMetricError } from "./evaluate.js";
export { exactMatch, contains, similarity, toxicity, coherence, llmJudge } from "./metrics.js";
export type {
  EvalDataset,
  EvalDatasetItem,
  EvalConfig,
  EvalResult,
  EvalItemResult,
  MetricConfig,
  MetricResult,
  MetricName,
  EvalEvent,
} from "./types.js";
