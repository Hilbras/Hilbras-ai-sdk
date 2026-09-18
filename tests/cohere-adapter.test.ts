import { describe, it, expect } from "vitest";
import { CohereAdapter } from "../src/adapters/cohere.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "cohere",
  baseUrl: "https://api.cohere.com",
  authentication: { type: "bearer", apiKey: "test-key" },
  adapter: "cohere",
  models: [{ id: "command-r-plus", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
};

function mockJsonTransport(body: Record<string, unknown>): Transport {
  return {
    async request() {
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

function mockErrorTransport(status = 500): Transport {
  return {
    async request() {
      return new Response("error", { status, statusText: "Internal Server Error" });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

// ─── Cohere Multi-Modal: Embeddings ────────────────────────────────────────

describe("CohereAdapter multi-modal", () => {
  it("embed() returns embeddings", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockJsonTransport({
      id: "embed-english-v3.0",
      embeddings: { float: [[0.1, 0.2, 0.3]] },
      meta: { billed_units: { input_tokens: 5 } },
    }) });

    const result = await adapter.embed({ model: "embed-english-v3.0", input: "hello world" });
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage?.inputTokens).toBe(5);
  });

  it("embed() handles array input", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockJsonTransport({
      id: "embed-english-v3.0",
      embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] },
      meta: { billed_units: { input_tokens: 10 } },
    }) });

    const result = await adapter.embed({ model: "embed-english-v3.0", input: ["hello", "world"] });
    expect(result.embeddings).toHaveLength(2);
  });

  it("embed() returns empty array when no embeddings", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockJsonTransport({
      id: "embed-english-v3.0",
      embeddings: {},
      meta: {},
    }) });

    const result = await adapter.embed({ model: "embed-english-v3.0", input: "test" });
    expect(result.embeddings).toEqual([]);
  });

  it("embed() throws on API error", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.embed({ model: "embed-english-v3.0", input: "test" })).rejects.toThrow(ProviderRequestError);
  });

  it("rerank() returns ranked results", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockJsonTransport({
      results: [
        { index: 1, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.80 },
      ],
      meta: { billed_units: { input_tokens: 20 } },
    }) });

    const result = await adapter.rerank({
      model: "rerank-english-v3.0",
      query: "What is AI?",
      documents: ["AI is artificial intelligence.", "The weather is nice."],
      topN: 2,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].relevanceScore).toBe(0.95);
    expect(result.results[0].document).toBe("The weather is nice.");
    expect(result.usage?.inputTokens).toBe(20);
  });

  it("rerank() throws on API error", async () => {
    const adapter = new CohereAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.rerank({
      model: "rerank-english-v3.0",
      query: "test",
      documents: ["doc1"],
    })).rejects.toThrow(ProviderRequestError);
  });
});
