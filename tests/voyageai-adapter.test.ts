import { describe, it, expect } from "vitest";
import { VoyageAIAdapter } from "../src/adapters/voyageai.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "voyageai",
  baseUrl: "https://api.voyageai.com",
  authentication: { type: "bearer", apiKey: "va_test_key" },
  adapter: "voyageai",
  models: [{ id: "voyage-3", contextWindow: 32_000, maxOutputTokens: 0, capabilities: { streaming: false, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: false, embeddings: true, imageGeneration: false, speech: false, transcription: false, reranking: false } }],
};

describe("VoyageAIAdapter", () => {
  it("embeds single text via OpenAI-compatible endpoint", async () => {
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
            data: [{ embedding: [0.1, 0.2, 0.3] }],
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VoyageAIAdapter({ provider, transport });
    const result = await adapter.embed({ model: "voyage-3", input: "Hello world" });

    expect(capturedUrl).toBe("https://api.voyageai.com/v1/embeddings");
    expect(capturedHeaders["Authorization"]).toBe("Bearer va_test_key");
    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("voyage-3");
    expect(body.input).toEqual(["Hello world"]);
    expect(body.input_type).toBe("document");
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(result.usage.inputTokens).toBe(5);
  });

  it("embeds multiple texts", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({
            data: [{ embedding: [0.1] }, { embedding: [0.2] }],
            usage: { prompt_tokens: 10, total_tokens: 10 },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VoyageAIAdapter({ provider, transport });
    const result = await adapter.embed({ model: "voyage-3", input: ["Hello", "World"] });

    const body = JSON.parse(capturedBody);
    expect(body.input).toEqual(["Hello", "World"]);
    expect(result.embeddings).toHaveLength(2);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: "Invalid key" }), { status: 401 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VoyageAIAdapter({ provider, transport });
    await expect(adapter.embed({ model: "voyage-3", input: "Hi" })).rejects.toThrow(ProviderRequestError);
  });

  it("throws on complete/stream calls", async () => {
    const adapter = new VoyageAIAdapter({ provider, transport: {} as Transport });
    await expect(adapter.complete({ model: "x", messages: [] })).rejects.toThrow("does not support chat");
  });
});
