/**
 * @hilbras/sdk — Schema Helpers
 *
 * Type-safe wrappers for Zod and JSON Schema validation.
 * Works with any library that provides a `.safeParse()` method.
 *
 * Usage with Zod:
 *   import { z } from "zod";
 *   import { zodSchema } from "@hilbras/sdk";
 *
 *   const schema = z.object({ name: z.string(), age: z.number() });
 *   const result = await client.complete({
 *     messages: [...],
 *     output: zodSchema(schema),
 *   });
 *
 * Usage with JSON Schema:
 *   import { jsonSchema } from "@hilbras/sdk";
 *
 *   const result = await client.complete({
 *     messages: [...],
 *     output: jsonSchema({
 *       type: "object",
 *       properties: { name: { type: "string" }, age: { type: "number" } },
 *       required: ["name", "age"],
 *     }),
 *   });
 */

import type { SchemaValidator, StructuredOutputConfig } from "../types/schema.js";

/**
 * Wrap a Zod schema for use with `complete()`.
 *
 * Accepts any object with a `.safeParse()` method (Zod, Valibot, etc.)
 * and returns a `StructuredOutputConfig` ready for the client.
 *
 * @example
 *   import { z } from "zod";
 *   const config = zodSchema(z.object({ name: z.string() }));
 *   const result = await client.complete({ messages, output: config });
 */
export function zodSchema<T>(
  schema: SchemaValidator<T>,
  options?: { maxRepairAttempts?: number; repairInstructions?: string },
): StructuredOutputConfig<T> {
  return {
    schema,
    maxRepairAttempts: options?.maxRepairAttempts,
    repairInstructions: options?.repairInstructions,
  };
}

/**
 * Create a structured output config from a raw JSON Schema object.
 *
 * Builds an inline `SchemaValidator` that validates against the provided
 * JSON Schema using basic type checking. For full JSON Schema validation,
 * use a dedicated library (ajv, yup) and pass it via `zodSchema()`.
 *
 * @example
 *   const config = jsonSchema({
 *     type: "object",
 *     properties: {
 *       name: { type: "string" },
 *       age: { type: "number" },
 *     },
 *     required: ["name", "age"],
 *   });
 *   const result = await client.complete({ messages, output: config });
 */
export function jsonSchema<T = unknown>(
  schema: Record<string, unknown>,
  options?: { maxRepairAttempts?: number; repairInstructions?: string },
): StructuredOutputConfig<T> {
  const validator: SchemaValidator<T> = {
    safeParse(data: unknown) {
      try {
        // Basic structural validation against JSON Schema
        const errors = validateJsonSchema(data, schema);
        if (errors.length > 0) {
          return {
            success: false,
            error: new Error(`JSON Schema validation failed: ${errors.join("; ")}`),
          };
        }
        return { success: true, data: data as T };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
  };

  return {
    schema: validator,
    maxRepairAttempts: options?.maxRepairAttempts,
    repairInstructions: options?.repairInstructions,
  };
}

/**
 * Basic JSON Schema validator — checks required fields and primitive types.
 * Not a full implementation; for production use, integrate ajv or similar.
 */
function validateJsonSchema(data: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;

  if (type === "array") {
    if (!Array.isArray(data)) {
      errors.push(`Expected type "array", got "${typeof data}"`);
    }
    return errors;
  }

  if (type === "object" && typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const required = schema.required as string[] | undefined;

    if (required) {
      for (const key of required) {
        if (!(key in obj)) {
          errors.push(`Missing required field: "${key}"`);
        }
      }
    }

    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj) {
          const propErrors = validateJsonSchemaField(obj[key], propSchema, key);
          errors.push(...propErrors);
        }
      }
    }
  } else if (type && type !== "array" && type !== "object" && type !== typeof data) {
    errors.push(`Expected type "${schema.type}", got "${typeof data}"`);
  }

  return errors;
}

function validateJsonSchemaField(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;

  if (type === "string" && typeof value !== "string") {
    errors.push(`"${path}" should be a string`);
  } else if (type === "number" && typeof value !== "number") {
    errors.push(`"${path}" should be a number`);
  } else if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`"${path}" should be a boolean`);
  } else if (type === "array" && !Array.isArray(value)) {
    errors.push(`"${path}" should be an array`);
  } else if (type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
    errors.push(`"${path}" should be an object`);
  } else if (type === "object" && typeof value === "object" && value !== null && schema.properties) {
    const nested = validateJsonSchema(value, schema);
    errors.push(...nested.map((e) => `${path}.${e}`));
  }

  return errors;
}
