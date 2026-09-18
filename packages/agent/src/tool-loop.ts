/**
 * @hilbras/agent — ToolLoopAgent
 *
 * Multi-step agent that loops through tool calls until the task is complete.
 * Supports:
 * - Direct HilbrasClient integration (gets retry, budget, circuit breaker)
 * - Human-in-the-loop approval
 * - Budget enforcement
 * - Cost tracking per step
 * - Structured output for agent steps
 * - Cancellation via AbortSignal
 */

import type { HilbrasClient } from "@hilbras/sdk";
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

export interface ToolLoopAgentConfig extends AgentConfig {
  /** Tools available to the agent */
  tools: AgentTool[];
  /**
   * HilbrasClient instance. When provided, the agent automatically gets
   * retry, circuit breaker, budget enforcement, and cost tracking from
   * the client's reliability pipeline.
   */
  client?: HilbrasClient;
  /** Custom LLM function (used when client is not provided) */
  llm?: (messages: Array<{ role: string; content: string }>) => Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  /** Function to estimate cost from usage */
  costEstimator?: (usage: { promptTokens: number; completionTokens: number }, model: string) => number;
  /** Approval handler — return true to approve, false to reject */
  onApproval?: (step: number, tool: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Event listener for agent lifecycle */
  onEvent?: (event: AgentEvent) => void;
}

function defaultCostEstimator(usage: { promptTokens: number; completionTokens: number }, model: string): number {
  // Rough cost estimates per 1M tokens
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 0.8, output: 4 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  };
  const p = pricing[model] ?? { input: 3, output: 15 };
  return (usage.promptTokens * p.input + usage.completionTokens * p.output) / 1_000_000;
}

function defaultLLM(messages: Array<{ role: string; content: string }>): Promise<{
  content: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  usage?: { promptTokens: number; completionTokens: number };
}> {
  throw new Error("No LLM function provided. Pass llm() in ToolLoopAgentConfig.");
}

export class ToolLoopAgent {
  private _config: ToolLoopAgentConfig;

  constructor(config: ToolLoopAgentConfig) {
    this._config = config;
  }

  /**
   * Run the agent loop.
   * Returns the final answer and all steps taken.
   */
  async run(initialPrompt: string): Promise<AgentResult> {
    const {
      tools,
      maxSteps = 10,
      budget = null,
      systemPrompt = "You are a helpful assistant. Use the provided tools to complete the task. When you have the final answer, respond with it directly without calling more tools.",
      temperature = 0,
      signal,
      client,
      llm = defaultLLM,
      costEstimator = defaultCostEstimator,
      onApproval,
      onEvent,
    } = this._config;

    // If client is provided, wrap it as an LLM function
    const effectiveLLM = client
      ? async (messages: Array<{ role: string; content: string }>) => {
          const result = await client.complete({
            provider: this._config.provider,
            model: this._config.model,
            messages: messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
            tools: tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters as Record<string, unknown>,
              },
            })),
            temperature,
          });
          return {
            content: result.text,
            toolCalls: result.toolCalls?.map((tc) => ({
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            })),
            usage: result.usage ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens } : undefined,
          };
        }
      : llm;

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

      // Check budget
      if (budget !== null && totalCost >= budget) {
        break;
      }

      onEvent?.({ type: "step_start", step: stepNum });

      // Call LLM
      let response: Awaited<ReturnType<typeof effectiveLLM>>;
      try {
        response = await effectiveLLM(messages);
      } catch (error) {
        onEvent?.({ type: "error", error: error as Error });
        throw error;
      }

      const usage = response.usage ?? { promptTokens: 0, completionTokens: 0 };
      const cost = costEstimator(usage, this._config.model);

      totalUsage.promptTokens += usage.promptTokens;
      totalUsage.completionTokens += usage.completionTokens;
      totalUsage.totalTokens += usage.promptTokens + usage.completionTokens;
      totalUsage.estimatedCost += cost;
      totalCost += cost;

      // Check if there are tool calls
      const toolCalls = response.toolCalls ?? [];
      const done = toolCalls.length === 0;

      if (done) {
        const step: AgentStep = {
          step: stepNum,
          content: response.content,
          toolCalls: [],
          done: true,
          usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.promptTokens + usage.completionTokens, estimatedCost: cost },
        };
        steps.push(step);
        onEvent?.({ type: "step_complete", step });

        const result: AgentResult = {
          answer: response.content,
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

      // Execute tool calls
      const stepToolCalls: ToolCallRecord[] = [];

      for (const tc of toolCalls) {
        if (signal?.aborted) {
          interrupted = true;
          break;
        }

        const tool = tools.find((t) => t.name === tc.name);
        if (!tool) {
          stepToolCalls.push({
            name: tc.name,
            args: tc.arguments,
            result: null,
            error: `Tool "${tc.name}" not found`,
          });
          continue;
        }

        // Approval check
        let approved = true;
        if (onApproval) {
          onEvent?.({ type: "approval_needed", step: stepNum, tool: tc.name, args: tc.arguments });
          approved = await onApproval(stepNum, tc.name, tc.arguments);
          if (!approved) {
            onEvent?.({ type: "approval_rejected", step: stepNum, tool: tc.name });
            stepToolCalls.push({
              name: tc.name,
              args: tc.arguments,
              result: null,
              error: "Rejected by user",
              approved: false,
            });
            interrupted = true;
            break;
          }
          onEvent?.({ type: "approval_granted", step: stepNum, tool: tc.name });
        }

        onEvent?.({ type: "tool_call", step: stepNum, tool: tc.name, args: tc.arguments });

        const toolContext: ToolContext = {
          step: stepNum,
          maxSteps,
          totalCost,
          budget,
          needsApproval: false,
          signal,
        };

        try {
          const result = await tool.execute(tc.arguments, toolContext);
          stepToolCalls.push({ name: tc.name, args: tc.arguments, result, approved });
          onEvent?.({ type: "tool_result", step: stepNum, tool: tc.name, result });
        } catch (error) {
          stepToolCalls.push({
            name: tc.name,
            args: tc.arguments,
            result: null,
            error: (error as Error).message,
            approved,
          });
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

      // Add assistant message and tool results to conversation
      messages.push({ role: "assistant", content: response.content });
      for (const tc of stepToolCalls) {
        const resultStr = tc.error ? `Error: ${tc.error}` : JSON.stringify(tc.result);
        messages.push({ role: "user", content: `Tool "${tc.name}" result: ${resultStr}` });
      }
    }

    // Max steps reached
    const lastStep = steps[steps.length - 1];
    const answer = lastStep?.content ?? "Agent reached maximum steps without completing.";

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
