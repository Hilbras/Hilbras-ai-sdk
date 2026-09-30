import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/config-resolver.js";
import { createEnvironmentSource } from "../../src/config/sources/environment.js";
import { createFileSource } from "../../src/config/sources/file.js";
import { createRuntimeSource } from "../../src/config/sources/runtime.js";
import { ConfigurationError } from "../../src/errors/index.js";

describe("v3.3 configuration resolver", () => {
  it("resolves defaults and runtime overrides without mutating inputs", () => {
    const overrides = { temperature: 0.9, providers: [] };
    const resolved = resolveConfig({
      sources: [createRuntimeSource(overrides)],
    });

    expect(resolved.values.temperature).toBe(0.9);
    expect(resolved.values.maxTokens).toBe(4096);
    overrides.temperature = 0.1;
    expect(resolved.values.temperature).toBe(0.9);
    expect(resolved.fieldSources.temperature).toBe("runtime");
  });

  it("replaces arrays instead of merging them", () => {
    const resolved = resolveConfig({
      sources: [createRuntimeSource({ providers: [] })],
    });

    expect(resolved.values.providers).toEqual([]);
    expect(resolved.values.allowedTools).toEqual([]);
  });

  it("rejects malformed environment values in strict mode", () => {
    const source = createEnvironmentSource({
      HILBRAS_TEMPERATURE: "not-a-number",
      HILBRAS_STREAM: "maybe",
    });

    expect(() => resolveConfig({ sources: [source], strict: true })).toThrow(ConfigurationError);
  });

  it("loads a file through an injected reader", () => {
    const source = createFileSource({
      path: "/virtual/hilbras.json",
      readFile: () => JSON.stringify({ defaultModel: "file-model", maxTokens: 2048 }),
    });
    const resolved = resolveConfig({ sources: [source] });

    expect(resolved.values.defaultModel).toBe("file-model");
    expect(resolved.values.maxTokens).toBe(2048);
    expect(resolved.fieldSources.defaultModel).toBe("file");
  });

  it("reports malformed files instead of silently accepting an empty config", () => {
    const source = createFileSource({
      path: "/virtual/bad.json",
      readFile: () => "{bad-json",
    });

    expect(() => resolveConfig({ sources: [source] })).toThrow(ConfigurationError);
  });

  it("returns a secret-safe snapshot", () => {
    const resolved = resolveConfig({
      sources: [createRuntimeSource({
        providers: [{
          name: "secure",
          baseUrl: "https://api.example.com/v1",
          adapter: "openai",
          authentication: { type: "bearer", apiKey: "sk-secret-value" },
          models: [],
          extraHeaders: { "x-secret": "header-secret" },
        }],
      })],
    });

    const snapshot = resolved.safeSnapshot();
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret-value");
    expect(JSON.stringify(snapshot)).not.toContain("header-secret");
    expect(snapshot.providers[0]?.authentication).toEqual({ type: "bearer" });
  });

  it("warns for unknown keys and rejects them in strict mode", () => {
    const source = createRuntimeSource({ unknownOption: true } as never);

    const warned = resolveConfig({ sources: [source] });
    expect(warned.diagnostics.some((d) => d.code === "CONFIG_UNKNOWN_KEY")).toBe(true);
    expect(() => resolveConfig({ sources: [source], rejectUnknownKeys: true })).toThrow(ConfigurationError);
  });

  it("validates provider URLs from runtime configuration", () => {
    const source = createRuntimeSource({
      providers: [{
        name: "blocked",
        baseUrl: "http://169.254.169.254/",
        adapter: "openai",
        authentication: { type: "none" },
        models: [],
      }],
    });

    expect(() => resolveConfig({ sources: [source] })).toThrow(ConfigurationError);
  });
});
