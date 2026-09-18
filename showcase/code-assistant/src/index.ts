/**
 * Code Assistant Showcase
 *
 * Demonstrates @hilbras/agent with ToolLoopAgent for code assistance.
 */

import { ToolLoopAgent, type AgentTool } from "@hilbras/agent";

// Define tools for the code assistant
const tools: AgentTool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
    execute: async (params) => {
      // In a real implementation, this would read from the filesystem
      return { content: `Contents of ${params.path}` };
    },
  },
  {
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (params) => {
      return { success: true, path: params.path };
    },
  },
  {
    name: "search_code",
    description: "Search for code patterns",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    execute: async (params) => {
      return { results: [`Found matches for "${params.query}"`] };
    },
  },
];

async function main() {
  console.log("Code Assistant Showcase");
  console.log("=======================\n");

  const agent = new ToolLoopAgent({
    provider: "test",
    model: "test-model",
    tools,
    maxSteps: 5,
    systemPrompt: "You are a helpful code assistant. Use tools to help with coding tasks.",
    onEvent: (event) => {
      if (event.type === "tool_call") {
        console.log(`  Tool: ${event.tool}`);
      }
    },
  });

  // Example: Agent uses tools to complete a task
  const result = await agent.run(
    "Read the package.json file and tell me what dependencies are listed"
  );

  console.log("\nResult:", result.answer);
  console.log("Steps:", result.totalSteps);
  console.log("Cost:", result.totalCost);
}

main().catch(console.error);
