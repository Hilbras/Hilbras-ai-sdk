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

/** Emitted at the end of a stream with performance metrics */
export interface PerformanceChunk {
  type: "performance";
  /** Time to first token in milliseconds */
  timeToFirstToken: number;
  /** Total request duration in milliseconds */
  totalDuration: number;
  /** Tokens per second (output tokens / stream duration) */
  tokensPerSecond: number;
  /** Number of retries attempted */
  retries: number;
  /** Whether circuit breaker was involved */
  circuitBreakerUsed: boolean;
}

/** Structured data emitted alongside text (sources, citations, metadata) */
export interface DataChunk {
  type: "data";
  /** The structured data payload */
  data: unknown;
}

/** Annotation attached to the response */
export interface AnnotationChunk {
  type: "annotation";
  /** Type of annotation (e.g., "source", "citation", "confidence") */
  annotationType: string;
  /** The annotation payload */
  data: unknown;
  /** Optional text range the annotation applies to */
  range?: { start: number; end: number };
}

export type StreamChunk =
  | TextChunk
  | ReasoningChunk
  | ToolCallChunk
  | UsageChunk
  | ErrorChunk
  | FinishChunk
  | PerformanceChunk
  | DataChunk
  | AnnotationChunk;

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
  performance: (metrics: Omit<PerformanceChunk, "type">): PerformanceChunk => ({ type: "performance", ...metrics }),
  data: (data: unknown): DataChunk => ({ type: "data", data }),
  annotation: (annotationType: string, data: unknown, range?: { start: number; end: number }): AnnotationChunk => ({
    type: "annotation", annotationType, data, range,
  }),
} as const;
