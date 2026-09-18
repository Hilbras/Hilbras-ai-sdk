import { describe, it, expect } from "vitest";
import type { UIMessage, UIProtocolMessage } from "@hilbras/sdk";

// ─── Stream Parser Tests ────────────────────────────────────────────────────

describe("Svelte parseUIStream", () => {
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
      { type: "text_delta", text: "Guten" },
      { type: "text_delta", text: " Tag" },
      { type: "message_end" },
    ];

    const stream = createStream(encodeSSE(messages));
    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ type: "message_start", messageId: "1" });
    expect(results[1]).toEqual({ type: "text_delta", text: "Guten" });
    expect(results[2]).toEqual({ type: "text_delta", text: " Tag" });
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

// ─── useObject Incremental Parsing ──────────────────────────────────────────

describe("Svelte useObject incremental parsing", () => {
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
    const { parseUIStream } = await import("../src/stream-parser.js");

    const messages: UIProtocolMessage[] = [
      { type: "tool_call_start", id: "c1", name: "extract_info" },
      { type: "tool_call_delta", id: "c1", args: '{"name":' },
      { type: "tool_call_delta", id: "c1", args: ' "Hans",' },
      { type: "tool_call_delta", id: "c1", args: ' "country":' },
      { type: "tool_call_delta", id: "c1", args: ' "DE"}' },
      { type: "tool_call_end", id: "c1" },
    ];

    const stream = createStream(encodeSSE(messages));
    const results: UIProtocolMessage[] = [];
    for await (const msg of parseUIStream(stream)) {
      results.push(msg);
    }

    let args = "";
    let obj: Record<string, unknown> = {};
    for (const msg of results) {
      if (msg.type === "tool_call_delta") {
        args += msg.args;
        try { obj = JSON.parse(args); } catch {}
      }
    }
    expect(obj).toEqual({ name: "Hans", country: "DE" });
  });
});

// ─── Hook Factory Exports ───────────────────────────────────────────────────

describe("Svelte hook exports", () => {
  it("useChat is exported and is a function", async () => {
    const mod = await import("../src/use-chat.js");
    expect(typeof mod.useChat).toBe("function");
  });

  it("useCompletion is exported and is a function", async () => {
    const mod = await import("../src/use-completion.js");
    expect(typeof mod.useCompletion).toBe("function");
  });

  it("useObject is exported and is a function", async () => {
    const mod = await import("../src/use-object.js");
    expect(typeof mod.useObject).toBe("function");
  });

  it("useChat returns subscribe function", async () => {
    const { useChat } = await import("../src/use-chat.js");
    const chat = useChat({ api: "http://localhost/api" });
    expect(typeof chat.subscribe).toBe("function");
    expect(typeof chat.handleSubmit).toBe("function");
    expect(typeof chat.stop).toBe("function");
    expect(typeof chat.clear).toBe("function");
  });

  it("useChat getter/setter pattern works", async () => {
    const { useChat } = await import("../src/use-chat.js");
    const chat = useChat({ api: "http://localhost/api" });
    expect(chat.messages).toEqual([]);
    expect(chat.isLoading).toBe(false);
    expect(chat.error).toBeNull();

    chat.input = "hello";
    expect(chat.input).toBe("hello");
  });

  it("useCompletion getter/setter pattern works", async () => {
    const { useCompletion } = await import("../src/use-completion.js");
    const comp = useCompletion({ api: "http://localhost/api" });
    expect(comp.completion).toBe("");
    expect(comp.isLoading).toBe(false);

    comp.input = "test prompt";
    expect(comp.input).toBe("test prompt");
  });

  it("useObject getter pattern works", async () => {
    const { useObject } = await import("../src/use-object.js");
    const obj = useObject<{ name: string }>({
      api: "http://localhost/api",
      schemaName: "person",
    });
    expect(obj.object).toBeNull();
    expect(obj.isLoading).toBe(false);
  });
});
