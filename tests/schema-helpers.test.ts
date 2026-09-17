import { describe, it, expect } from "vitest";
import { zodSchema, jsonSchema } from "../src/output/schema-helpers.js";

describe("zodSchema", () => {
  it("wraps a schema validator with options", () => {
    const schema = {
      safeParse: (data: unknown) => {
        if (typeof data === "object" && data !== null && "name" in data) {
          return { success: true, data };
        }
        return { success: false, error: new Error("Missing name") };
      },
    };

    const config = zodSchema(schema, {
      maxRepairAttempts: 3,
      repairInstructions: "Must be valid JSON",
    });

    expect(config.schema).toBe(schema);
    expect(config.maxRepairAttempts).toBe(3);
    expect(config.repairInstructions).toBe("Must be valid JSON");
  });

  it("wraps a schema validator without options", () => {
    const schema = {
      safeParse: (data: unknown) => ({ success: true, data }),
    };

    const config = zodSchema(schema);
    expect(config.schema).toBe(schema);
    expect(config.maxRepairAttempts).toBeUndefined();
  });
});

describe("jsonSchema", () => {
  it("validates an object against a JSON schema", () => {
    const config = jsonSchema<{ name: string; age: number }>({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    });

    const result = config.schema.safeParse({ name: "Alice", age: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", age: 30 });
    }
  });

  it("rejects objects missing required fields", () => {
    const config = jsonSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name", "age"],
    });

    const result = config.schema.safeParse({ name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("rejects objects with wrong types", () => {
    const config = jsonSchema({
      type: "object",
      properties: {
        count: { type: "number" },
      },
      required: ["count"],
    });

    const result = config.schema.safeParse({ count: "not a number" });
    expect(result.success).toBe(false);
  });

  it("validates nested objects", () => {
    const config = jsonSchema({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
      required: ["user"],
    });

    const valid = config.schema.safeParse({ user: { name: "Alice" } });
    expect(valid.success).toBe(true);

    const invalid = config.schema.safeParse({ user: { age: 30 } });
    expect(invalid.success).toBe(false);
  });

  it("validates arrays", () => {
    const config = jsonSchema({
      type: "array",
    });

    expect(config.schema.safeParse([1, 2, 3]).success).toBe(true);
    expect(config.schema.safeParse("not an array").success).toBe(false);
  });

  it("passes through options", () => {
    const config = jsonSchema(
      { type: "object", properties: {} },
      { maxRepairAttempts: 5 },
    );
    expect(config.maxRepairAttempts).toBe(5);
  });
});
