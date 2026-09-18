import { describe, bench } from "vitest";
import { HilbrasClient } from "../src/index.js";

// ─── Client Initialization ─────────────────────────────────────────────────

describe("Client initialization", () => {
  bench("create HilbrasClient", () => {
    new HilbrasClient();
  });

  bench("create HilbrasClient with config", () => {
    new HilbrasClient({
      defaultProvider: "test",
      defaultModel: "test-model",
    });
  });
});

// ─── Provider Registration ─────────────────────────────────────────────────

describe("Provider registration", () => {
  bench("register single provider", () => {
    const client = new HilbrasClient();
    client.addProvider({
      name: "test",
      baseUrl: "https://api.test.com/v1",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "openai",
      models: [
        {
          id: "test-model",
          contextWindow: 128000,
          maxOutputTokens: 4096,
          capabilities: {
            streaming: true,
            tools: true,
            vision: false,
            reasoning: false,
            structuredOutput: true,
            parallelTools: false,
            systemPrompts: true,
          },
        },
      ],
    });
  });
});

// ─── URL Validation (SSRF Guard) ──────────────────────────────────────────

describe("URL validation", () => {
  const client = new HilbrasClient();

  bench("validate safe URL", () => {
    client.validateBaseUrl("https://api.openai.com/v1");
  });

  bench("validate localhost URL (should reject)", () => {
    try {
      client.validateBaseUrl("http://localhost:3000");
    } catch {
      // Expected
    }
  });

  bench("validate AWS metadata URL (should reject)", () => {
    try {
      client.validateBaseUrl("http://169.254.169.254/latest/meta-data");
    } catch {
      // Expected
    }
  });
});
