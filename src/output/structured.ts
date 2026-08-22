/**
 * @hilbras/sdk — Structured Output with Auto-Repair
 *
 * Validates LLM output against a schema and automatically repairs
 * invalid JSON by retrying with repair prompts.
 *
 * Usage:
 *   import { z } from "zod";
 *   const result = await client.complete({
 *     ...params,
 *     output: { schema: z.object({ name: z.string() }) },
 *   });
 *   // result is typed as { name: string }
 */

import type { SchemaValidator, StructuredOutputConfig } from "../types/schema.js";
import { ValidationError } from "../errors/index.js";

/** Build the JSON schema description string from a schema validator */
function buildSchemaDescription(schema: SchemaValidator): string {
  // Try to extract JSON Schema from Zod's .jsonSchema or .definition
  const s = schema as unknown as Record<string, unknown>;

  // Zod 3.x: schema._def or schema.jsonSchema()
  if (typeof s.jsonSchema === "function") {
    try {
      return JSON.stringify((s.jsonSchema as () => unknown)(), null, 2);
    } catch { /* fall through */ }
  }

  // Zod 4.x: schema.meta or schema._zod
  if (s.meta && typeof s.meta === "object") {
    return JSON.stringify(s.meta, null, 2);
  }

  // Valibot: schema._def
  // Fallback: describe as opaque object
  return "A JSON object. The exact structure is validated server-side.";
}

/** Build system instruction for JSON output */
export function buildJsonSystemInstruction(schemaDescription: string): string {
  return [
    "You must respond with a single valid JSON object. No markdown, no explanations, no code fences.",
    "The JSON must match this schema:",
    "```json",
    schemaDescription,
    "```",
  ].join("\n");
}

/** Build repair prompt for invalid output */
export function buildRepairPrompt(
  validationError: unknown,
  originalRaw: string,
  schemaDescription: string,
  repairInstructions?: string,
): string {
  const errorMsg = validationError instanceof Error
    ? validationError.message
    : String(validationError);

  const parts = [
    "The previous response was invalid JSON. Fix it and respond with ONLY valid JSON matching this schema:",
    "```json",
    schemaDescription,
    "```",
    "",
    "Validation error:",
    errorMsg.slice(0, 500),
    "",
    "Previous response (fix the issues):",
    originalRaw.slice(0, 2000),
  ];

  if (repairInstructions) {
    parts.push("", "Additional instructions:", repairInstructions);
  }

  return parts.join("\n");
}

/** Extract JSON from a raw LLM response (strips markdown fences, surrounding text) */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find a JSON object or array in the text by bracket matching
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  let start = -1;
  let openChar = "";
  let closeChar = "";
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    start = objStart;
    openChar = "{";
    closeChar = "}";
  } else if (arrStart >= 0) {
    start = arrStart;
    openChar = "[";
    closeChar = "]";
  }

  if (start >= 0) {
    // Find matching closing bracket
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth++;
      if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    // No matching close found — return from start to end
    return text.slice(start);
  }

  return text;
}

/**
 * Validate output against a schema. Returns parsed data or throws ValidationError.
 *
 * @param raw - Raw LLM output string
 * @param schema - Schema validator to validate against
 * @param attempt - Current attempt number (for error reporting)
 */
export function validateOutput<T>(
  raw: string,
  schema: SchemaValidator<T>,
  attempt: number,
): T {
  const json = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ValidationError(attempt, err, raw);
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  throw new ValidationError(attempt, result.error, raw);
}

/**
 * Build the extra params that tell a provider to return JSON.
 * Returns provider-specific body overrides.
 */
export function buildJsonModeParams(providerAdapter: string): Record<string, unknown> {
  switch (providerAdapter) {
    case "openai":
    case "azure":
      return { response_format: { type: "json_object" } };
    case "google-genai":
      return { responseMimeType: "application/json" };
    case "anthropic":
    case "groq":
    case "ollama":
    default:
      // No native JSON mode — the system instruction handles it
      return {};
  }
}

/**
 * Execute a structured output request with validation and auto-repair.
 *
 * @param rawResponse - The raw text response from the LLM
 * @param config - Structured output configuration
 * @param attempt - Current attempt number (1-based)
 */
export function processStructuredOutput<T>(
  rawResponse: string,
  config: StructuredOutputConfig<T>,
    attempt: number,
): { data: T; raw: string } | { error: ValidationError; raw: string } {
  try {
    const data = validateOutput(rawResponse, config.schema, attempt);
    return { data, raw: rawResponse };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { error: err, raw: rawResponse };
    }
    throw err;
  }
}
