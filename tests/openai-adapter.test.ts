/**
 * @hilbras/sdk — OpenAI adapter streaming tests
 *
 * Covers text-embedded tool calls: models trained with Qwen/Hermes-style
 * chat templates emit tool calls as <tool_call>...</tool_call> markup in
 * plain content when the provider lacks native function-calling deltas.
 * The adapter must convert that markup into structured tool_call chunks
 * instead of streaming it to the user as raw text.
 */

import { describe, expect, it } from "vitest";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk, ToolCallChunk } from "../src/types/streams.js";

/** Build a Transport whose single POST returns the given SSE wire chunks. */
function mockTransport(wireChunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of wireChunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  const response = new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  return {
    async request() {
      return response;
    },
    async stream() {
      return stream;
    },
    abort() {},
  };
}

const provider: ProviderConfig = {
  name: "mock",
  baseUrl: "https://mock.internal/v1",
  authentication: { type: "none" },
  adapter: "openai",
  models: [],
};

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentDelta(text: string, finishReason?: string): string {
  const delta: Record<string, unknown> = finishReason == null ? { content: text } : {};
  return sse({ choices: [{ delta, ...(finishReason != null ? { finish_reason: finishReason } : {}) }] });
}

/** Drive the adapter over the given wire chunks and collect everything. */
async function collect(adapter: OpenAIAdapter, wireChunks: string[]): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of adapter.stream({ model: "test-model", messages: [{ role: "user", content: "hi" }] })) {
    chunks.push(chunk);
  }
  void wireChunks;
  return chunks;
}

function toolCallsOf(chunks: StreamChunk[]): ToolCallChunk[] {
  return chunks.filter((c): c is ToolCallChunk => c.type === "tool_call");
}

function textOf(chunks: StreamChunk[]): string {
  return chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
}

describe("OpenAIAdapter — text-embedded tool calls", () => {
  it("parses XML-style <tool_call><function=...> markup split across deltas into a structured tool call", async () => {
    // The exact failure seen in production: deltas split mid-tag and mid-block
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta("I'll create the file now.\n<tool_c"),
      contentDelta("all>\n<function=write_file>\n<parameter=path>/home/gin/test.txt</parameter>\n"),
      contentDelta("<parameter=content>Hello! This is a test file created by Hilbras.</parameter>\n</function>\n</tool_call>"),
      contentDelta("", "stop"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const calls = toolCallsOf(chunks);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write_file");
    expect(calls[0].done).toBe(true);
    expect(JSON.parse(calls[0].argumentsDelta!)).toEqual({
      path: "/home/gin/test.txt",
      content: "Hello! This is a test file created by Hilbras.",
    });

    // No raw markup may leak into the text channel
    const text = textOf(chunks);
    expect(text).not.toContain("<tool_call>");
    expect(text).not.toContain("<function=");
    expect(text).toBe("I'll create the file now.\n");
  });

  it("parses Qwen/Hermes JSON-style <tool_call>{\"name\":...} markup", async () => {
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta('<tool_call>\n{"name": "write", "arguments": {"path": "a.txt", "content": "hi"}}\n</tool_call>'),
      contentDelta("", "stop"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const calls = toolCallsOf(chunks);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write");
    expect(JSON.parse(calls[0].argumentsDelta!)).toEqual({ path: "a.txt", content: "hi" });
    expect(textOf(chunks)).toBe("");
  });

  it("supports multiple tool calls in one message", async () => {
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta('<tool_call>\n{"name": "read", "arguments": {"path": "x"}}\n</tool_call>\n'),
      contentDelta('<tool_call>\n{"name": "read", "arguments": {"path": "y"}}\n</tool_call>'),
      contentDelta("", "stop"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const calls = toolCallsOf(chunks);

    expect(calls.map((c) => c.name)).toEqual(["read", "read"]);
    expect(calls.map((c) => JSON.parse(c.argumentsDelta!).path)).toEqual(["x", "y"]);
  });

  it("passes plain text through untouched (no false positives)", async () => {
    const plain = "Compare: if (a < b) { done() }\nAnd XML-ish: <tools> are <not> tool calls.";
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta(plain),
      contentDelta("", "stop"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    expect(toolCallsOf(chunks)).toHaveLength(0);
    expect(textOf(chunks)).toBe(plain);
  });

  it("emits an unparseable <tool_call> block as text rather than swallowing it", async () => {
    const garbage = "<tool_call>\nthis is not a tool call\n</tool_call>";
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta(garbage),
      contentDelta("", "stop"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    expect(toolCallsOf(chunks)).toHaveLength(0);
    expect(textOf(chunks)).toContain("this is not a tool call");
  });

  it("still handles native tool_calls deltas signalled by finish_reason=tool_calls", async () => {
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: "{\"path\":" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"a.txt\",\"content\":\"hi\"}" } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const calls = toolCallsOf(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write");
    expect(JSON.parse(calls[0].argumentsDelta!)).toEqual({ path: "a.txt", content: "hi" });
  });

  it("flushes native tool_calls deltas even when finish_reason is stop", async () => {
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{\"path\":\"x\"}" } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const calls = toolCallsOf(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("read");
    expect(calls[0].done).toBe(true);
  });

  it("yields a finish chunk with the provider's finish_reason", async () => {
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta("partial answer that got cut"),
      contentDelta("", "length"),
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const finish = chunks.find((c) => c.type === "finish");
    expect(finish).toBeDefined();
    expect((finish as { reason: string }).reason).toBe("length");
  });

  it("still yields the finish chunk when the final SSE chunk has no delta field", async () => {
    // Several providers end with {"choices":[{"finish_reason":"length"}]} — no delta
    const adapter = new OpenAIAdapter({ provider, transport: mockTransport([
      contentDelta("partial"),
      `data: ${JSON.stringify({ choices: [{ finish_reason: "length" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]) });

    const chunks = await collect(adapter, []);
    const finish = chunks.find((c) => c.type === "finish");
    expect(finish).toBeDefined();
    expect((finish as { reason: string }).reason).toBe("length");
  });

  it("retries without max_tokens when the provider rejects it as too large", async () => {
    const encoder = new TextEncoder();
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    const goodStream = () => {
      const text = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }, { finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      const s = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); },
      });
      return new Response(s, { status: 200 });
    };
    const transport: Transport = {
      async request(_url, init) {
        call++;
        bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
        if (call === 1) {
          return new Response(
            JSON.stringify({ error: { message: "max_tokens must be at most 8192, got 131072" } }),
            { status: 400 },
          );
        }
        return goodStream();
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const adapter = new OpenAIAdapter({ provider, transport });
    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 131072 })) {
      chunks.push(chunk);
    }
    expect(call).toBe(2);
    expect("max_tokens" in bodies[0]).toBe(true);
    expect("max_tokens" in bodies[1]).toBe(false);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
  });

  it("omits max_tokens when none is provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const response = new Response(stream, { status: 200 });
    const transport: Transport = {
      async request(_url, init) {
        capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
        return response;
      },
      async stream() { return stream; },
      abort() {},
    };
    const adapter = new OpenAIAdapter({ provider, transport });
    for await (const _chunk of adapter.stream({ model: "m", messages: [{ role: "user", content: "hi" }] })) {
      void _chunk;
    }
    expect("max_tokens" in capturedBody).toBe(false);
  });
});
