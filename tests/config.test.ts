import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, createConfig, validateConfig } from "../src/config/config.js";
import { buildPrompt, buildCodingAgentPrompt } from "../src/config/prompts.js";
import { createDegradationChain } from "../src/reliability/degradation.js";

describe("Config management", () => {
  it("createConfig returns defaults", () => {
    const config = createConfig();
    expect(config.temperature).toBe(0.7);
    expect(config.maxTokens).toBe(4096);
    expect(config.stream).toBe(true);
    expect(config.logLevel).toBe("none");
  });

  it("createConfig applies overrides", () => {
    const config = createConfig({ temperature: 1.0, maxTokens: 8192 });
    expect(config.temperature).toBe(1.0);
    expect(config.maxTokens).toBe(8192);
    expect(config.stream).toBe(true); // default preserved
  });

  it("loadConfig merges env vars", () => {
    process.env.HILBRAS_DEFAULT_MODEL = "test-model";
    process.env.HILBRAS_TEMPERATURE = "0.5";
    const config = loadConfig();
    expect(config.defaultModel).toBe("test-model");
    expect(config.temperature).toBe(0.5);
    delete process.env.HILBRAS_DEFAULT_MODEL;
    delete process.env.HILBRAS_TEMPERATURE;
  });

  it("validateConfig catches invalid temperature", () => {
    const error = validateConfig(createConfig({ temperature: 3.0 }));
    expect(error).toContain("Temperature");
  });

  it("validateConfig returns null for valid config", () => {
    expect(validateConfig(createConfig())).toBeNull();
  });
});

describe("Prompt builder", () => {
  it("buildPrompt interpolates variables", () => {
    const prompt = buildPrompt([
      { heading: "Greeting", content: "Hello ${name}, you are ${role}." },
    ], [
      { name: "name", value: "Alice" },
      { name: "role", value: "admin" },
    ]);
    expect(prompt).toContain("# Greeting");
    expect(prompt).toContain("Hello Alice, you are admin.");
  });

  it("buildCodingAgentPrompt includes tool section", () => {
    const prompt = buildCodingAgentPrompt({
      tools: [
        { name: "read", description: "Read files" },
        { name: "write", description: "Write files" },
      ],
    });
    expect(prompt).toContain("Available Tools");
    expect(prompt).toContain("read");
    expect(prompt).toContain("write");
  });
});

describe("Degradation chain", () => {
  it("creates 4 degradation levels", () => {
    const chain = createDegradationChain();
    expect(chain).toHaveLength(4);
    expect(chain[0].name).toBe("normal");
    expect(chain[1].name).toBe("media-degraded");
  });

  it("normal level passes through unchanged", () => {
    const chain = createDegradationChain();
    const msgs = [{ role: "user" as const, content: "hello" }];
    const result = chain[0].transform(msgs);
    expect(result).toEqual(msgs);
  });

  it("media-stripped removes image references", () => {
    const chain = createDegradationChain();
    const msgs = [{ role: "user" as const, content: "Look at ![](image.png)" }];
    const result = chain[2].transform(msgs);
    expect(result[0].content).toContain("[image removed]");
    expect(result[0].content).not.toContain("![");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PR-2 v0.10.0: loadConfig SSRF + redaction + ProviderConfig unification
// ═══════════════════════════════════════════════════════════════════════════

import { redact } from "../src/logging/logger.js";

describe("PR-2: loadConfig security hardening", () => {
  // Snapshot env so tests don't leak.
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("HILBRAS_")) savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("HILBRAS_")) delete process.env[k];
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
    for (const k of Object.keys(savedEnv)) delete savedEnv[k];
  });

  describe("HILBRAS_PROVIDER_URL SSRF bypass closed", () => {
    it("rejects http://169.254.169.254 even via env", () => {
      process.env.HILBRAS_PROVIDER_URL = "http://169.254.169.254/";
      process.env.HILBRAS_PROVIDER_KEY = "sk-test-1234567890abcdef";
      expect(() => loadConfig()).toThrow(/SSRF guard/);
    });

    it("rejects file:// scheme", () => {
      process.env.HILBRAS_PROVIDER_URL = "file:///etc/passwd";
      process.env.HILBRAS_PROVIDER_KEY = "sk-test-1234567890abcdef";
      expect(() => loadConfig()).toThrow(/SSRF guard/);
    });

    it("accepts a normal https URL", () => {
      process.env.HILBRAS_PROVIDER_URL = "https://api.openai.com/v1";
      process.env.HILBRAS_PROVIDER_KEY = "sk-test-1234567890abcdef";
      const config = loadConfig();
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].baseUrl).toBe("https://api.openai.com/v1");
      expect(config.providers[0].adapter).toBe("openai");
    });

    it("accepts http://localhost (Ollama use case)", () => {
      process.env.HILBRAS_PROVIDER_URL = "http://localhost:11434";
      process.env.HILBRAS_PROVIDER_KEY = "sk-test-1234567890abcdef";
      const config = loadConfig();
      expect(config.providers[0].baseUrl).toBe("http://localhost:11434");
      expect(config.providers[0].adapter).toBe("ollama");
      expect(config.providers[0].allowInsecure).toBe(true);
    });
  });

  describe("HILBRAS_PROVIDER_KEY redaction", () => {
    it("redacts the API key when stored on the config", () => {
      process.env.HILBRAS_PROVIDER_URL = "https://api.openai.com/v1";
      process.env.HILBRAS_PROVIDER_KEY = "sk-proj-abc123def456ghi789jkl012mno";
      const config = loadConfig();
      const auth = config.providers[0].authentication;
      expect(auth.type).toBe("bearer");
      if (auth.type === "bearer") {
        expect(auth.apiKey).toBe("sk-proj-abc123def456ghi789jkl012mno");
      }
    });
  });

  describe("adapter inference from URL", () => {
    it("infers anthropic from URL", () => {
      process.env.HILBRAS_PROVIDER_URL = "https://api.anthropic.com";
      process.env.HILBRAS_PROVIDER_KEY = "sk-ant-api03-1234567890abcdefghij";
      const config = loadConfig();
      expect(config.providers[0].adapter).toBe("anthropic");
    });
    it("infers google-genai from URL", () => {
      process.env.HILBRAS_PROVIDER_URL = "https://generativelanguage.googleapis.com/v1beta";
      process.env.HILBRAS_PROVIDER_KEY = "AIzaSy-1234567890abcdef";
      const config = loadConfig();
      expect(config.providers[0].adapter).toBe("google-genai");
    });
    it("defaults to openai for an unknown URL", () => {
      process.env.HILBRAS_PROVIDER_URL = "https://my-llm-proxy.example.com";
      process.env.HILBRAS_PROVIDER_KEY = "sk-proxy-1234567890abcdef";
      const config = loadConfig();
      expect(config.providers[0].adapter).toBe("openai");
    });
  });

  describe("ProviderConfig type unification (PR-2)", () => {
    it("ProviderConfig imported from @hilbras/sdk matches the canonical shape", async () => {
      const { ProviderConfig } = await import("../src/index.js");
      const sample: ProviderConfig = {
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        authentication: { type: "bearer", apiKey: redact("sk-test") },
        models: [],
        adapter: "openai",
      };
      expect(sample.adapter).toBe("openai");
      expect(sample.authentication.type).toBe("bearer");
    });
  });

  describe("validateConfig now checks provider URLs (PR-2)", () => {
    it("rejects a config whose provider baseUrl fails the SSRF guard", () => {
      const config = createConfig({
        providers: [{
          name: "evil",
          baseUrl: "http://169.254.169.254/",
          authentication: { type: "bearer", apiKey: "sk-test" },
          models: [],
          adapter: "openai",
        }],
      });
      const err = validateConfig(config);
      expect(err).toMatch(/evil.*SSRF|evil.*baseUrl/i);
    });
  });
});
