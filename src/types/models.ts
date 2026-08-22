/**
 * @hilbras/sdk — Model types with capabilities
 *
 * Rich model definitions that enable the future Model Router:
 * user request → required capabilities → compatible models → optimization → selected model
 */

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  parallelTools: boolean;
  systemPrompts: boolean;
}

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  tools: true,
  vision: false,
  reasoning: false,
  structuredOutput: false,
  parallelTools: false,
  systemPrompts: true,
};

export interface Model {
  id: string;
  contextWindow: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
}
