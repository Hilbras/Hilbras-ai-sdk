import { describe, it, expect } from "vitest";
import type {
  UIMessage,
  UIProtocolMessage,
} from "@hilbras/sdk";

// ─── Stream Parser Tests ────────────────────────────────────────────────────

// We test the protocol types and the parseUIStream logic directly
// since @testing-library/react needs a full React DOM environment

describe("UIMessage Protocol", () => {
  it("UIMessage has correct shape", () => {
    const msg: UIMessage = {
      id: "msg_1",
      role: "user",
      content: "Hello",
      createdAt: Date.now(),
    };
    expect(msg.id).toBe("msg_1");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello");
  });

  it("UIMessage supports assistant role with usage", () => {
    const msg: UIMessage = {
      id: "msg_2",
      role: "assistant",
      content: "Hi there!",
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    expect(msg.role).toBe("assistant");
    expect(msg.usage?.totalTokens).toBe(15);
  });

  it("UIProtocolMessage union covers all types", () => {
    const messages: UIProtocolMessage[] = [
      { type: "message_start", messageId: "1" },
      { type: "text_delta", text: "Hello" },
      { type: "reasoning_delta", text: "thinking..." },
      { type: "tool_call_start", id: "call_1", name: "get_weather" },
      { type: "tool_call_delta", id: "call_1", args: '{"location":' },
      { type: "tool_call_end", id: "call_1" },
      { type: "message_end", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: "error", error: "something went wrong" },
    ];
    expect(messages).toHaveLength(8);
  });
});

describe("parseUIStream", () => {
  // We can't easily create a ReadableStream in Node without the web API,
  // so we test the SSE parsing logic indirectly via a helper

  function encodeSSE(messages: UIProtocolMessage[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts = messages.map((m) => `data: ${JSON.stringify(m)}\n\n`);
    return encoder.encode(parts.join("") + "data: [DONE]\n\n");
  }

  function createStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  it("parses SSE stream into protocol messages", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "message_start", messageId: "1" },
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "message_end" },
    ];

    const stream = createStream(encodeSSE(messages));
    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ type: "message_start", messageId: "1" });
    expect(results[1]).toEqual({ type: "text_delta", text: "Hello" });
    expect(results[2]).toEqual({ type: "text_delta", text: " world" });
    expect(results[3]).toEqual({ type: "message_end" });
  });

  it("skips malformed JSON lines", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");
    const encoder = new TextEncoder();
    const data = encoder.encode(
      'data: {"type":"text_delta","text":"ok"}\n\ndata: not-json\n\ndata: {"type":"message_end"}\n\ndata: [DONE]\n\n'
    );
    const stream = createStream(data);

    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("text_delta");
    expect(results[1].type).toBe("message_end");
  });
});

// ─── useObject Protocol Tests ───────────────────────────────────────────────

describe("useObject", () => {
  function encodeSSE(messages: UIProtocolMessage[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts = messages.map((m) => `data: ${JSON.stringify(m)}\n\n`);
    return encoder.encode(parts.join("") + "data: [DONE]\n\n");
  }

  function createStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  it("incrementally parses tool_call deltas into a partial object", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "tool_call_start", id: "c1", name: "extract_info" },
      { type: "tool_call_delta", id: "c1", args: '{"name":' },
      { type: "tool_call_delta", id: "c1", args: ' "John",' },
      { type: "tool_call_delta", id: "c1", args: ' "age": 30}' },
      { type: "tool_call_end", id: "c1" },
    ];

    const stream = createStream(encodeSSE(messages));
    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    expect(results).toHaveLength(5);
    expect(results[0].type).toBe("tool_call_start");
    expect(results[1].type).toBe("tool_call_delta");
    expect(results[4].type).toBe("tool_call_end");

    // Simulate what useObject does: accumulate args
    let args = "";
    let obj: Record<string, unknown> = {};
    for (const msg of results) {
      if (msg.type === "tool_call_delta") {
        args += msg.args;
        try { obj = JSON.parse(args); } catch {}
      }
    }
    expect(obj).toEqual({ name: "John", age: 30 });
  });

  it("handles multiple tool calls for different schemas", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "tool_call_start", id: "c1", name: "schema_a" },
      { type: "tool_call_delta", id: "c1", args: '{"a":1}' },
      { type: "tool_call_end", id: "c1" },
      { type: "tool_call_start", id: "c2", name: "schema_b" },
      { type: "tool_call_delta", id: "c2", args: '{"b":2}' },
      { type: "tool_call_end", id: "c2" },
    ];

    const stream = createStream(encodeSSE(messages));
    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    const toolStarts = results.filter((m) => m.type === "tool_call_start");
    expect(toolStarts).toHaveLength(2);
  });
});

// ─── Integration Test: SSE ↔ Hook Logic ────────────────────────────────────

describe("SSE ↔ Hook integration", () => {
  function encodeSSE(messages: UIProtocolMessage[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts = messages.map((m) => `data: ${JSON.stringify(m)}\n\n`);
    return encoder.encode(parts.join("") + "data: [DONE]\n\n");
  }

  function createStream(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  it("simulates useChat flow: user message → assistant stream", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", text: "I" },
      { type: "text_delta", text: "'ll" },
      { type: "text_delta", text: " help" },
      { type: "text_delta", text: " you." },
      { type: "message_end", usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 } },
    ];

    const stream = createStream(encodeSSE(messages));
    let content = "";
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    for await (const msg of parseUIStream(stream)) {
      if (msg.type === "text_delta") content += msg.text;
      if (msg.type === "message_end") usage = msg.usage;
    }

    expect(content).toBe("I'll help you.");
    expect(usage?.totalTokens).toBe(9);
  });

  it("simulates useObject flow: structured extraction", async () => {
    const { parseUIStream } = await import("../src/frameworks/react/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "tool_call_start", id: "tc1", name: "extract_person" },
      { type: "tool_call_delta", id: "tc1", args: '{"firstName":' },
      { type: "tool_call_delta", id: "tc1", args: ' "Alice",' },
      { type: "tool_call_delta", id: "tc1", args: ' "lastName":' },
      { type: "tool_call_delta", id: "tc1", args: ' "Smith",' },
      { type: "tool_call_delta", id: "tc1", args: ' "email":' },
      { type: "tool_call_delta", id: "tc1", args: ' "alice@example.com"}' },
      { type: "tool_call_end", id: "tc1" },
    ];

    const stream = createStream(encodeSSE(messages));
    let args = "";
    let finalObj: Record<string, unknown> = {};

    for await (const msg of parseUIStream(stream)) {
      if (msg.type === "tool_call_delta") {
        args += msg.args;
        try { finalObj = JSON.parse(args); } catch {}
      }
    }

    expect(finalObj).toEqual({
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
    });
  });
});
