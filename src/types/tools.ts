/**
 * @hilbras/sdk — Tool definition types
 *
 * Canonical tool schema shared across all provider adapters.
 * Adapters convert these to provider-specific formats internally.
 */

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required: string[];
}

export interface ToolFunction {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface Tool {
  type: "function";
  function: ToolFunction;
}

/** Convert a Tool to provider-specific format. */
export function toolToDict(tool: Tool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  };
}
