/**
 * @hilbras/sdk — Bedrock streamed tool calls (D3)
 *
 * Three defects: `contentBlockStop` emitted a tool call unconditionally, so
 * every plain text reply ended with a phantom call named ""; `toolUse.input`
 * (a partial-JSON *string* fragment) was re-stringified, producing doubly
 * quoted fragments that concatenated into invalid JSON; and the delta/stop
 * events synthesised `call_<index>` while the start event used the real
 * `toolUseId`, so one call had two ids.
 */

import { describe, it, expect } from "vitest";
import { BedrockAdapter } from "../src/adapters/bedrock.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { StreamChunk } from "../src/types/streams.js";

const provider: ProviderConfig = {
  name: "bedrock",
  baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
  authentication: { type: "bearer", apiKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  extraHeaders: {
    "x-aws-access-key-id": "AKIAIOSFODNN7EXAMPLE",
  },
  adapter: "bedrock",
  models: [],
};

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockTransport(chunks: string[]): Transport {
  return {
    async request() {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

async function collect(chunks: string[]): Promise<StreamChunk[]> {
  const adapter = new BedrockAdapter({ provider, transport: mockTransport(chunks) });
  const out: StreamChunk[] = [];
  for await (const chunk of adapter.stream({ model: "test", messages: [{ role: "user", content: "hi" }] })) {
    out.push(chunk);
  }
  return out;
}

describe("Bedrock streamed tool calls", () => {
  it("emits no tool call for a text-only stream", async () => {
    const chunks = await collect([
      sse({ $type: "contentBlockStart", contentBlockIndex: 0, start: {} }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { text: "Hello" } }),
      sse({ $type: "contentBlockStop", contentBlockIndex: 0 }),
      sse({ $type: "messageStop" }),
    ]);

    expect(chunks.filter((chunk) => chunk.type === "tool_call")).toEqual([]);
    expect(chunks).toContainEqual({ type: "text", text: "Hello" });
  });

  it("passes tool argument fragments through unquoted", async () => {
    const chunks = await collect([
      sse({ $type: "contentBlockStart", contentBlockIndex: 0, start: { toolUse: { toolUseId: "call_1", name: "get_weather" } } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { toolUse: { input: '{"city":' } } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { toolUse: { input: '"NYC"}' } } }),
      sse({ $type: "contentBlockStop", contentBlockIndex: 0 }),
      sse({ $type: "messageStop" }),
    ]);

    const deltas = chunks
      .filter((chunk) => chunk.type === "tool_call")
      .map((chunk) => (chunk as { argumentsDelta: string }).argumentsDelta);

    // Concatenating the streamed fragments must yield parseable JSON.
    expect(JSON.parse(deltas.join(""))).toEqual({ city: "NYC" });
  });

  it("uses one id for the whole tool call", async () => {
    const chunks = await collect([
      sse({ $type: "contentBlockStart", contentBlockIndex: 3, start: { toolUse: { toolUseId: "tooluse_abc", name: "get_weather" } } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 3, delta: { toolUse: { input: "{}" } } }),
      sse({ $type: "contentBlockStop", contentBlockIndex: 3 }),
      sse({ $type: "messageStop" }),
    ]);

    const calls = chunks.filter((chunk) => chunk.type === "tool_call") as Array<{ id: string; name: string }>;
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.id))).toEqual(new Set(["tooluse_abc"]));
    expect(calls.every((call) => call.name === "get_weather")).toBe(true);
  });
});
