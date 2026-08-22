/**
 * @hilbras/sdk — Adapter contract compliance tests
 *
 * Verifies that all 6 built-in adapters satisfy the AIProvider interface.
 * This is a structural (duck-typing) check — if an adapter compiles
 * against AIProvider, the contract is satisfied.
 */

import { describe, it, expect } from "vitest";
import type { AIProvider } from "../src/types/adapter.js";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import { AnthropicAdapter } from "../src/adapters/anthropic.js";
import { GoogleGenAIAdapter } from "../src/adapters/google-genai.js";
import { AzureAdapter } from "../src/adapters/azure.js";
import { GroqAdapter } from "../src/adapters/groq.js";
import { OllamaAdapter } from "../src/adapters/ollama.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { Transport } from "../src/transport/transport.js";

/** Empty transport for contract checks — adapters will reject requests but we only test shape */
const noopTransport: Transport = {
  async request() { return new Response(null, { status: 500 }); },
  async stream() { throw new Error("unused"); },
  abort() {},
};

function makeProvider(name: string): ProviderConfig {
  return {
    name,
    baseUrl: "https://mock.test/v1",
    authentication: { type: "none" },
    adapter: "openai" as ProviderConfig["adapter"],
    models: [],
  };
}

/** Test that a class satisfies the AIProvider contract at runtime */
function assertAIProvider(adapter: AIProvider, name: string) {
  it(`${name} has id property`, () => {
    expect(typeof adapter.id).toBe("string");
    expect(adapter.id.length).toBeGreaterThan(0);
  });

  it(`${name} has stream() method`, () => {
    expect(typeof adapter.stream).toBe("function");
  });

  it(`${name} has complete() method`, () => {
    expect(typeof adapter.complete).toBe("function");
  });
}

describe("AIProvider contract — all adapters", () => {
  const adapters: Array<{ name: string; adapter: AIProvider }> = [
    { name: "OpenAIAdapter", adapter: new OpenAIAdapter({ provider: makeProvider("openai"), transport: noopTransport }) },
    { name: "AnthropicAdapter", adapter: new AnthropicAdapter({ provider: makeProvider("anthropic"), transport: noopTransport }) },
    { name: "GoogleGenAIAdapter", adapter: new GoogleGenAIAdapter({ provider: makeProvider("google-genai"), transport: noopTransport }) },
    { name: "AzureAdapter", adapter: new AzureAdapter({ provider: makeProvider("azure"), transport: noopTransport }) },
    { name: "GroqAdapter", adapter: new GroqAdapter({ provider: makeProvider("groq"), transport: noopTransport }) },
    { name: "OllamaAdapter", adapter: new OllamaAdapter({ provider: makeProvider("ollama"), transport: noopTransport }) },
  ];

  for (const { name, adapter } of adapters) {
    assertAIProvider(adapter, name);
  }

  it("OpenAIAdapter id is 'openai'", () => {
    expect(adapters[0].adapter.id).toBe("openai");
  });

  it("AnthropicAdapter id is 'anthropic'", () => {
    expect(adapters[1].adapter.id).toBe("anthropic");
  });

  it("GoogleGenAIAdapter id is 'google-genai'", () => {
    expect(adapters[2].adapter.id).toBe("google-genai");
  });

  it("AzureAdapter id is 'azure'", () => {
    expect(adapters[3].adapter.id).toBe("azure");
  });

  it("GroqAdapter id is 'groq'", () => {
    expect(adapters[4].adapter.id).toBe("groq");
  });

  it("OllamaAdapter id is 'ollama'", () => {
    expect(adapters[5].adapter.id).toBe("ollama");
  });

  it("all adapters can be typed as AIProvider", () => {
    const typed: AIProvider[] = adapters.map((a) => a.adapter);
    expect(typed).toHaveLength(6);
  });
});
