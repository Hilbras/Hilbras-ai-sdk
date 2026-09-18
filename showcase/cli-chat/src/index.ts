/**
 * CLI Chat Showcase
 *
 * Demonstrates streaming with @hilbras/sdk in a terminal app.
 */

import { HilbrasClient } from "@hilbras/sdk";

async function main() {
  const client = new HilbrasClient();

  // Add a provider (using placeholder config)
  client.addProvider({
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY || "demo" },
    adapter: "openai",
    models: [
      {
        id: "gpt-4o",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: {
          streaming: true,
          tools: false,
          vision: false,
          reasoning: false,
          structuredOutput: false,
          parallelTools: false,
          systemPrompts: true,
        },
      },
    ],
  });

  console.log("CLI Chat Showcase");
  console.log("=================\n");
  console.log("This demo shows streaming capabilities.");
  console.log("In a real app, you would connect to an actual LLM provider.\n");

  // Simulate streaming response
  const messages = [
    { role: "user" as const, content: "Tell me a short joke" },
  ];

  console.log("User: Tell me a short joke\n");
  console.log("Assistant: ", { streaming: true });

  // Simulate streaming chunks
  const joke = "Why do programmers prefer dark mode? Because light attracts bugs!";
  for (const char of joke) {
    process.stdout.write(char);
    await new Promise((r) => setTimeout(r, 30));
  }
  console.log("\n");

  console.log("\n[Demo complete - in production, this would stream from an LLM]");
}

main().catch(console.error);
