/**
 * @hilbras/sdk — Stream chunk types
 *
 * Discriminated union of all possible stream events.
 * Adapters normalize provider-specific events into these types.
 */

export interface TextChunk {
  type: "text";
  text: string;
}

export interface ReasoningChunk {
  type: "reasoning";
  text: string;
}

export interface ToolCallChunk {
  type: "tool_call";
  id: string;
  name?: string;
  argumentsDelta?: string;
  /** Index for accumulation across multiple SSE events (OpenAI uses index-based) */
  index?: number;
  /** Whether this is the final chunk for this tool call */
  done?: boolean;
}

export interface UsageChunk {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ErrorChunk {
  type: "error";
  message: string;
  retryable: boolean;
}

/** Emitted when the provider signals why generation ended (stop, length, …) */
export interface FinishChunk {
  type: "finish";
  reason: string;
}

export type StreamChunk = TextChunk | ReasoningChunk | ToolCallChunk | UsageChunk | ErrorChunk | FinishChunk;

// ─── Helper constructors ────────────────────────────────────────────────────

export const chunk = {
  text: (text: string): TextChunk => ({ type: "text", text }),
  reasoning: (text: string): ReasoningChunk => ({ type: "reasoning", text }),
  toolCall: (id: string, name?: string, args?: string, index?: number): ToolCallChunk => ({
    type: "tool_call", id, name, argumentsDelta: args, index, done: true,
  }),
  usage: (input: number, output: number, total?: number): UsageChunk => ({
    type: "usage", inputTokens: input, outputTokens: output, totalTokens: total ?? input + output,
  }),
  error: (message: string, retryable = false): ErrorChunk => ({ type: "error", message, retryable }),
} as const;
