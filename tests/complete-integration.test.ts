import { describe, it, expect, vi, beforeEach } from "vitest";
import { HilbrasClient } from "../src/client/client.js";

describe("complete() integration", () => {
  let client: HilbrasClient;

  beforeEach(() => {
    client = new HilbrasClient();
  });

  it("returns complete response through the full pipeline", async () => {
    client.addProvider({
      name: "test",
      baseUrl: "https://api.test.com/v1",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "openai",
      models: [{ id: "gpt-4", contextWindow: 8192, maxOutputTokens: 4096 }],
    });

    const mockAdapter = {
      id: "openai",
      stream: vi.fn(),
      complete: vi.fn(async function* () {
        yield { type: "text", text: "Hello world" };
      }),
    };
    (client as any)._adapters.set("test", mockAdapter);

    const result = await client.complete({
      provider: "test",
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result).toBeDefined();
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
      stream: vi.fn(),
      complete: vi.fn(async function* () {
        yield { type: "text", text: "ok" };
      }),
    };
    (client as any)._adapters.set("test", mockAdapter);

    const completedEvents: any[] = [];
    client.on("request.completed", (e) => completedEvents.push(e));

    await client.complete({
      provider: "test",
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].type).toBe("request.completed");
  });

  it("handles provider not found error", async () => {
    await expect(
      client.complete({
        provider: "nonexistent",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow();
  });
});
