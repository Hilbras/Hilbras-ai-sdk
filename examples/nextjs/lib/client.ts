import { HilbrasClient } from "@hilbras/sdk";

let client: HilbrasClient | null = null;

export function getClient(): HilbrasClient {
  if (client) return client;

  const providers = [];

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authentication: { type: "bearer" as const, apiKey: process.env.OPENAI_API_KEY },
      adapter: "openai" as const,
      models: [
        { id: "gpt-4o", contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true },
        { id: "gpt-4o-mini", contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true },
      ],
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      authentication: { type: "bearer" as const, apiKey: process.env.ANTHROPIC_API_KEY },
      adapter: "anthropic" as const,
      models: [
        { id: "claude-sonnet-4-20250514", contextWindow: 200000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true },
      ],
    });
  }

  client = new HilbrasClient({
    providers,
    budget: { sessionBudget: parseFloat(process.env.HILBRAS_BUDGET ?? "5.00") },
  });

  return client;
}
