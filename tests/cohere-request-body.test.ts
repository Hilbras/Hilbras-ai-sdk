/**
 * @hilbras/sdk — Cohere request body (D3)
 *
 * The adapter posts to `/v2/chat`, whose request takes one chronological
 * `messages` array (user / assistant / tool / system) and OpenAI-style tools.
 * The body it built was the v1 shape — a `chat_history` of USER/CHATBOT turns
 * plus a separate top-level `message` — so the last user turn went out twice,
 * `role: "tool"` results were dropped, and the v1 `parameter_definitions` tool
 * schema was sent to a v2 endpoint.
 */

import { describe, it, expect } from "vitest";
import { CohereAdapter } from "../src/adapters/cohere.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { Message } from "../src/types/messages.js";

const provider: ProviderConfig = {
  name: "cohere",
  baseUrl: "https://api.cohere.com",
  authentication: { type: "bearer", apiKey: "test-key" },
  adapter: "cohere",
  models: [],
};

const CHAT_REPLY = { message: { content: [{ type: "text", text: "ok" }] } };

function capturingTransport(sink: { url?: string; body?: Record<string, unknown> }, reply: unknown = CHAT_REPLY): Transport {
  return {
    async request(url, init) {
      sink.url = url;
      sink.body = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

async function bodyFor(messages: Message[], extra: Record<string, unknown> = {}) {
  const sink: { url?: string; body?: Record<string, unknown> } = {};
  const adapter = new CohereAdapter({ provider, transport: capturingTransport(sink) });
  await adapter.complete({ model: "command-r-plus", messages, ...extra });
  return sink;
}

describe("Cohere /v2/chat request body", () => {
  it("sends the conversation once, in a single messages array", async () => {
    const { url, body } = await bodyFor([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ]);

    expect(url).toBe("https://api.cohere.com/v2/chat");
    expect(body?.messages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ]);
    // The v1 fields must not come back.
    expect(body).not.toHaveProperty("message");
    expect(body).not.toHaveProperty("chat_history");
    expect(body).not.toHaveProperty("preamble");
  });

  it("keeps tool results in the history", async () => {
    const { body } = await bodyFor([
      { role: "user", content: "what is the weather?" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "weather", arguments: "{}" } }] },
      { role: "tool", content: '{"temp":21}', tool_call_id: "call_1" },
    ]);

    const messages = body?.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({ role: "tool", content: '{"temp":21}', tool_call_id: "call_1" });
  });

  it("sends tools in the v2 (OpenAI) shape", async () => {
    const { body } = await bodyFor([{ role: "user", content: "hi" }], {
      tools: [{
        type: "function",
        function: {
          name: "weather",
          description: "Get the weather",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      }],
    });

    const tools = body?.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "weather",
        description: "Get the weather",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    });
  });

  it("flattens multimodal content to text", async () => {
    const { body } = await bodyFor([
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image_url", image_url: { url: "https://example.test/a.png" } },
        ],
      },
    ]);

    const messages = body?.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toBe("describe this");
  });
});

describe("Cohere embed dimensions", () => {
  it("requests the width via output_dimension", async () => {
    const sink: { body?: Record<string, unknown> } = {};
    const adapter = new CohereAdapter({
      provider,
      transport: capturingTransport(sink, { embeddings: { float: [[1, 2]] }, meta: {} }),
    });

    await adapter.embed({ model: "embed-english-v3.0", input: "hi", dimensions: 256 });

    expect(sink.body?.output_dimension).toBe(256);
    expect(sink.body).not.toHaveProperty("embedding_types");
  });
});
