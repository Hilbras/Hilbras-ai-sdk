import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "../src/adapters/anthropic.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

const provider: ProviderConfig = {
  name: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  authentication: { type: "bearer", apiKey: "test-key" },
  adapter: "anthropic",
  models: [],
};

function mockTransport(eventStrings: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of eventStrings) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200 }); },
    async stream() { return stream; },
    abort() {},
  };
}

function sse(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("AnthropicAdapter", () => {
  it("parses text content_block_delta into TextChunk", async () => {
    const adapter = new AnthropicAdapter({ provider, transport: mockTransport([
      sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello!" } }),
      sse("content_block_stop", { index: 0 }),
      sse("message_delta", { usage: { input_tokens: 10, output_tokens: 5 } }),
      sse("message_stop", {}),
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "claude-3", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(c);
    }
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text);
    expect(texts.join("")).toBe("Hello!");
  });

  it("parses tool_use into ToolCallChunk", async () => {
    const adapter = new AnthropicAdapter({ provider, transport: mockTransport([
      sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "call_1", name: "read" } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"/etc/hosts"}' } }),
      sse("content_block_stop", { index: 0 }),
      sse("message_stop", {}),
    ]) });

    const chunks: StreamChunk[] = [];
    for await (const c of adapter.stream({ model: "claude-3", messages: [{ role: "user", content: "read hosts" }] })) {
      chunks.push(c);
    }
    const tc = chunks.filter((c) => c.type === "tool_call").map((c) => c as { name: string; argumentsDelta: string; done: boolean });
    expect(tc).toHaveLength(1);
    expect(tc[0].name).toBe("read");
    expect(tc[0].done).toBe(true);
  });

  it("includes system prompt in body.system, not as a message", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init.body as string);
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("event: message_stop\ndata: {}\n\n")); c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AnthropicAdapter({ provider, transport });
    for await (const _ of adapter.stream({ model: "claude-3", messages: [{ role: "system", content: "Be helpful" }, { role: "user", content: "hi" }] })) { void _; }
    expect(capturedBody.system).toBe("Be helpful");
    expect((capturedBody.messages as any[]).every((m: any) => m.role !== "system")).toBe(true);
  });

  it("converts tools to Anthropic input_schema format", async () => {
    let capturedBody: Record<string, unknown> = {};
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init.body as string);
        return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new AnthropicAdapter({ provider, transport });
    await adapter.stream({
      model: "claude-3",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", description: "Read file", parameters: { type: "object", properties: {}, required: [] } } }],
    }).next();
    const tools = capturedBody.tools as any[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("read");
    expect(tools[0].input_schema).toBeDefined();
  });
});
