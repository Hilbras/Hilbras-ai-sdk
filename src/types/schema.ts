/**
 * @hilbras/sdk — Structured Output Types
 *
 * Schema validation interface that works with Zod, Valibot, or any
 * library that implements .safeParse().
 */

/** A schema validator — compatible with Zod, Valibot, or custom validators */
export interface SchemaValidator<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** Configuration for structured output generation */
export interface StructuredOutputConfig<T = unknown> {
  /** Schema to validate the output against */
  schema: SchemaValidator<T>;
  /** Max repair attempts when validation fails (default: 2) */
  maxRepairAttempts?: number;
  /** Additional instructions appended to the repair prompt */
  repairInstructions?: string;
}

/**
 * Options for streamObject — streams a partially-parsed structured object.
 *
 * Accepts either a raw JSON schema (Record<string, unknown>) or a
 * SchemaValidator<T> from Zod/Valibot for runtime validation of partials.
 */
export interface StreamObjectOptions<T = unknown> {
  /** Provider to use */
  provider?: string;
  /** Model to use */
  model?: string;
  /** Messages for the completion */
  messages: Array<Record<string, unknown> | { role: string; content: string }>;
  /** Schema — either a raw JSON Schema object or a SchemaValidator<T> */
  schema: Record<string, unknown> | SchemaValidator<T>;
  /** Temperature (0-2) */
  temperature?: number;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Provider-specific extra params */
  extra?: Record<string, unknown>;
  /** Abort signal */
  signal?: AbortSignal;
  /** Execution policy (routing, constraints) */
  policy?: import("./policy.js").ExecutionPolicy;
  /** Callback for partial object updates (receives validated partial on each chunk) */
  onPartialObject?: (partial: Partial<T>) => void;
  /** Callback when the full object is received and validated */
  onFinalObject?: (object: T) => void;
}

/** A chunk yielded by streamObject */
export type StreamObjectChunk<T = unknown> =
  | { type: "object_delta"; partialObject: Partial<T> }
  | import("./streams.js").StreamChunk;
