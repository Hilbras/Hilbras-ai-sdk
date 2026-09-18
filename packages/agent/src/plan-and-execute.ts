/**
 * @hilbras/agent — PlanAndExecuteAgent
 *
 * Two-phase agent:
 * 1. Planning phase: LLM creates a step-by-step plan
 * 2. Execution phase: Execute each step, optionally re-planning if a step fails
 *
 * Good for complex tasks that benefit from explicit planning upfront.
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

export interface PlanAndExecuteAgentConfig extends AgentConfig {
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
  /** Whether to re-plan after a failed step (default: true) */
  replanOnFailure?: boolean;
}

const PLAN_SYSTEM_PROMPT = `You are a planning agent. Given a task and available tools, create a step-by-step plan.

Respond with a JSON array of steps. Each step should be:
{
  "step": <step_number>,
  "action": "<description of what to do>",
  "tool": "<tool_name or null if just thinking>",
  "args": { <tool arguments> }
}

Example:
[
  { "step": 1, "action": "Search for relevant documents", "tool": "search", "args": { "query": "climate change" } },
  { "step": 2, "action": "Summarize the findings", "tool": null, "args": {} }
]

Respond ONLY with the JSON array. No other text.`;

export class PlanAndExecuteAgent {
  private _config: PlanAndExecuteAgentConfig;

  constructor(config: PlanAndExecuteAgentConfig) {
    this._config = config;
  }

  /**
   * Run the plan-and-execute agent.
   */
  async run(initialPrompt: string): Promise<AgentResult> {
    const {
      tools,
      maxSteps = 10,
      budget = null,
      systemPrompt = PLAN_SYSTEM_PROMPT,
      temperature = 0,
      signal,
      llm,
      costEstimator,
      onApproval,
      onEvent,
      replanOnFailure = true,
    } = this._config;

    const effectiveLLM = llm ?? (() => { throw new Error("No LLM function provided. Pass llm() in PlanAndExecuteAgentConfig."); });
    const effectiveCost = costEstimator ?? (() => 0);

    const steps: AgentStep[] = [];
    let totalCost = 0;
    let totalUsage: StepUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 };
    let interrupted = false;

    // Phase 1: Planning
    onEvent?.({ type: "step_start", step: 0 });

    const planMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Task: ${initialPrompt}\n\nAvailable tools: ${tools.map((t) => `${t.name}: ${t.description}`).join("\n")}` },
    ];

    let plan: Array<{ step: number; action: string; tool: string | null; args: Record<string, unknown> }>;
    try {
      const planResponse = await effectiveLLM(planMessages);
      const planUsage = planResponse.usage ?? { promptTokens: 0, completionTokens: 0 };
      const planCost = effectiveCost(planUsage, this._config.model);

      totalUsage.promptTokens += planUsage.promptTokens;
      totalUsage.completionTokens += planUsage.completionTokens;
      totalUsage.totalTokens += planUsage.promptTokens + planUsage.completionTokens;
      totalUsage.estimatedCost += planCost;
      totalCost += planCost;

      // Parse plan from response
      const jsonMatch = planResponse.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("Failed to parse plan from LLM response");
      }
      plan = JSON.parse(jsonMatch[0]);
    } catch (error) {
      onEvent?.({ type: "error", error: error as Error });
      throw error;
    }

    // Phase 2: Execution
    const execMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: "You are an execution agent. Follow the plan and execute each step. When you encounter a tool, call it. When all steps are done, provide a final summary." },
      { role: "user", content: `Plan:\n${JSON.stringify(plan, null, 2)}\n\nExecute this plan step by step.` },
    ];

    for (let i = 0; i < Math.min(plan.length, maxSteps); i++) {
      if (signal?.aborted) {
        interrupted = true;
        break;
      }

      if (budget !== null && totalCost >= budget) break;

      const planStep = plan[i];
      onEvent?.({ type: "step_start", step: i });

      if (planStep.tool) {
        const tool = tools.find((t) => t.name === planStep.tool);
        if (!tool) {
          steps.push({
            step: i,
            content: `Planned step: ${planStep.action}`,
            toolCalls: [{ name: planStep.tool, args: planStep.args, result: null, error: `Tool "${planStep.tool}" not found` }],
            done: false,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
          });
          continue;
        }

        // Approval
        let approved = true;
        if (onApproval) {
          onEvent?.({ type: "approval_needed", step: i, tool: planStep.tool, args: planStep.args });
          approved = await onApproval(i, planStep.tool, planStep.args);
          if (!approved) {
            onEvent?.({ type: "approval_rejected", step: i, tool: planStep.tool });
            interrupted = true;
            break;
          }
          onEvent?.({ type: "approval_granted", step: i, tool: planStep.tool });
        }

        onEvent?.({ type: "tool_call", step: i, tool: planStep.tool, args: planStep.args });

        const ctx: ToolContext = { step: i, maxSteps, totalCost, budget, needsApproval: false, signal };

        let toolResult: unknown;
        let toolError: string | undefined;
        try {
          toolResult = await tool.execute(planStep.args, ctx);
          onEvent?.({ type: "tool_result", step: i, tool: planStep.tool, result: toolResult });
        } catch (error) {
          toolError = (error as Error).message;
        }

        const toolCall: ToolCallRecord = {
          name: planStep.tool,
          args: planStep.args,
          result: toolResult,
          error: toolError,
          approved,
        };

        steps.push({
          step: i,
          content: planStep.action,
          toolCalls: [toolCall],
          done: false,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        });

        // Re-plan on failure if enabled
        if (toolError && replanOnFailure && i < plan.length - 1) {
          execMessages.push({
            role: "user",
            content: `Step ${i + 1} failed: ${toolError}. Please adjust the remaining plan.`,
          });
        }
      } else {
        // Thinking step — no tool needed
        steps.push({
          step: i,
          content: planStep.action,
          toolCalls: [],
          done: false,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        });
      }
    }

    // Final summary
    let answer: string;
    try {
      const summaryResponse = await effectiveLLM([
        ...execMessages,
        { role: "user", content: "All steps completed. Provide a final summary of the results." },
      ]);
      answer = summaryResponse.content;

      const summaryUsage = summaryResponse.usage ?? { promptTokens: 0, completionTokens: 0 };
      const summaryCost = effectiveCost(summaryUsage, this._config.model);
      totalUsage.promptTokens += summaryUsage.promptTokens;
      totalUsage.completionTokens += summaryUsage.completionTokens;
      totalUsage.totalTokens += summaryUsage.promptTokens + summaryUsage.completionTokens;
      totalUsage.estimatedCost += summaryCost;
      totalCost += summaryCost;
    } catch {
      answer = steps.map((s) => s.content).join("\n");
    }

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
