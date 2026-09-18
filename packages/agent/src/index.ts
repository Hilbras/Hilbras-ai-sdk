/**
 * @hilbras/agent — Agent Framework
 *
 * Building blocks for multi-step AI agents:
 * - ToolLoopAgent: Multi-step tool execution with approval, budget, cost tracking
 * - ReActAgent: Reasoning + Acting pattern
 * - PlanAndExecuteAgent: Two-phase planning and execution
 */

export { ToolLoopAgent, type ToolLoopAgentConfig } from "./tool-loop.js";
export { ReActAgent, type ReActAgentConfig } from "./react.js";
export { PlanAndExecuteAgent, type PlanAndExecuteAgentConfig } from "./plan-and-execute.js";
export type {
  AgentTool,
  AgentConfig,
  AgentResult,
  AgentStep,
  ToolCallRecord,
  StepUsage,
  ToolContext,
  ApprovalRequest,
  AgentEvent,
} from "./types.js";
