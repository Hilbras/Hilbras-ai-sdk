import { describe, it, expect } from "vitest";
import { parseSSEStream, parseJsonEventStream, collectSSEEvents, findSSEEvent } from "../src/utils/sse.js";

function createStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("parseSSEStream", () => {
  it("parses a simple SSE event", async () => {
    const stream = createStream("data: hello world\n\n");
    const events = await collectSSEEvents(stream);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "message", data: "hello world" });
  });

  it("parses multiple events", async () => {
    const stream = createStream("data: first\n\ndata: second\n\n");
    const events = await collectSSEEvents(stream);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("first");
    expect(events[1].data).toBe("second");
  });

  it("parses event type", async () => {
    const stream = createStream("event: custom\ndata: test\n\n");
    const events = await collectSSEEvents(stream);
    expect(events[0].event).toBe("custom");
  });

  it("parses multi-line data", async () => {
    const stream = createStream("data: line1\ndata: line2\ndata: line3\n\n");
    const events = await collectSSEEvents(stream);
    expect(events[0].data).toBe("line1\nline2\nline3");
  });

  it("parses id field", async () => {
    const stream = createStream("id: 123\ndata: test\n\n");
    const events = await collectSSEEvents(stream);
    expect(events[0].id).toBe("123");
  });

  it("parses retry field", async () => {
    const stream = createStream("retry: 5000\ndata: test\n\n");
    const events = await collectSSEEvents(stream);
    expect(events[0].retry).toBe(5000);
  });

  it("skips empty events", async () => {
    const stream = createStream("\n\ndata: hello\n\n\n");
    const events = await collectSSEEvents(stream);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });
});

describe("parseJsonEventStream", () => {
  it("parses JSON data events", async () => {
    const stream = createStream('data: {"type":"text","text":"hello"}\n\n');
    const events: Array<{ event: string; data: unknown }> = [];
    for await (const event of parseJsonEventStream(stream)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ type: "text", text: "hello" });
  });

  it("skips non-JSON events", async () => {
    const stream = createStream("data: not json\n\ndata: 42\n\n");
    const events: Array<{ event: string; data: unknown }> = [];
    for await (const event of parseJsonEventStream(stream)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe(42);
  });
});

describe("findSSEEvent", () => {
  it("finds the first event of a given type", async () => {
    const stream = createStream("event: skip\ndata: 1\n\nevent: target\ndata: 2\n\n");
    const event = await findSSEEvent(stream, "target");
    expect(event).not.toBeNull();
    expect(event!.data).toBe("2");
  });

  it("returns null if event not found", async () => {
    const stream = createStream("event: other\ndata: test\n\n");
    const event = await findSSEEvent(stream, "target");
    expect(event).toBeNull();
  });
});
