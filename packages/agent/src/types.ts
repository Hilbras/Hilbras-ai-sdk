/**
 * @hilbras/agent — Agent Types
 *
 * Core types for the agent framework.
 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  /** Current step number (0-indexed) */
  step: number;
  /** Maximum allowed steps */
  maxSteps: number;
  /** Total cost so far in dollars */
  totalCost: number;
  /** Budget limit in dollars (null = no limit) */
  budget: number | null;
  /** Whether this tool call needs approval */
  needsApproval: boolean;
  /** Signal for cancellation */
  signal?: AbortSignal;
}

export interface AgentStep {
  /** Step number */
  step: number;
  /** LLM response content */
  content: string;
  /** Tool calls made in this step */
  toolCalls: ToolCallRecord[];
  /** Whether the agent wants to continue */
  done: boolean;
  /** Token usage for this step */
  usage: StepUsage;
}

export interface ToolCallRecord {
  /** Tool name */
  name: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Tool result */
  result: unknown;
  /** Error if tool failed */
  error?: string;
  /** Whether this call was approved by the user */
  approved?: boolean;
}

export interface StepUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface AgentResult {
  /** Final answer from the agent */
  answer: string;
  /** All steps taken */
  steps: AgentStep[];
  /** Total steps taken */
  totalSteps: number;
  /** Whether the agent completed within budget */
  withinBudget: boolean;
  /** Total cost in dollars */
  totalCost: number;
  /** Total token usage */
  usage: StepUsage;
  /** Whether the agent was interrupted (e.g., by approval) */
  interrupted: boolean;
}

export interface AgentConfig {
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** Maximum number of steps (default: 10) */
  maxSteps?: number;
  /** Budget limit in dollars (null = no limit) */
  budget?: number | null;
  /** System prompt */
  systemPrompt?: string;
  /** Temperature (default: 0) */
  temperature?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Whether to stream intermediate steps */
  stream?: boolean;
}

export interface ApprovalRequest {
  /** Step number */
  step: number;
  /** Tool name */
  toolName: string;
  /** Arguments */
  args: Record<string, unknown>;
  /** Approve or reject */
  approve: boolean;
}

export type AgentEvent =
  | { type: "step_start"; step: number }
  | { type: "step_complete"; step: AgentStep }
  | { type: "tool_call"; step: number; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; step: number; tool: string; result: unknown }
  | { type: "approval_needed"; step: number; tool: string; args: Record<string, unknown> }
  | { type: "approval_granted"; step: number; tool: string }
  | { type: "approval_rejected"; step: number; tool: string }
  | { type: "done"; result: AgentResult }
  | { type: "error"; error: Error };
