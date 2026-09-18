import { describe, it, expect } from "vitest";
import { GroqAdapter } from "../src/adapters/groq.js";
import { ProviderRequestError } from "../src/errors/index.js";
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

// ─── Groq Multi-Modal ──────────────────────────────────────────────────────

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

describe("GroqAdapter multi-modal", () => {
  it("transcribe() routes to audio/transcriptions endpoint", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(JSON.stringify({ text: "Hello from Groq" }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new GroqAdapter({ provider, transport });
    const result = await adapter.transcribe({ model: "whisper-large-v3", file: new Uint8Array([1, 2, 3]), responseFormat: "verbose_json" });
    expect(capturedUrl).toContain("/audio/transcriptions");
    expect(result.text).toBe("Hello from Groq");
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
    const adapter = new GroqAdapter({ provider, transport });
    await adapter.transcribe({ model: "whisper-large-v3", file: new Uint8Array([1, 2, 3]), language: "es" });
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
    const adapter = new GroqAdapter({ provider, transport });
    const result = await adapter.transcribe({ model: "whisper-large-v3", file: new Uint8Array([1, 2, 3]), responseFormat: "text" });
    expect(result.text).toBe("plain text transcript");
  });

  it("transcribe() throws on API error", async () => {
    const adapter = new GroqAdapter({ provider, transport: mockErrorTransport() });
    await expect(adapter.transcribe({ model: "whisper-large-v3", file: new Uint8Array([1, 2, 3]) })).rejects.toThrow(ProviderRequestError);
  });
});
