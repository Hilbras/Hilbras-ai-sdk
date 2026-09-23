import { describe, it, expect } from "vitest";
import { DeepgramAdapter } from "../src/adapters/deepgram.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "deepgram",
  baseUrl: "https://api.deepgram.com",
  authentication: { type: "bearer", apiKey: "dg_test_key" },
  adapter: "deepgram",
  models: [{ id: "nova-2", contextWindow: 0, maxOutputTokens: 0, capabilities: { streaming: false, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: false, embeddings: false, imageGeneration: false, speech: false, transcription: true, reranking: false } }],
};

describe("DeepgramAdapter", () => {
  it("transcribes audio via multipart upload", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            results: {
              language: "en",
              channels: [{
                alternatives: [{ transcript: "Hello world" }],
                paragraphs: {
                  paragraphs: [{
                    sentences: [
                      { start: 0, end: 500, text: "Hello world" },
                    ],
                  }],
                },
              }],
            },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new DeepgramAdapter({ provider, transport });
    const file = new File(["audio data"], "test.wav", { type: "audio/wav" });
    const result = await adapter.transcribe({ model: "nova-2", file });

    expect(capturedUrl).toContain("/v1/listen?");
    expect(capturedUrl).toContain("model=nova-2");
    expect(capturedUrl).toContain("punctuate=true");
    expect(capturedUrl).not.toContain("+punctuate");
    expect(capturedHeaders["Authorization"]).toBe("Token dg_test_key");
    expect(result.text).toBe("Hello world");
    expect(result.language).toBe("en");
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0].text).toBe("Hello world");
  });

  it("passes language parameter", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "Bonjour" }] }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new DeepgramAdapter({ provider, transport });
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });
    await adapter.transcribe({ model: "nova-2", file, language: "fr" });

    expect(capturedUrl).toContain("language=fr");
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new DeepgramAdapter({ provider, transport });
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });
    await expect(adapter.transcribe({ model: "nova-2", file })).rejects.toThrow(ProviderRequestError);
  });

  it("throws on embed/complete/stream calls", async () => {
    const adapter = new DeepgramAdapter({ provider, transport: {} as Transport });
    await expect(adapter.embed({ model: "x", input: "x" })).rejects.toThrow("does not support embeddings");
    await expect(adapter.complete({ model: "x", messages: [] })).rejects.toThrow("does not support chat");
  });
});
