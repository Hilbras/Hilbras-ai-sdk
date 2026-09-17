import { describe, it, expect } from "vitest";
import { tool, toolDef, dynamicTool } from "../src/types/tool-builder.js";

describe("tool()", () => {
  it("creates a tool definition and executor", async () => {
    const weatherTool = tool({
      name: "get_weather",
      description: "Get the weather for a location",
      parameters: {
        location: { type: "string", description: "City name" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["location"],
      execute: async (input) => {
        return { temp: 22, condition: "sunny", location: input.location };
      },
    });

    expect(weatherTool.definition).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      },
    });

    const result = await weatherTool.execute({ location: "London" });
    expect(result).toEqual({ temp: 22, condition: "sunny", location: "London" });
  });

  it("exposes inputSchema and required", () => {
    const t = tool({
      name: "test",
      description: "Test tool",
      parameters: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a"],
      execute: async () => "ok",
    });

    expect(t.inputSchema).toEqual({
      a: { type: "string" },
      b: { type: "number" },
    });
    expect(t.required).toEqual(["a"]);
  });
});

describe("toolDef()", () => {
  it("creates a tool definition without execute", () => {
    const def = toolDef({
      name: "search",
      description: "Search the web",
      parameters: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    });

    expect(def).toEqual({
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    });
  });

  it("defaults required to empty array", () => {
    const def = toolDef({
      name: "noop",
      description: "No-op tool",
      parameters: {},
    });

    expect(def.function.parameters.required).toEqual([]);
  });
});

describe("dynamicTool()", () => {
  it("creates a tool from runtime parameters", () => {
    const t = dynamicTool({
      name: "fetch_data",
      description: "Fetch data from API",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        required: ["url"],
      },
    });

    expect(t).toEqual({
      type: "function",
      function: {
        name: "fetch_data",
        description: "Fetch data from API",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
          },
          required: ["url"],
        },
      },
    });
  });

  it("creates a tool with execute when provided", async () => {
    const t = dynamicTool({
      name: "fetch_data",
      description: "Fetch data",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      execute: async (input) => {
        return { url: input.url, status: "ok" };
      },
    });

    expect("execute" in t).toBe(true);
    if ("execute" in t) {
      const result = await t.execute({ url: "https://example.com" });
      expect(result).toEqual({ url: "https://example.com", status: "ok" });
    }
  });
});
