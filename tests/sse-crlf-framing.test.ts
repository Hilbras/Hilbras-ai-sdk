/**
 * @hilbras/sdk — SSE framing (D2)
 *
 * The adapters each hand-rolled the SSE loop and shared three defects:
 * `buffer.split("\n\n")` never matches a `\r\n\r\n` boundary, so a CRLF
 * upstream yielded no events at all while the buffer grew for the whole
 * response; `data:` without a space was rejected; and a payload split over
 * several `data:` lines kept only the last one.
 */

import { describe, expect, it } from "vitest";
import { splitSseFrames, parseSSEStream } from "../src/utils/sse.js";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import type { Transport } from "../src/transport/transport.js";

function byteStream(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

describe("splitSseFrames", () => {
  it("parses CRLF-framed events", () => {
    const { frames, buffer } = splitSseFrames("", 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');

    expect(buffer).toBe("");
    expect(frames.map((frame) => frame.data)).toEqual(['{"a":1}', '{"b":2}']);
    expect(frames.map((frame) => JSON.parse(frame.data))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("accepts data: with no space after the colon", () => {
    const { frames } = splitSseFrames("", 'data:{"a":1}\n\n');

    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data)).toEqual({ a: 1 });
  });

  it("joins a payload split over several data: lines", () => {
    const { frames } = splitSseFrames("", 'data: {"a":\ndata: 1}\n\n');

    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data)).toEqual({ a: 1 });
  });

  it("holds a partial frame until the terminator arrives", () => {
    const first = splitSseFrames("", 'data: {"a":');
    expect(first.frames).toEqual([]);
    expect(first.buffer).toBe('data: {"a":');

    const second = splitSseFrames(first.buffer, "1}\n\n");
    expect(second.frames).toHaveLength(1);
    expect(JSON.parse(second.frames[0].data)).toEqual({ a: 1 });
  });

  it("reports an event: field, or empty when absent", () => {
    const { frames } = splitSseFrames("", 'event: content_block_delta\ndata: {"x":1}\n\ndata: {"y":2}\n\n');

    expect(frames.map((frame) => frame.event)).toEqual(["content_block_delta", ""]);
  });
});

describe("parseSSEStream", () => {
  it("parses a CRLF stream", async () => {
    const events = [];
    for await (const event of parseSSEStream(byteStream('data: {"a":1}\r\n\r\n'))) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data)).toEqual({ a: 1 });
  });
});

describe("adapter over a CRLF stream", () => {
  it("yields the text instead of nothing", async () => {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const transport: Transport = {
      async request() {
        return new Response(byteStream(body), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async stream() {
        throw new Error("unused");
      },
      abort() {},
    };
    const adapter = new OpenAIAdapter({
      provider: {
        name: "test",
        baseUrl: "https://api.example.com/v1",
        authentication: { type: "none" },
        adapter: "openai",
        models: [],
      },
      transport,
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "test",
      messages: [{ role: "user", content: "go" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: "text", text: "hello" });
  });
});
