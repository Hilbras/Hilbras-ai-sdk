/**
 * @hilbras/fine-tune — Types
 */

export interface TrainingExample {
  /** Unique identifier */
  id?: string;
  /** Input prompt */
  input: string;
  /** Expected output */
  output: string;
  /** System prompt (optional) */
  system?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface ConversationExample {
  /** Unique identifier */
  id?: string;
  /** Conversation messages */
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export type TrainingFormat =
  | "openai-finetune"
  | "openai-chat"
  | "anthropic"
  | "jsonl"
  | "csv"
  | "alpaca";

export interface ExportOptions {
  /** Output format */
  format: TrainingFormat;
  /** System prompt to add to all examples (if format supports it) */
  systemPrompt?: string;
  /** Filter examples by metadata */
  filter?: Record<string, unknown>;
  /** Max examples (0 = no limit) */
  limit?: number;
}

export interface ExportResult {
  /** Format used */
  format: TrainingFormat;
  /** Number of examples exported */
  count: number;
  /** Exported data as string */
  data: string;
  /** File extension */
  extension: string;
}

export interface DataSplitOptions {
  /** Training ratio (default: 0.8) */
  trainRatio?: number;
  /** Validation ratio (default: 0.1) */
  valRatio?: number;
  /** Test ratio (default: 0.1) */
  testRatio?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

export interface DataSplit {
  train: TrainingExample[];
  validation: TrainingExample[];
  test: TrainingExample[];
}

export interface QualityCheck {
  /** Whether the data passes quality checks */
  passed: boolean;
  /** Number of issues found */
  issueCount: number;
  /** List of issues */
  issues: string[];
  /** Quality score (0-1) */
  score: number;
}

export interface QualityReport {
  /** Total examples checked */
  totalExamples: number;
  /** Examples that passed */
  passedExamples: number;
  /** Overall quality score (0-1) */
  overallScore: number;
  /** Individual quality checks */
  checks: QualityCheck[];
  /** Recommendations for improvement */
  recommendations: string[];
}
