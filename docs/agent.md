# Agent Framework

`@hilbras/agent` provides building blocks for multi-step AI agents.

## Installation

```bash
npm install @hilbras/agent
```

## ToolLoopAgent

Multi-step agent that loops through tool calls until the task is complete.

```typescript
import { ToolLoopAgent, type AgentTool } from "@hilbras/agent";

const calculatorTool: AgentTool = {
  name: "calculator",
  description: "Perform a calculation",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  execute: async (params) => eval(params.expression as string),
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
import { ReActAgent } from "@hilbras/agent";

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
import { PlanAndExecuteAgent } from "@hilbras/agent";

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
