import { describe, it, expect } from "vitest";
import { ToolLoopAgent } from "../src/features/agent/tool-loop.js";
import { ReActAgent } from "../src/features/agent/react.js";
import { PlanAndExecuteAgent } from "../src/features/agent/plan-and-execute.js";
import type { AgentTool, AgentEvent, AgentStep } from "../src/types.js";

// ─── Mock Tools ────────────────────────────────────────────────────────────

const calculatorTool: AgentTool = {
  name: "calculator",
  description: "Perform a calculation",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression" },
    },
    required: ["expression"],
  },
  execute: async (params) => {
    const expr = params.expression as string;
    // Simple eval for testing
    try {
      return { result: Function(`"use strict"; return (${expr})`)() };
    } catch {
      return { error: "Invalid expression" };
    }
  },
};

const lookupTool: AgentTool = {
  name: "lookup",
  description: "Look up information",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async (params) => {
    const q = (params.query as string).toLowerCase();
    if (q.includes("capital of france")) return { answer: "Paris" };
    if (q.includes("capital of japan")) return { answer: "Tokyo" };
    return { answer: "Unknown" };
  },
};

const failTool: AgentTool = {
  name: "fail",
  description: "Always fails",
  parameters: { type: "object", properties: {} },
  execute: async () => { throw new Error("Tool failed intentionally"); },
};

// ─── ToolLoopAgent ─────────────────────────────────────────────────────────

describe("ToolLoopAgent", () => {
  it("executes tool and returns result", async () => {
    let callCount = 0;
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool],
      maxSteps: 3,
      llm: async (messages) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: "",
            toolCalls: [{ name: "calculator", arguments: { expression: "2 + 3" } }],
            usage: { promptTokens: 100, completionTokens: 50 },
          };
        }
        return {
          content: "The result is 5.",
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      },
    });

    const result = await agent.run("What is 2 + 3?");
    expect(result.answer).toBe("The result is 5.");
    expect(result.totalSteps).toBe(2);
    expect(result.steps[0].toolCalls).toHaveLength(1);
    expect(result.steps[0].toolCalls[0].result).toEqual({ result: 5 });
  });

  it("stops when no tool calls", async () => {
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [],
      llm: async () => ({
        content: "Hello!",
        usage: { promptTokens: 50, completionTokens: 10 },
      }),
    });

    const result = await agent.run("Hi");
    expect(result.answer).toBe("Hello!");
    expect(result.totalSteps).toBe(1);
    expect(result.steps[0].done).toBe(true);
  });

  it("stops at max steps", async () => {
    let step = 0;
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool],
      maxSteps: 2,
      llm: async () => {
        step++;
        return {
          content: `Step ${step}`,
          toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
          usage: { promptTokens: 100, completionTokens: 50 },
        };
      },
    });

    const result = await agent.run("Do math");
    expect(result.totalSteps).toBe(2);
    expect(result.withinBudget).toBe(true);
  });

  it("respects budget", async () => {
    let calls = 0;
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool],
      maxSteps: 10,
      budget: 0.0001,
      llm: async () => {
        calls++;
        return {
          content: "",
          toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
          usage: { promptTokens: 100000, completionTokens: 50000 },
        };
      },
    });

    const result = await agent.run("Do math forever");
    expect(result.withinBudget).toBe(false);
  });

  it("handles tool errors gracefully", async () => {
    let calls = 0;
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [failTool],
      maxSteps: 2,
      llm: async () => {
        calls++;
        if (calls === 1) {
          return {
            content: "",
            toolCalls: [{ name: "fail", arguments: {} }],
            usage: { promptTokens: 100, completionTokens: 50 },
          };
        }
        return {
          content: "The tool failed but I have an answer.",
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      },
    });

    const result = await agent.run("Try to fail");
    expect(result.steps[0].toolCalls[0].error).toBe("Tool failed intentionally");
    expect(result.answer).toBe("The tool failed but I have an answer.");
  });

  it("tracks cost", async () => {
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "gpt-4o",
      tools: [],
      llm: async () => ({
        content: "Done",
        usage: { promptTokens: 1000, completionTokens: 500 },
      }),
    });

    const result = await agent.run("Hello");
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBe(1000);
    expect(result.usage.completionTokens).toBe(500);
  });

  it("handles cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool],
      signal: controller.signal,
      llm: async () => ({
        content: "",
        toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
    });

    const result = await agent.run("Do something");
    expect(result.interrupted).toBe(true);
  });

  it("calls onEvent for lifecycle events", async () => {
    const events: AgentEvent[] = [];
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [],
      onEvent: (e) => events.push(e),
      llm: async () => ({
        content: "Done",
        usage: { promptTokens: 100, completionTokens: 20 },
      }),
    });

    await agent.run("Hello");
    expect(events[0].type).toBe("step_start");
    expect(events[1].type).toBe("step_complete");
    expect(events[2].type).toBe("done");
  });
});

// ─── ReActAgent ────────────────────────────────────────────────────────────

describe("ReActAgent", () => {
  it("follows Think/Act/Observe pattern", async () => {
    let callCount = 0;
    const agent = new ReActAgent({
      provider: "test",
      model: "test-model",
      tools: [lookupTool],
      maxSteps: 5,
      llm: async (messages) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: 'Thought: I need to find the capital of France.\nAction: lookup',
            toolCalls: [{ name: "lookup", arguments: { query: "capital of France" } }],
            usage: { promptTokens: 200, completionTokens: 50 },
          };
        }
        return {
          content: 'Thought: I now have enough information.\nFinal Answer: The capital of France is Paris.',
          usage: { promptTokens: 200, completionTokens: 30 },
        };
      },
    });

    const result = await agent.run("What is the capital of France?");
    expect(result.answer).toContain("Paris");
    expect(result.totalSteps).toBe(2);
  });

  it("handles missing tools", async () => {
    const agent = new ReActAgent({
      provider: "test",
      model: "test-model",
      tools: [],
      maxSteps: 3,
      llm: async () => ({
        content: 'Thought: I need to search.\nAction: search',
        toolCalls: [{ name: "search", arguments: { query: "test" } }],
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
    });

    const result = await agent.run("Search for something");
    expect(result.steps[0].toolCalls[0].error).toContain("not found");
  });
});

// ─── PlanAndExecuteAgent ───────────────────────────────────────────────────

describe("PlanAndExecuteAgent", () => {
  it("creates plan and executes steps", async () => {
    let callCount = 0;
    const agent = new PlanAndExecuteAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool, lookupTool],
      maxSteps: 5,
      replanOnFailure: false,
      llm: async (messages) => {
        callCount++;
        if (callCount === 1) {
          // Planning phase
          return {
            content: JSON.stringify([
              { step: 1, action: "Calculate 2+2", tool: "calculator", args: { expression: "2+2" } },
              { step: 2, action: "Look up France capital", tool: "lookup", args: { query: "capital of France" } },
            ]),
            usage: { promptTokens: 300, completionTokens: 100 },
          };
        }
        // Summary phase
        return {
          content: "The calculation gave 4 and the capital of France is Paris.",
          usage: { promptTokens: 200, completionTokens: 50 },
        };
      },
    });

    const result = await agent.run("Calculate and look up");
    expect(result.totalSteps).toBe(2);
    expect(result.steps[0].toolCalls[0].result).toEqual({ result: 4 });
    expect(result.steps[1].toolCalls[0].result).toEqual({ answer: "Paris" });
    expect(result.answer).toContain("4");
    expect(result.answer).toContain("Paris");
  });

  it("handles planning failure", async () => {
    const agent = new PlanAndExecuteAgent({
      provider: "test",
      model: "test-model",
      tools: [],
      maxSteps: 5,
      llm: async () => ({
        content: "I cannot create a plan.",
        usage: { promptTokens: 100, completionTokens: 20 },
      }),
    });

    await expect(agent.run("Do something")).rejects.toThrow("Failed to parse plan");
  });
});

// ─── Integration: Approval ─────────────────────────────────────────────────

describe("Agent approval", () => {
  it("ToolLoopAgent respects approval rejection", async () => {
    let calls = 0;
    const agent = new ToolLoopAgent({
      provider: "test",
      model: "test-model",
      tools: [calculatorTool],
      maxSteps: 5,
      onApproval: async () => false, // Reject all
      llm: async () => {
        calls++;
        if (calls === 1) {
          return {
            content: "",
            toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
            usage: { promptTokens: 100, completionTokens: 50 },
          };
        }
        return {
          content: "OK",
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      },
    });

    const result = await agent.run("Do math");
    expect(result.interrupted).toBe(true);
    expect(result.steps[0].toolCalls[0].approved).toBe(false);
  });
});
