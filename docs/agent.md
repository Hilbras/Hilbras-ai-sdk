# Agent Framework

`@hilbras/sdk` provides building blocks for multi-step AI agents.

## Installation

```bash
npm install @hilbras/sdk
```

## ToolLoopAgent

Multi-step agent that loops through tool calls until the task is complete.

```typescript
import { ToolLoopAgent, type AgentTool } from "@hilbras/sdk/agent";

const calculatorTool: AgentTool = {
  name: "calculator",
  description: "Perform one allowlisted arithmetic operation",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
      left: { type: "number" },
      right: { type: "number" },
    },
    required: ["operation", "left", "right"],
  },
  execute: async ({ operation, left, right }) => {
    switch (operation) {
      case "add": return Number(left) + Number(right);
      case "subtract": return Number(left) - Number(right);
      case "multiply": return Number(left) * Number(right);
      case "divide": return Number(right) === 0 ? null : Number(left) / Number(right);
      default: throw new Error("Unsupported calculator operation");
    }
  },
};

const agent = new ToolLoopAgent({
  provider: "openai",
  model: "gpt-4o",
  tools: [calculatorTool],
  budget: 0.10,
  onApproval: async (step, tool, args) => {
    return confirm(`Approve ${tool} with ${JSON.stringify(args)}?`);
  },
});

const result = await agent.run("What is 2 + 3?");
console.log(result.answer);     // "5"
console.log(result.totalCost);  // 0.0032
console.log(result.steps);      // Array of AgentStep
```

## ReActAgent

Reasoning + Acting agent that follows the Think → Act → Observe pattern.

```typescript
import { ReActAgent } from "@hilbras/sdk/agent";

const agent = new ReActAgent({
  provider: "openai",
  model: "gpt-4o",
  tools: [searchTool, calculatorTool],
  maxSteps: 10,
});

const result = await agent.run("What is the population of France divided by 2?");
```

## PlanAndExecuteAgent

Two-phase agent: first creates a plan, then executes each step.

```typescript
import { PlanAndExecuteAgent } from "@hilbras/sdk/agent";

const agent = new PlanAndExecuteAgent({
  provider: "openai",
  model: "gpt-4o",
  tools: [searchTool, calculatorTool],
  replanOnFailure: true,
});

const result = await agent.run("Research and compare GDP of top 5 countries");
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxSteps` | 10 | Maximum number of steps |
| `budget` | null | Budget limit in dollars (null = no limit) |
| `temperature` | 0 | LLM temperature |
| `systemPrompt` | varies | System prompt for the agent |
| `signal` | undefined | AbortSignal for cancellation |
| `onApproval` | undefined | Approval handler for tool calls |
| `onEvent` | undefined | Event listener for lifecycle events |

## Events

The agent emits lifecycle events:

```typescript
const agent = new ToolLoopAgent({
  onEvent: (event) => {
    switch (event.type) {
      case "step_start":     // Step N started
      case "step_complete":  // Step N completed
      case "tool_call":      // Tool called
      case "tool_result":    // Tool returned
      case "approval_needed":// Waiting for approval
      case "done":           // Agent finished
    }
  },
});
```
