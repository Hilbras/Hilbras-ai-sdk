import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
  adapter: "openai",
  models: [
    {
      id: "gpt-4o",
      contextWindow: 128000,
      maxOutputTokens: 16384,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        reasoning: true,
        structuredOutput: true,
        parallelTools: true,
        systemPrompts: true,
      },
    },
  ],
});

// Streaming
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}
