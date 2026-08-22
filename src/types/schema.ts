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
