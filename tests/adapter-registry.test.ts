/**
 * @hilbras/sdk — Adapter registry tests
 *
 * Verifies the plugin registration system works correctly:
 * built-in adapters, custom adapters, error handling.
 */

import { describe, it, expect } from "vitest";
import { AdapterRegistry, getDefaultAdapterRegistry } from "../src/providers/adapter-registry.js";
import type { AIProvider, AdapterConfig } from "../src/types/adapter.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { Transport } from "../src/transport/transport.js";

const noopTransport: Transport = {
  async request() { return new Response(null, { status: 500 }); },
  async stream() { throw new Error("unused"); },
  abort() {},
};

function makeConfig(name: string): AdapterConfig {
  return {
    provider: {
      name,
      baseUrl: "https://mock.test/v1",
      authentication: { type: "none" },
      adapter: "openai" as ProviderConfig["adapter"],
      models: [],
    },
    transport: noopTransport,
  };
}

/** A minimal custom adapter for testing plugin registration */
class CustomTestAdapter implements AIProvider {
  readonly id = "custom-test";
  async *stream() { yield { type: "text" as const, text: "custom" }; }
  async complete() { return "custom"; }
}

describe("AdapterRegistry", () => {
  it("starts empty", () => {
    const registry = new AdapterRegistry();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect(registry.has("anything")).toBe(false);
  });

  it("registers and creates adapters", () => {
    const registry = new AdapterRegistry();
    registry.register("custom", () => new CustomTestAdapter());

    expect(registry.has("custom")).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.list()).toEqual(["custom"]);

    const adapter = registry.create("custom", makeConfig("test"));
    expect(adapter.id).toBe("custom-test");
  });

  it("throws on unknown adapter ID", () => {
    const registry = new AdapterRegistry();
    expect(() => registry.create("nonexistent", makeConfig("test")))
      .toThrow('No adapter registered for "nonexistent"');
  });

  it("removes adapters", () => {
    const registry = new AdapterRegistry();
    registry.register("custom", () => new CustomTestAdapter());
    expect(registry.has("custom")).toBe(true);

    registry.remove("custom");
    expect(registry.has("custom")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("overwrites existing adapter on re-register", () => {
    const registry = new AdapterRegistry();
    registry.register("custom", () => new CustomTestAdapter());
    registry.register("custom", () => new CustomTestAdapter());
    expect(registry.size).toBe(1);
  });
});

describe("getDefaultAdapterRegistry", () => {
  it("returns a registry with all 6 built-in adapters", () => {
    const registry = getDefaultAdapterRegistry();
    expect(registry.size).toBe(6);
    expect(registry.has("openai")).toBe(true);
    expect(registry.has("anthropic")).toBe(true);
    expect(registry.has("google-genai")).toBe(true);
    expect(registry.has("azure")).toBe(true);
    expect(registry.has("groq")).toBe(true);
    expect(registry.has("ollama")).toBe(true);
  });

  it("creates working adapter instances", () => {
    const registry = getDefaultAdapterRegistry();
    const adapter = registry.create("openai", makeConfig("test"));
    expect(adapter.id).toBe("openai");
    expect(typeof adapter.stream).toBe("function");
    expect(typeof adapter.complete).toBe("function");
  });

  it("can be extended with custom adapters", () => {
    const registry = getDefaultAdapterRegistry();
    registry.register("custom", () => new CustomTestAdapter());

    expect(registry.size).toBe(7);
    expect(registry.has("custom")).toBe(true);

    const adapter = registry.create("custom", makeConfig("test"));
    expect(adapter.id).toBe("custom-test");
  });
});
