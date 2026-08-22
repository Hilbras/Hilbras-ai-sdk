import { describe, it, expect } from "vitest";
import { OllamaAdapter } from "../src/adapters/ollama.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

const provider: ProviderConfig = {
  name: "ollama",
  baseUrl: "http://localhost:11434/v1",
  authentication: { type: "none" },
  adapter: "ollama",
  models: [{ id: "llama3.1", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
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

describe("OllamaAdapter", () => {
  it("streams text content from Ollama SSE", async () => {
    const adapter = new OllamaAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "Local model says hi!" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "llama3.1", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    expect(texts).toBe("Local model says hi!");
  });

  it("sends no auth header for local server", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new OllamaAdapter({ provider, transport });
    await adapter.stream({ model: "llama3.1", messages: [{ role: "user", content: "hi" }] }).next();
    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });

  it("sets options.num_predict for maxTokens", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new OllamaAdapter({ provider, transport });
    await adapter.stream({ model: "llama3.1", messages: [{ role: "user", content: "hi" }], maxTokens: 2048 }).next();
    expect((capturedBody.options as Record<string, unknown>)?.num_predict).toBe(2048);
  });

  it("complete() returns text from non-streaming response", async () => {
    const adapter = new OllamaAdapter({ provider, transport: mockTransportComplete({
      choices: [{ message: { content: "Ollama complete" } }],
    }) });
    const result = await adapter.complete({ model: "llama3.1", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("Ollama complete");
  });

  it("complete() returns empty string for no choices", async () => {
    const adapter = new OllamaAdapter({ provider, transport: mockTransportComplete({ choices: [] }) });
    const result = await adapter.complete({ model: "llama3.1", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("");
  });
});
