import { describe, it, expect } from "vitest";
import { CohereRerankAdapter } from "../src/adapters/cohere-rerank.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "cohere-rerank",
  baseUrl: "https://api.cohere.com",
  authentication: { type: "bearer", apiKey: "cr_test_key" },
  adapter: "cohere-rerank",
  models: [{ id: "rerank-english-v3.0", contextWindow: 512, maxOutputTokens: 0, capabilities: { streaming: false, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: false, embeddings: false, imageGeneration: false, speech: false, transcription: false, reranking: true } }],
};

describe("CohereRerankAdapter", () => {
  it("reranks documents", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            results: [
              { index: 1, relevance_score: 0.95 },
              { index: 0, relevance_score: 0.72 },
            ],
            meta: { billed_units: { input_tokens: 10, output_tokens: 0 } },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new CohereRerankAdapter({ provider, transport });
    const result = await adapter.rerank({
      query: "What is machine learning?",
      documents: ["ML is a subset of AI.", "The weather is nice."],
    });

    expect(capturedUrl).toBe("https://api.cohere.com/v1/rerank");
    expect(capturedHeaders["Authorization"]).toBe("Bearer cr_test_key");
    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("rerank-english-v3.0");
    expect(body.query).toBe("What is machine learning?");
    expect(body.documents).toHaveLength(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].index).toBe(1);
    expect(result.results[0].relevanceScore).toBe(0.95);
    expect(result.usage!.inputTokens).toBe(10);
  });

  it("uses custom model", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ results: [], meta: { billed_units: {} } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new CohereRerankAdapter({ provider, transport });
    await adapter.rerank({
      query: "test",
      documents: ["doc1"],
      model: "rerank-multilingual-v3.0",
    });

    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("rerank-multilingual-v3.0");
  });

  it("passes topN parameter", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ results: [] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new CohereRerankAdapter({ provider, transport });
    await adapter.rerank({
      query: "test",
      documents: ["a", "b", "c", "d", "e"],
      topN: 3,
    });

    const body = JSON.parse(capturedBody);
    expect(body.top_n).toBe(3);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new CohereRerankAdapter({ provider, transport });
    await expect(adapter.rerank({ query: "test", documents: ["a"] })).rejects.toThrow(ProviderRequestError);
  });

  it("throws on embed/complete/stream calls", async () => {
    const adapter = new CohereRerankAdapter({ provider, transport: {} as Transport });
    await expect(adapter.embed({ model: "x", input: "x" })).rejects.toThrow("does not support embeddings");
    await expect(adapter.complete({ model: "x", messages: [] })).rejects.toThrow("does not support chat");
  });
});
