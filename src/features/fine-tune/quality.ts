/**
 * @hilbras/fine-tune — Data Quality
 *
 * Validate and clean training data.
 */

import type { TrainingExample, ConversationExample } from "./types.js";

export interface QualityCheck {
  /** Check name */
  name: string;
  /** Whether it passed */
  passed: boolean;
  /** Number of issues found */
  issues: number;
  /** Details */
  details: string[];
}

export interface QualityReport {
  /** Overall pass */
  passed: boolean;
  /** Total examples checked */
  total: number;
  /** Individual checks */
  checks: QualityCheck[];
}

/**
 * Validate training data quality.
 */
export function validateTrainingData(examples: TrainingExample[]): QualityReport {
  const checks: QualityCheck[] = [];

  // Check for empty inputs
  const emptyInputs = examples.filter((ex) => !ex.input.trim());
  checks.push({
    name: "empty_inputs",
    passed: emptyInputs.length === 0,
    issues: emptyInputs.length,
    details: emptyInputs.length > 0
      ? [`${emptyInputs.length} examples have empty inputs`]
      : [],
  });

  // Check for empty outputs
  const emptyOutputs = examples.filter((ex) => !ex.output.trim());
  checks.push({
    name: "empty_outputs",
    passed: emptyOutputs.length === 0,
    issues: emptyOutputs.length,
    details: emptyOutputs.length > 0
      ? [`${emptyOutputs.length} examples have empty outputs`]
      : [],
  });

  // Check for duplicate inputs
  const inputSet = new Set<string>();
  const duplicates = examples.filter((ex) => {
    if (inputSet.has(ex.input)) return true;
    inputSet.add(ex.input);
    return false;
  });
  checks.push({
    name: "duplicates",
    passed: duplicates.length === 0,
    issues: duplicates.length,
    details: duplicates.length > 0
      ? [`${duplicates.length} duplicate inputs found`]
      : [],
  });

  // Check for very long examples (>10k chars)
  const longExamples = examples.filter(
    (ex) => ex.input.length > 10000 || ex.output.length > 10000
  );
  checks.push({
    name: "too_long",
    passed: longExamples.length === 0,
    issues: longExamples.length,
    details: longExamples.length > 0
      ? [`${longExamples.length} examples exceed 10k characters`]
      : [],
  });

  // Check for very short outputs (<5 chars)
  const shortOutputs = examples.filter(
    (ex) => ex.output.trim().length < 5
  );
  checks.push({
    name: "short_outputs",
    passed: shortOutputs.length <= examples.length * 0.1, // Allow 10%
    issues: shortOutputs.length,
    details: shortOutputs.length > 0
      ? [`${shortOutputs.length} examples have very short outputs (<5 chars)`]
      : [],
  });

  return {
    passed: checks.every((c) => c.passed),
    total: examples.length,
    checks,
  };
}

/**
 * Clean training data by removing invalid examples.
 */
export function cleanTrainingData(examples: TrainingExample[]): TrainingExample[] {
  return examples.filter((ex) => {
    if (!ex.input.trim()) return false;
    if (!ex.output.trim()) return false;
    return true;
  });
}

/**
 * Deduplicate training data by input.
 */
export function deduplicateTrainingData(examples: TrainingExample[]): TrainingExample[] {
  const seen = new Set<string>();
  return examples.filter((ex) => {
    if (seen.has(ex.input)) return false;
    seen.add(ex.input);
    return true;
  });
}
