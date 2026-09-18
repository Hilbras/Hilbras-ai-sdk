/**
 * @hilbras/agent — ReActAgent
 *
 * Reasoning + Acting agent that follows the ReAct pattern:
 * 1. Think: Analyze the current state and decide what to do
 * 2. Act: Choose and execute a tool
 * 3. Observe: Process the tool result
 * 4. Repeat until done
 *
 * Key difference from ToolLoopAgent: explicit thinking step before each action.
 */

import type {
  AgentTool,
  AgentConfig,
  AgentResult,
  AgentStep,
  ToolCallRecord,
  StepUsage,
  ToolContext,
  AgentEvent,
} from "./types.js";

export interface ReActAgentConfig extends AgentConfig {
  /** Tools available to the agent */
  tools: AgentTool[];
  /** Custom LLM function */
  llm?: (messages: Array<{ role: string; content: string }>) => Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  /** Function to estimate cost from usage */
  costEstimator?: (usage: { promptTokens: number; completionTokens: number }, model: string) => number;
  /** Approval handler */
  onApproval?: (step: number, tool: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Event listener */
  onEvent?: (event: AgentEvent) => void;
}

const REACT_SYSTEM_PROMPT = `You are a ReAct agent. For each step, follow this pattern:

Thought: Analyze what you need to do and why.
Action: Call a tool to help with the task.
Observation: (This will be provided after the tool executes.)

Repeat until you have enough information to provide a final answer.

When you have the final answer, respond with:
Thought: I now have enough information.
Final Answer: <your answer>

Important: Always start with a Thought. Always call exactly one tool per step.`;

export class ReActAgent {
  private _config: ReActAgentConfig;

  constructor(config: ReActAgentConfig) {
    this._config = config;
  }

  /**
   * Run the ReAct agent loop.
   */
  async run(initialPrompt: string): Promise<AgentResult> {
    const {
      tools,
      maxSteps = 10,
      budget = null,
      systemPrompt = REACT_SYSTEM_PROMPT,
      temperature = 0,
      signal,
      llm,
      costEstimator,
      onApproval,
      onEvent,
    } = this._config;

    const effectiveLLM = llm ?? (() => { throw new Error("No LLM function provided. Pass llm() in ReActAgentConfig."); });
    const effectiveCost = costEstimator ?? (() => 0);

    const steps: AgentStep[] = [];
    let totalCost = 0;
    let totalUsage: StepUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 };
    let interrupted = false;

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: initialPrompt },
    ];

    for (let stepNum = 0; stepNum < maxSteps; stepNum++) {
      if (signal?.aborted) {
        interrupted = true;
        break;
      }

      if (budget !== null && totalCost >= budget) break;

      onEvent?.({ type: "step_start", step: stepNum });

      let response;
      try {
        response = await effectiveLLM(messages);
      } catch (error) {
        onEvent?.({ type: "error", error: error as Error });
        throw error;
      }

      const usage = response.usage ?? { promptTokens: 0, completionTokens: 0 };
      const cost = effectiveCost(usage, this._config.model);

      totalUsage.promptTokens += usage.promptTokens;
      totalUsage.completionTokens += usage.completionTokens;
      totalUsage.totalTokens += usage.promptTokens + usage.completionTokens;
      totalUsage.estimatedCost += cost;
      totalCost += cost;

      // Check if final answer
      const isFinal = response.content.includes("Final Answer:");
      const toolCalls = response.toolCalls ?? [];

      if (isFinal || toolCalls.length === 0) {
        const step: AgentStep = {
          step: stepNum,
          content: response.content,
          toolCalls: [],
          done: true,
          usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.promptTokens + usage.completionTokens, estimatedCost: cost },
        };
        steps.push(step);
        onEvent?.({ type: "step_complete", step });

        // Extract final answer
        const finalMatch = response.content.match(/Final Answer:\s*([\s\S]*)/i);
        const answer = finalMatch ? finalMatch[1].trim() : response.content;

        const result: AgentResult = {
          answer,
          steps,
          totalSteps: steps.length,
          withinBudget: budget === null || totalCost < budget,
          totalCost,
          usage: totalUsage,
          interrupted,
        };
        onEvent?.({ type: "done", result });
        return result;
      }

      // Execute tool calls (ReAct should have one per step)
      const stepToolCalls: ToolCallRecord[] = [];

      for (const tc of toolCalls) {
        if (signal?.aborted) {
          interrupted = true;
          break;
        }

        const tool = tools.find((t) => t.name === tc.name);
        if (!tool) {
          stepToolCalls.push({ name: tc.name, args: tc.arguments, result: null, error: `Tool "${tc.name}" not found` });
          continue;
        }

        // Approval
        let approved = true;
        if (onApproval) {
          onEvent?.({ type: "approval_needed", step: stepNum, tool: tc.name, args: tc.arguments });
          approved = await onApproval(stepNum, tc.name, tc.arguments);
          if (!approved) {
            onEvent?.({ type: "approval_rejected", step: stepNum, tool: tc.name });
            stepToolCalls.push({ name: tc.name, args: tc.arguments, result: null, error: "Rejected by user", approved: false });
            interrupted = true;
            break;
          }
          onEvent?.({ type: "approval_granted", step: stepNum, tool: tc.name });
        }

        onEvent?.({ type: "tool_call", step: stepNum, tool: tc.name, args: tc.arguments });

        const ctx: ToolContext = { step: stepNum, maxSteps, totalCost, budget, needsApproval: false, signal };

        try {
          const result = await tool.execute(tc.arguments, ctx);
          stepToolCalls.push({ name: tc.name, args: tc.arguments, result, approved });
          onEvent?.({ type: "tool_result", step: stepNum, tool: tc.name, result });
        } catch (error) {
          stepToolCalls.push({ name: tc.name, args: tc.arguments, result: null, error: (error as Error).message, approved });
        }
      }

      const step: AgentStep = {
        step: stepNum,
        content: response.content,
        toolCalls: stepToolCalls,
        done: false,
        usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.promptTokens + usage.completionTokens, estimatedCost: cost },
      };
      steps.push(step);
      onEvent?.({ type: "step_complete", step });

      if (interrupted) break;

      // Add to conversation
      messages.push({ role: "assistant", content: response.content });
      for (const tc of stepToolCalls) {
        const resultStr = tc.error ? `Error: ${tc.error}` : JSON.stringify(tc.result);
        messages.push({ role: "user", content: `Observation: ${resultStr}` });
      }
    }

    const lastStep = steps[steps.length - 1];
    const answer = lastStep?.content ?? "Agent reached maximum steps.";

    const result: AgentResult = {
      answer,
      steps,
      totalSteps: steps.length,
      withinBudget: budget === null || totalCost < budget,
      totalCost,
      usage: totalUsage,
      interrupted,
    };
    onEvent?.({ type: "done", result });
    return result;
  }

}
