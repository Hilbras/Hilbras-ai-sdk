import { describe, expect, it } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { createEnvironmentSource } from "../../src/config/sources/environment.js";
import { resolveConfig } from "../../src/config/config-resolver.js";

const provider = {
  name: "configured-provider",
  baseUrl: "https://configured.example.com/v1",
  adapter: "openai",
  authentication: { type: "none" as const },
  models: [{
    id: "configured-model",
    contextWindow: 8192,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false,
      structuredOutput: false,
      parallelTools: false,
      systemPrompts: true,
      embeddings: false,
      imageGeneration: false,
      speech: false,
      transcription: false,
      reranking: false,
    },
  }],
};

describe("HilbrasClient configuration integration", () => {
  it("resolves canonical config once and exposes a redacted snapshot", () => {
    const client = new HilbrasClient({
      config: {
        maxRetries: 1,
        requestTimeoutMs: 2000,
        sessionBudget: 5,
        providers: [provider],
      },
    });

    expect(client.listProviders().map((p) => p.name)).toEqual(["configured-provider"]);
    expect(client.getConfigSnapshot().providers[0]?.authentication).toEqual({ type: "none" });
    expect(client.getConfigDiagnostics()).toEqual([]);
  });

  it("accepts explicit configuration sources", () => {
    const client = new HilbrasClient({
      configSources: [createEnvironmentSource({
        HILBRAS_PROVIDER_URL: "https://env.example.com/v1",
        HILBRAS_PROVIDER_KEY: "sk-test-1234567890",
        HILBRAS_PROVIDER_NAME: "env-provider",
      })],
    });

    expect(client.listProviders().map((p) => p.name)).toEqual(["env-provider"]);
    expect(JSON.stringify(client.getConfigSnapshot())).not.toContain("sk-test-1234567890");
  });

  it("keeps sdkConfig as a compatibility input", () => {
    const client = new HilbrasClient({
      sdkConfig: {
        defaultProvider: "",
        defaultModel: "compat-model",
        temperature: 0.7,
        maxTokens: 4096,
        stream: true,
        toolsEnabled: true,
        reasoningEnabled: false,
        logLevel: "none",
        requestTimeoutMs: 2000,
        maxRetries: 1,
        circuitBreakerEnabled: true,
        circuitBreakerThreshold: 5,
        circuitBreakerResetMs: 1000,
        promptCaching: true,
        workspaceDir: "/tmp",
        providers: [],
        allowedTools: [],
        deniedTools: [],
      },
    });

    expect(client.getConfigSnapshot().defaultModel).toBe("compat-model");
  });

  it("accepts a pre-resolved configuration", () => {
    const resolved = resolveConfig({
      sources: [{
        kind: "runtime",
        load: () => ({ values: { providers: [provider] } }),
      }],
    });
    const client = new HilbrasClient({ resolvedConfig: resolved });

    expect(client.listProviders().map((p) => p.name)).toEqual(["configured-provider"]);
  });
});
