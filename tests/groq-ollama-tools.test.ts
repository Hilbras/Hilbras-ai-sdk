/**
 * @hilbras/sdk — Groq and Ollama tool calling (D3)
 *
 * Both adapters advertised native tool calling (the catalog marks tools: true)
 * and both stream loops already had a `tool_calls` delta branch, but neither
 * body builder ever sent `tools` — so the field never reached the model and the
 * branch was unreachable.
 */

import { describe, expect, it } from "vitest";
import { GroqAdapter } from "../src/adapters/groq.js";
import { OllamaAdapter } from "../src/adapters/ollama.js";
import type { Transport } from "../src/transport/transport.js";
import type { AdapterName, ProviderConfig } from "../src/types/providers.js";
import type { Tool } from "../src/types/tools.js";

const TOOL: Tool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

const provider = (name: AdapterName, baseUrl: string): ProviderConfig => ({
  name,
  baseUrl,
  authentication: { type: "none" },
  adapter: name,
  models: [],
});

function capturingTransport(
  sink: { body?: Record<string, unknown> },
  body: ReadableStream<Uint8Array> | string,
): Transport {
  return {
    async request(_url, init) {
      sink.body = JSON.parse(init.body as string) as Record<string, unknown>;
      const resBody = typeof body === "string" ? body : body;
      return new Response(resBody, {
        status: 200,
        headers: { "Content-Type": typeof body === "string" ? "application/json" : "text/event-stream" },
      });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

function sseStream(payloads: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("Groq tool calling", () => {
  it("sends tools in the OpenAI shape", async () => {
    const sink: { body?: Record<string, unknown> } = {};
    const adapter = new GroqAdapter({
      provider: provider("groq", "https://api.groq.com/openai/v1"),
      transport: capturingTransport(sink, sseStream([{ choices: [{ delta: {} }] }])),
    });

    for await (const _chunk of adapter.stream({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "weather?" }],
      tools: [TOOL],
    })) {
      void _chunk;
    }

    expect(sink.body?.tools).toEqual([{ type: "function", function: TOOL.function }]);
  });

  it("surfaces a native tool_call delta", async () => {
    const adapter = new GroqAdapter({
      provider: provider("groq", "https://api.groq.com/openai/v1"),
      transport: capturingTransport({}, sseStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }] } }] },
      ])),
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "weather?" }],
      tools: [TOOL],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "tool_call", id: "call_1", name: "get_weather" }),
    );
  });
});

describe("Ollama tool calling", () => {
  it("sends tools in the OpenAI shape", async () => {
    const sink: { body?: Record<string, unknown> } = {};
    const adapter = new OllamaAdapter({
      provider: provider("ollama", "http://localhost:11434/v1"),
      transport: capturingTransport(sink, sseStream([{ choices: [{ delta: {} }] }])),
    });

    for await (const _chunk of adapter.stream({
      model: "llama3.1",
      messages: [{ role: "user", content: "weather?" }],
      tools: [TOOL],
    })) {
      void _chunk;
    }

    expect(sink.body?.tools).toEqual([{ type: "function", function: TOOL.function }]);
  });

  it("surfaces a native tool_call delta", async () => {
    const adapter = new OllamaAdapter({
      provider: provider("ollama", "http://localhost:11434/v1"),
      transport: capturingTransport({}, sseStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }] } }] },
      ])),
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      model: "llama3.1",
      messages: [{ role: "user", content: "weather?" }],
      tools: [TOOL],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "tool_call", id: "call_9", name: "get_weather" }),
    );
  });
});
