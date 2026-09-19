/**
 * @hilbras/eval — Types
 *
 * Core types for the evaluation framework.
 */

export interface EvalDatasetItem {
  /** Unique identifier */
  id: string;
  /** Input prompt */
  input: string;
  /** Expected output (ground truth) */
  expected?: string;
  /** Context/references for RAG evaluation */
  context?: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface EvalDataset {
  /** Dataset name */
  name: string;
  /** Items to evaluate */
  items: EvalDatasetItem[];
  /** Dataset metadata */
  metadata?: Record<string, unknown>;
}

export type MetricName =
  | "faithfulness"
  | "relevance"
  | "correctness"
  | "coherence"
  | "fluency"
  | "toxicity"
  | "hallucination"
  | "similarity"
  | "exact_match"
  | "contains"
  | "custom";

export interface MetricResult {
  /** Metric name */
  name: MetricName | string;
  /** Score (0-1 for normalized, raw for others) */
  score: number;
  /** Whether the score passes the threshold */
  passed: boolean;
  /** Human-readable explanation */
  explanation?: string;
  /** Raw metric output */
  raw?: unknown;
}

export interface EvalItemResult {
  /** Item from dataset */
  item: EvalDatasetItem;
  /** Model output */
  output: string;
  /** Metrics computed */
  metrics: MetricResult[];
  /** Overall pass/fail */
  passed: boolean;
  /** Error if evaluation failed */
  error?: string;
}

export interface EvalResult {
  /** Dataset name */
  dataset: string;
  /** Results per item */
  items: EvalItemResult[];
  /** Aggregate metrics */
  aggregates: Record<string, number>;
  /** Overall pass rate (0-1) */
  passRate: number;
  /** Total items */
  totalItems: number;
  /** Items that passed */
  passedItems: number;
  /** Items that failed */
  failedItems: number;
  /** Duration in ms */
  durationMs: number;
}

export interface EvalConfig {
  /** Judge model for LLM-as-judge metrics */
  judgeModel?: string;
  /** Provider for the judge model */
  judgeProvider?: string;
  /** LLM function for judge evaluations */
  llm?: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>;
  /** Metrics to compute */
  metrics: MetricConfig[];
  /** Concurrency limit (default: 5) */
  concurrency?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Event listener */
  onEvent?: (event: EvalEvent) => void;
}

export interface MetricConfig {
  /** Metric name */
  name: MetricName | string;
  /** Threshold for pass/fail (default: 0.7) */
  threshold?: number;
  /** Weight for aggregate score (default: 1) */
  weight?: number;
  /** Custom metric function */
  custom?: (output: string, item: EvalDatasetItem) => MetricResult | Promise<MetricResult>;
}

export type EvalEvent =
  | { type: "item_start"; index: number; item: EvalDatasetItem }
  | { type: "item_complete"; index: number; result: EvalItemResult }
  | { type: "metric_complete"; index: number; metric: MetricResult }
  | { type: "complete"; result: EvalResult };
