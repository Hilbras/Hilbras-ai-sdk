import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig, loadConfig, validateConfig } from "../../src/config/config.js";

const originalEnv = { ...process.env };
let tempDir: string | undefined;

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("HILBRAS_")) delete process.env[key];
  }
  tempDir = mkdtempSync(join(tmpdir(), "hilbras-config-"));
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("HILBRAS_")) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("v3.2 configuration compatibility", () => {
  it("applies file, environment, and runtime precedence in order", () => {
    const configPath = join(tempDir!, "hilbras.config.json");
    writeFileSync(configPath, JSON.stringify({
      defaultModel: "file-model",
      temperature: 0.2,
      maxTokens: 2048,
    }));

    process.env.HILBRAS_DEFAULT_MODEL = "env-model";
    process.env.HILBRAS_TEMPERATURE = "0.4";

    const config = loadConfig({
      configPath,
      overrides: { temperature: 0.9 },
    });

    expect(config.defaultModel).toBe("env-model");
    expect(config.temperature).toBe(0.9);
    expect(config.maxTokens).toBe(2048);
  });

  it("keeps the legacy permissive file behavior", () => {
    const missingPath = join(tempDir!, "missing.json");
    const malformedPath = join(tempDir!, "malformed.json");
    writeFileSync(malformedPath, "{not-json");

    expect(loadConfig({ configPath: missingPath }).maxTokens).toBe(4096);
    expect(loadConfig({ configPath: malformedPath }).maxTokens).toBe(4096);
  });

  it("keeps the existing createConfig defaults and override behavior", () => {
    const config = createConfig({ temperature: 1.1, maxTokens: 8192 });

    expect(config).toMatchObject({
      temperature: 1.1,
      maxTokens: 8192,
      stream: true,
      logLevel: "none",
      providers: [],
    });
    expect(validateConfig(config)).toBeNull();
  });

  it("keeps the existing validation contract as string-or-null", () => {
    expect(validateConfig(createConfig({ temperature: 3 }))).toContain("Temperature");
    expect(validateConfig(createConfig({ requestTimeoutMs: 10 }))).toContain("requestTimeoutMs");
    expect(validateConfig(createConfig())).toBeNull();
  });

  it("keeps environment provider configuration canonical", () => {
    process.env.HILBRAS_PROVIDER_URL = "https://api.openai.com/v1";
    process.env.HILBRAS_PROVIDER_KEY = "sk-test-1234567890";
    process.env.HILBRAS_PROVIDER_NAME = "configured";

    const config = loadConfig();

    expect(config.defaultProvider).toBe("configured");
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]).toMatchObject({
      name: "configured",
      baseUrl: "https://api.openai.com/v1",
      adapter: "openai",
    });
  });
});
