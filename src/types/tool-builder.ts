/**
 * @hilbras/sdk — Tool Builder
 *
 * Type-safe helpers for defining tools with schemas.
 * Supports both static and runtime-defined tools.
 *
 * Usage:
 *   import { tool } from "@hilbras/sdk";
 *
 *   const weatherTool = tool({
 *     name: "get_weather",
 *     description: "Get the weather for a location",
 *     parameters: {
 *       location: { type: "string", description: "City name" },
 *       unit: { type: "string", enum: ["celsius", "fahrenheit"] },
 *     },
 *     required: ["location"],
 *     execute: async (input) => {
 *       return { temp: 22, condition: "sunny" };
 *     },
 *   });
 *
 *   // Use with client
 *   const result = await client.complete({
 *     messages: [...],
 *     tools: [weatherTool.definition],
 *   });
 *
 *   // Or execute directly
 *   const weather = await weatherTool.execute({ location: "London" });
 */

import type { Tool, ToolParameter, ToolParameters } from "../types/tools.js";

/** Schema definition for tool parameters (simplified, user-friendly format) */
export type ParameterSchema = Record<string, {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ParameterSchema[string]>;
  required?: string[];
}>;

/** A tool with both definition and execution function */
export interface DefinedTool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** The tool definition for passing to the LLM */
  definition: Tool;
  /** Execute the tool with validated input */
  inputSchema: ParameterSchema;
  required: string[];
  execute: (input: TInput) => Promise<TOutput>;
}

/** A tool definition without an execute function (for LLM-only use) */
export type ToolDefinition = Tool;

/**
 * Define a type-safe tool with schema and execution function.
 *
 * @example
 *   const calculator = tool({
 *     name: "calculate",
 *     description: "Perform a math calculation",
 *     parameters: {
 *       expression: { type: "string", description: "Math expression" },
 *     },
 *     required: ["expression"],
 *     execute: async (input) => {
 *       // Use a safe math parser instead of eval()
 *       const result = safeMathParse(input.expression);
 *       return { result };
 *     },
 *   });
 *
 *   // Access the definition for LLM
 *   console.log(calculator.definition);
 *
 *   // Execute directly
 *   const result = await calculator.execute({ expression: "2 + 2" });
 */
export function tool<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown>(config: {
  name: string;
  description: string;
  parameters: ParameterSchema;
  required: (keyof TInput & string)[];
  execute: (input: TInput) => Promise<TOutput>;
}): DefinedTool<TInput, TOutput> {
  const toolParameters: ToolParameters = {
    type: "object",
    properties: {},
    required: config.required as string[],
  };

  for (const [key, def] of Object.entries(config.parameters)) {
    toolParameters.properties[key] = def as ToolParameter;
  }

  const definition: Tool = {
    type: "function",
    function: {
      name: config.name,
      description: config.description,
      parameters: toolParameters,
    },
  };

  return {
    definition,
    inputSchema: config.parameters,
    required: config.required as string[],
    execute: config.execute,
  };
}

/**
 * Create a tool definition without an execute function.
 * Useful when you only need the schema for the LLM,
 * or when execution is handled elsewhere.
 *
 * @example
 *   const def = toolDef({
 *     name: "search",
 *     description: "Search the web",
 *     parameters: {
 *       query: { type: "string", description: "Search query" },
 *     },
 *     required: ["query"],
 *   });
 *
 *   // Pass to LLM
 *   await client.complete({ messages, tools: [def] });
 */
export function toolDef(config: {
  name: string;
  description: string;
  parameters: ParameterSchema;
  required?: string[];
}): Tool {
  const toolParameters: ToolParameters = {
    type: "object",
    properties: {},
    required: config.required ?? [],
  };

  for (const [key, def] of Object.entries(config.parameters)) {
    toolParameters.properties[key] = def as ToolParameter;
  }

  return {
    type: "function",
    function: {
      name: config.name,
      description: config.description,
      parameters: toolParameters,
    },
  };
}

/**
 * Create a tool from a runtime-defined schema.
 * Useful when tool definitions come from an API or database.
 *
 * @example
 *   const tools = await fetchToolDefinitionsFromAPI();
 *   const dynamicTools = tools.map(dynamicTool);
 *   await client.complete({ messages, tools: dynamicTools });
 */
export function dynamicTool(config: {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute?: (input: Record<string, unknown>) => Promise<unknown>;
}): Tool | DefinedTool {
  const definition: Tool = {
    type: "function",
    function: {
      name: config.name,
      description: config.description,
      parameters: config.parameters,
    },
  };

  if (config.execute) {
    return {
      definition,
      inputSchema: config.parameters.properties as ParameterSchema,
      required: config.parameters.required,
      execute: config.execute,
    };
  }

  return definition;
}
