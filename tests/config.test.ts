import { describe, it, expect } from "vitest";
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
