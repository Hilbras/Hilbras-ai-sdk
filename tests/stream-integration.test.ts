import { describe, it, expect, vi, beforeEach } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import type { StreamChunk } from "../src/types/streams.js";

function createMockTransport(chunks: StreamChunk[]) {
  return {
    request: vi.fn(),
    stream: vi.fn(async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    }),
    abort: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("stream() integration", () => {
  let client: HilbrasClient;

  beforeEach(() => {
    client = new HilbrasClient();
  });

  it("streams text deltas through the full pipeline", async () => {
    const mockChunks: StreamChunk[] = [
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "text_delta", text: "!" },
    ];

    client.addProvider({
      name: "test",
      baseUrl: "https://api.test.com/v1",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "openai",
      models: [{ id: "gpt-4", contextWindow: 8192, maxOutputTokens: 4096 }],
    });

    // Mock the adapter's stream method
    const mockAdapter = {
      id: "openai",
      stream: vi.fn(async function* () {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }),
      complete: vi.fn(),
    };
    (client as any)._adapters.set("test", mockAdapter);

    const collected: StreamChunk[] = [];
    for await (const chunk of client.stream({
      provider: "test",
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toHaveLength(3);
    expect(collected[0]).toEqual({ type: "text_delta", text: "Hello" });
    expect(collected[1]).toEqual({ type: "text_delta", text: " world" });
    expect(collected[2]).toEqual({ type: "text_delta", text: "!" });
  });

  it("emits request.completed hook on success", async () => {
    client.addProvider({
      name: "test",
      baseUrl: "https://api.test.com/v1",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "openai",
      models: [{ id: "gpt-4", contextWindow: 8192, maxOutputTokens: 4096 }],
    });

    const mockAdapter = {
      id: "openai",
      stream: vi.fn(async function* () {
        yield { type: "text_delta", text: "ok" };
      }),
      complete: vi.fn(),
    };
    (client as any)._adapters.set("test", mockAdapter);

    const completedEvents: any[] = [];
    client.on("request.completed", (e) => completedEvents.push(e));

    for await (const _ of client.stream({
      provider: "test",
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    })) { /* consume */ }

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].type).toBe("request.completed");
    expect(completedEvents[0].provider).toBe("test");
    expect(completedEvents[0].model).toBe("gpt-4");
  });

  it("emits request.failed hook on error", async () => {
    client.addProvider({
      name: "test",
      baseUrl: "https://api.test.com/v1",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "openai",
      models: [{ id: "gpt-4", contextWindow: 8192, maxOutputTokens: 4096 }],
    });

    const mockAdapter = {
      id: "openai",
      stream: vi.fn(async function* () {
        throw new Error("API error");
      }),
      complete: vi.fn(),
    };
    (client as any)._adapters.set("test", mockAdapter);

    const failedEvents: any[] = [];
    client.on("request.failed", (e) => failedEvents.push(e));

    const controller = new AbortController();
    try {
      for await (const _ of client.stream({
        provider: "test",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        signal: controller.signal,
      })) { /* consume */ }
    } catch {
      // expected
    }

    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    expect(failedEvents[0].type).toBe("request.failed");
  });
});
