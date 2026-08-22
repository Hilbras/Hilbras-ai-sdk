import { describe, it, expect } from "vitest";
import { AzureAdapter } from "../src/adapters/azure.js";
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
