/**
 * @hilbras/sdk — Structured Output tests
 */

import { describe, it, expect } from "vitest";
import { extractJson, buildJsonSystemInstruction, buildRepairPrompt, buildJsonModeParams } from "../src/output/structured.js";
import { validateOutput } from "../src/output/structured.js";
import { ValidationError } from "../src/errors/index.js";
import type { SchemaValidator } from "../src/types/schema.js";

/** Simple test schema validator */
function testSchema<T>(expected: T): SchemaValidator<T> {
  return {
    safeParse(data: unknown) {
      if (JSON.stringify(data) === JSON.stringify(expected)) {
        return { success: true, data: data as T };
      }
      return { success: false, error: new Error("Schema mismatch") };
    },
  };
}

describe("extractJson", () => {
  it("extracts plain JSON", () => {
    expect(extractJson('{"name":"John"}')).toBe('{"name":"John"}');
  });

  it("strips markdown code fences", () => {
    expect(extractJson('```json\n{"name":"John"}\n```')).toBe('{"name":"John"}');
  });

  it("strips code fences without language tag", () => {
    expect(extractJson('```\n{"name":"John"}\n```')).toBe('{"name":"John"}');
  });

  it("finds JSON object in surrounding text", () => {
    expect(extractJson('Here is the result: {"name":"John"} hope this helps!')).toBe('{"name":"John"}');
  });

  it("finds JSON array", () => {
    expect(extractJson('Result: [1,2,3]')).toBe('[1,2,3]');
  });

  it("handles whitespace", () => {
    expect(extractJson('  {"name":"John"}  ')).toBe('{"name":"John"}');
  });
});

describe("validateOutput", () => {
  it("validates correct JSON", () => {
    const schema = testSchema({ name: "John", age: 24 });
    const result = validateOutput('{"name":"John","age":24}', schema, 1);
    expect(result).toEqual({ name: "John", age: 24 });
  });

  it("throws ValidationError for invalid JSON", () => {
    const schema = testSchema({ name: "John" });
    expect(() => validateOutput("not json at all", schema, 1)).toThrow(ValidationError);
  });

  it("throws ValidationError when schema doesn't match", () => {
    const schema = testSchema({ name: "John", age: 24 });
    expect(() => validateOutput('{"name":"John","age":"twenty-four"}', schema, 1)).toThrow(ValidationError);
  });

  it("includes attempt number in error", () => {
    const schema = testSchema({});
    try {
      validateOutput("invalid", schema, 3);
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).attempts).toBe(3);
    }
  });

  it("extracts JSON from markdown fences before validating", () => {
    const schema = testSchema({ name: "John" });
    const result = validateOutput('```json\n{"name":"John"}\n```', schema, 1);
    expect(result).toEqual({ name: "John" });
  });
});

describe("buildJsonSystemInstruction", () => {
  it("produces instruction mentioning JSON and schema", () => {
    const instruction = buildJsonSystemInstruction('{"type":"object","properties":{"name":{"type":"string"}}}');
    expect(instruction).toContain("JSON");
    expect(instruction).toContain("schema");
    expect(instruction).toContain("name");
  });
});

describe("buildRepairPrompt", () => {
  it("includes error message and previous response", () => {
    const prompt = buildRepairPrompt(
      new Error("Type mismatch"),
      '{"name": "John", "age": "old"}',
      '{"type":"object"}',
    );
    expect(prompt).toContain("Type mismatch");
    expect(prompt).toContain("John");
    expect(prompt).toContain("schema");
  });

  it("includes custom repair instructions", () => {
    const prompt = buildRepairPrompt(
      new Error("bad"),
      "{}",
      "{}",
      "Always use lowercase keys",
    );
    expect(prompt).toContain("Always use lowercase keys");
  });
});

describe("buildJsonModeParams", () => {
  it("returns response_format for openai", () => {
    const params = buildJsonModeParams("openai");
    expect(params).toEqual({ response_format: { type: "json_object" } });
  });

  it("returns response_format for azure", () => {
    const params = buildJsonModeParams("azure");
    expect(params).toEqual({ response_format: { type: "json_object" } });
  });

  it("returns responseMimeType for google-genai", () => {
    const params = buildJsonModeParams("google-genai");
    expect(params).toEqual({ responseMimeType: "application/json" });
  });

  it("returns empty for anthropic", () => {
    const params = buildJsonModeParams("anthropic");
    expect(params).toEqual({});
  });

  it("returns empty for unknown adapter", () => {
    const params = buildJsonModeParams("unknown");
    expect(params).toEqual({});
  });
});
