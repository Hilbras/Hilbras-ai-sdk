/**
 * @hilbras/fine-tune — Fine-tuning & Distillation Helpers
 *
 * Export training data, format for providers, validate quality, split datasets.
 */

export { exportTrainingData } from "./formatters.js";
export { splitData } from "./split.js";
export { validateTrainingData, cleanTrainingData, deduplicateTrainingData } from "./quality.js";
export type {
  TrainingExample,
  ConversationExample,
  TrainingFormat,
  ExportOptions,
  ExportResult,
  DataSplitOptions,
  DataSplit,
  QualityCheck,
  QualityReport,
} from "./types.js";
