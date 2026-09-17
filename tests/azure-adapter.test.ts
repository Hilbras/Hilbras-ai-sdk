import { describe, it, expect } from "vitest";
import { AzureAdapter } from "../src/adapters/azure.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

const provider: ProviderConfig = {
  name: "azure",
  baseUrl: "https://myinstance.openai.azure.com",
  authentication: { type: "bearer", apiKey: "test-key" },
  adapter: "azure",
  models: [{ id: "gpt-4o", contextWindow: 128_000, maxOutputTokens: 16_384, capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
};

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockTransport(chunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200 }); },
    async stream() { return stream; },
    abort() {},
  };
}

function mockTransportComplete(body: Record<string, unknown>): Transport {
  return {
    async request() {
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

describe("AzureAdapter", () => {
  it("routes through /openai/deployments/{model}/chat/completions with api-version", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    await adapter.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }).next();
    expect(capturedUrl).toContain("/openai/deployments/gpt-4o/chat/completions");
    expect(capturedUrl).toContain("api-version=");
  });

  it("uses api-key header instead of Authorization", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    await adapter.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }).next();
    expect(capturedHeaders["api-key"]).toBe("test-key");
    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });

  it("streams text content from Azure SSE", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "Hello from Azure!" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    expect(texts).toBe("Hello from Azure!");
  });

  it("streams usage chunk from Azure", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const usage = chunks.filter((c) => c.type === "usage");
    expect(usage).toHaveLength(1);
    expect((usage[0] as { inputTokens: number }).inputTokens).toBe(10);
    expect((usage[0] as { outputTokens: number }).outputTokens).toBe(5);
  });

  it("complete() returns text from non-streaming response", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockTransportComplete({
      choices: [{ message: { content: "Hello from Azure complete!" } }],
    }) });
    const result = await adapter.complete({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("Hello from Azure complete!");
  });

  it("complete() returns empty string for no choices", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockTransportComplete({ choices: [] }) });
    const result = await adapter.complete({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("");
  });
});

// ─── Azure Multi-Modal ──────────────────────────────────────────────────────

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

describe("AzureAdapter multi-modal", () => {
  it("embed() routes through deployment embeddings endpoint", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.embed({ model: "text-embedding-3-small", input: "hello" });
    expect(capturedUrl).toContain("/openai/deployments/text-embedding-3-small/embeddings");
    expect(capturedUrl).toContain("api-version=");
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
  });

  it("embed() passes dimensions parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    await adapter.embed({ model: "text-embedding-3-small", input: "hello", dimensions: 256 });
    expect(capturedBody.dimensions).toBe(256);
  });

  it("embed() throws on API error", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.embed({ model: "text-embedding-3-small", input: "test" })).rejects.toThrow(ProviderRequestError);
  });

  it("generateImage() routes through deployment images endpoint", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(JSON.stringify({
          data: [{ url: "https://example.com/img.png", revised_prompt: "revised" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.generateImage({ model: "dall-e-3", prompt: "a cat" });
    expect(capturedUrl).toContain("/openai/deployments/dall-e-3/images/generations");
    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe("https://example.com/img.png");
    expect(result.images[0].revisedPrompt).toBe("revised");
  });

  it("generateImage() passes size and quality parameters", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    await adapter.generateImage({ model: "dall-e-3", prompt: "a cat", size: "1024x1024", quality: "hd" });
    expect(capturedBody.size).toBe("1024x1024");
    expect(capturedBody.quality).toBe("hd");
  });

  it("generateImage() throws on API error", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.generateImage({ model: "dall-e-3", prompt: "test" })).rejects.toThrow(ProviderRequestError);
  });

  it("generateSpeech() routes through deployment audio/speech endpoint", async () => {
    let capturedUrl = "";
    const audioBytes = new TextEncoder().encode("fake-audio").buffer;
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(audioBytes, { status: 200, headers: { "Content-Type": "audio/wav" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.generateSpeech({ model: "tts-1", input: "Hello", voice: "alloy" as any });
    expect(capturedUrl).toContain("/openai/deployments/tts-1/audio/speech");
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.format).toBe("wav");
  });

  it("generateSpeech() detects format from content-type", async () => {
    const audioBytes = new TextEncoder().encode("fake-audio").buffer;
    const transport: Transport = {
      async request() {
        return new Response(audioBytes, { status: 200, headers: { "Content-Type": "audio/ogg" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.generateSpeech({ model: "tts-1", input: "Hello", voice: "alloy" as any });
    expect(result.format).toBe("opus");
  });

  it("generateSpeech() throws on API error", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.generateSpeech({ model: "tts-1", input: "test", voice: "alloy" as any })).rejects.toThrow(ProviderRequestError);
  });

  it("transcribe() routes through deployment audio/transcriptions endpoint", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(JSON.stringify({ text: "Hello world" }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.transcribe({ model: "whisper-1", file: new Uint8Array([1, 2, 3]), responseFormat: "verbose_json" });
    expect(capturedUrl).toContain("/openai/deployments/whisper-1/audio/transcriptions");
    expect(result.text).toBe("Hello world");
  });

  it("transcribe() passes language parameter", async () => {
    let capturedBody: FormData | undefined;
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = init.body as FormData;
        return new Response(JSON.stringify({ text: "hola" }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    await adapter.transcribe({ model: "whisper-1", file: new Uint8Array([1, 2, 3]), language: "es" });
    expect(capturedBody?.get("language")).toBe("es");
  });

  it("transcribe() handles text response format", async () => {
    const transport: Transport = {
      async request() {
        return new Response("plain text transcript", { status: 200, headers: { "Content-Type": "text/plain" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport });
    const result = await adapter.transcribe({ model: "whisper-1", file: new Uint8Array([1, 2, 3]), responseFormat: "text" });
    expect(result.text).toBe("plain text transcript");
  });

  it("transcribe() throws on API error", async () => {
    const adapter = new AzureAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.transcribe({ model: "whisper-1", file: new Uint8Array([1, 2, 3]) })).rejects.toThrow(ProviderRequestError);
  });

  it("uses default deployment when model not specified", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AzureAdapter({ provider, transport, deployment: "my-embedding-deployment" });
    await adapter.embed({ model: "", input: "hello" });
    expect(capturedUrl).toContain("/openai/deployments/my-embedding-deployment/embeddings");
  });
});
