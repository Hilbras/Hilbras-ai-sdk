import { describe, it, expect, vi, beforeEach } from "vitest";
import {
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

// ─── Stream Parser Unit Tests ───────────────────────────────────────────────

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
    const { parseUIStream } = await import("../src/stream-parser.js");

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
    const { parseUIStream } = await import("../src/stream-parser.js");
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
