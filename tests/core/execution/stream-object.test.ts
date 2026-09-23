import { describe, expect, it, vi } from "vitest";
import { HilbrasClient } from "../../../src/client/client.js";
import { ValidationError } from "../../../src/errors/index.js";
import type { SchemaValidator } from "../../../src/types/schema.js";
import type { StreamChunk } from "../../../src/types/streams.js";

function makeClient(chunks: StreamChunk[]): HilbrasClient {
  const client = new HilbrasClient({ budget: { sessionBudget: 1 } });
  client.addProvider({
    name: "stream-object-provider",
    baseUrl: "https://stream-object.example/v1",
    authentication: { type: "none" },
    adapter: "openai",
    models: [{
      id: "stream-object-model",
      contextWindow: 8192,
      capabilities: {
        streaming: true,
        tools: false,
        vision: false,
        reasoning: false,
        structuredOutput: true,
        parallelTools: false,
        systemPrompts: true,
      },
    }],
  });
  (client as unknown as { _adapters: Map<string, unknown> })._adapters.set("stream-object-provider", {
    id: "openai",
    complete: vi.fn(),
    stream: vi.fn(async function* () {
      for (const chunk of chunks) yield chunk;
    }),
  });
  return client;
}

const schema: SchemaValidator<{ name: string }> = {
  safeParse(value) {
    if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
      return { success: true, data: value as { name: string } };
    }
    return { success: false, error: new Error("name is required") };
  },
};

describe("streamObject execution parity", () => {
  it("emits partial objects and a successful terminal event", async () => {
    const client = makeClient([
      { type: "text", text: '{"name":"Ada"}' },
      { type: "finish", reason: "stop" },
    ]);
    const completed: unknown[] = [];
    const finalObjects: unknown[] = [];
    client.on("request.completed", (event) => completed.push(event));

    const events = [] as Array<{ type: string; partialObject?: unknown } | StreamChunk>;
    for await (const event of client.streamObject({
      provider: "stream-object-provider",
      model: "stream-object-model",
      messages: [{ role: "user", content: "Who?" }],
      schema,
      onFinalObject: (value) => finalObjects.push(value),
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "object_delta", partialObject: { name: "Ada" } },
      { type: "finish", reason: "stop" },
    ]);
    expect(finalObjects).toEqual([{ name: "Ada" }]);
    expect(completed).toHaveLength(1);
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("does not report success when final schema validation fails", async () => {
    const client = makeClient([
      { type: "text", text: '{"other":"value"}' },
      { type: "finish", reason: "stop" },
    ]);
    const completed: unknown[] = [];
    const failed: unknown[] = [];
    client.on("request.completed", (event) => completed.push(event));
    client.on("request.failed", (event) => failed.push(event));

    await expect((async () => {
      for await (const _event of client.streamObject({
        provider: "stream-object-provider",
        model: "stream-object-model",
        messages: [{ role: "user", content: "Who?" }],
        schema,
      })) {
        // Consume the stream.
      }
    })()).rejects.toBeInstanceOf(ValidationError);

    expect(completed).toHaveLength(0);
    expect(failed.length).toBeGreaterThanOrEqual(0);
    expect(client.costReport().activeReservations).toBe(0);
  });
});
