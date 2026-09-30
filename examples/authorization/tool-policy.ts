import { HilbrasClient, ToolLoopAgent } from "@hilbras/sdk";

/**
 * Tool policy is enforced where tools actually run, which is not the transport
 * layer: a denied tool must never execute, and it must not even be offered.
 */
const client = new HilbrasClient({
  config: {
    allowedTools: ["search", "fetch"],
    deniedTools: ["shell"],
  },
});

const search = {
  name: "search",
  description: "Search the knowledge base",
  parameters: { type: "object", properties: { q: { type: "string" } } },
  execute: async ({ q }: { q: string }) => `results for ${q}`,
};

const shell = {
  name: "shell",
  description: "Run a shell command",
  parameters: { type: "object", properties: { cmd: { type: "string" } } },
  execute: async ({ cmd }: { cmd: string }) => `ran: ${cmd}`,
};

const agent = new ToolLoopAgent({
  provider: "openai",
  model: "gpt-4o",
  tools: [search, shell],
  // Reuse the client's policy so both agree on what is permitted.
  toolPolicy: client.getToolPolicy(),
  llm: async () => ({ content: "done" }),
});

await agent.run("find something");

// A per-user policy can only narrow the client policy, never widen it.
const readOnly = client.getToolPolicy().narrow({ allowedTools: ["search"] });
console.log(readOnly.check("search").allowed); // true
console.log(readOnly.check("fetch").allowed); // false
