import { describe, it, expect } from "vitest";
import { GroqAdapter } from "../src/adapters/groq.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

const provider: ProviderConfig = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  authentication: { type: "bearer", apiKey: "gsk_test" },
  adapter: "groq",
  models: [{ id: "llama-3.3-70b-versatile", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
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

describe("GroqAdapter", () => {
  it("streams text content from Groq SSE", async () => {
    const adapter = new GroqAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "Fast inference!" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    expect(texts).toBe("Fast inference!");
  });

  it("streams usage chunk", async () => {
    const adapter = new GroqAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const usage = chunks.filter((c) => c.type === "usage");
    expect(usage).toHaveLength(1);
    expect((usage[0] as { inputTokens: number }).inputTokens).toBe(5);
  });

  it("sends Bearer auth header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new GroqAdapter({ provider, transport });
    await adapter.stream({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] }).next();
    expect(capturedHeaders["Authorization"]).toBe("Bearer gsk_test");
  });

  it("complete() returns text from non-streaming response", async () => {
    const adapter = new GroqAdapter({ provider, transport: mockTransportComplete({
      choices: [{ message: { content: "Groq complete response" } }],
    }) });
    const result = await adapter.complete({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("Groq complete response");
  });

  it("complete() returns empty string for no choices", async () => {
    const adapter = new GroqAdapter({ provider, transport: mockTransportComplete({ choices: [] }) });
    const result = await adapter.complete({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("");
  });

  it("passes reasoning tags through as reasoning chunks", async () => {
    // Thinking block split across deltas (realistic streaming scenario)
    const adapter = new GroqAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { content: "<thinking>\n" } }] }),
      sse({ choices: [{ delta: { content: "Let me think...\n" } }] }),
      sse({ choices: [{ delta: { content: "</thinking>\n" } }] }),
      sse({ choices: [{ delta: { content: "The answer is 42." } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const reasoning = chunks.filter((c) => c.type === "reasoning");
    expect(reasoning.length).toBeGreaterThan(0);
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    expect(texts).toBe("The answer is 42.");
  });
});
