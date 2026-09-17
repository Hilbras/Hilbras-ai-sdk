/**
 * @hilbras/sdk — Phase 2: Multi-Modal tests
 *
 * Tests the multi-modal reliability pipeline (retry, hooks) and
 * Google GenAI multi-modal adapter methods.
 */

import { describe, it, expect, vi } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { GoogleGenAIAdapter } from "../src/adapters/google-genai.js";
import { ProviderRequestError, ConfigurationError } from "../src/errors/index.js";
import type { HookEvent } from "../src/types/observability.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockTransport(ok = true, body: unknown = {}): any {
  return {
    request: vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      text: vi.fn().mockResolvedValue(JSON.stringify(body)),
      json: vi.fn().mockResolvedValue(body),
      body: null,
    }),
    stream: vi.fn(),
    abort: vi.fn(),
  };
}

function googleAdapter(transport?: any): GoogleGenAIAdapter {
  return new GoogleGenAIAdapter({
    provider: {
      name: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authentication: { type: "bearer", apiKey: "test-key" },
      adapter: "google-genai",
    },
    transport: transport ?? mockTransport(),
  });
}

// ─── Multi-Modal Reliability Pipeline ───────────────────────────────────────

describe("Multi-Modal Reliability Pipeline", () => {
  it("emits request.start and request.completed for embed()", async () => {
    const transport = mockTransport(true, {
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const client = new HilbrasClient({ transport });
    client.addProvider({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authentication: { type: "bearer", apiKey: "test" },
      adapter: "openai",
    });

    const events: HookEvent[] = [];
    client.on("request.start", (e) => events.push(e));
    client.on("request.completed", (e) => events.push(e));

    await client.embed({
      provider: "openai",
      model: "text-embedding-3-small",
      input: "hello world",
    });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("request.start");
    expect(events[1].type).toBe("request.completed");
  });

  it("emits request.failed on adapter error", async () => {
    const transport = mockTransport(false);
    const client = new HilbrasClient({ transport });
    client.addProvider({
      name: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authentication: { type: "bearer", apiKey: "test" },
      adapter: "google-genai",
    });

    const events: HookEvent[] = [];
    client.on("request.failed", (e) => events.push(e));

    await expect(client.embed({
      provider: "google",
      model: "embedding-001",
      input: "hello",
    })).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("request.failed");
  });

  it("throws ConfigurationError for unsupported multi-modal method", async () => {
    const client = new HilbrasClient();
    client.addProvider({
      name: "anthropic",
      baseUrl: "https://api.anthropic.com",
      authentication: { type: "bearer", apiKey: "test" },
      adapter: "anthropic",
    });

    await expect(client.embed({
      provider: "anthropic",
      model: "claude-4",
      input: "hello",
    })).rejects.toThrow(ConfigurationError);
  });

  it("retries on retryable status codes", async () => {
    let callCount = 0;
    const transport = {
      request: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited"), json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 1, total_tokens: 1 } }),
          text: () => Promise.resolve(""),
        });
      }),
      stream: vi.fn(),
      abort: vi.fn(),
    };

    const client = new HilbrasClient({ transport });
    client.addProvider({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authentication: { type: "bearer", apiKey: "test" },
      adapter: "openai",
    });

    const events: HookEvent[] = [];
    client.on("request.retrying", (e) => events.push(e));

    const result = await client.embed({
      provider: "openai",
      model: "text-embedding-3-small",
      input: "hello",
    });

    expect(result.embeddings).toHaveLength(1);
    expect(callCount).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("request.retrying");
  });
});

// ─── Google GenAI Multi-Modal ───────────────────────────────────────────────

describe("GoogleGenAIAdapter multi-modal", () => {
  it("embed() returns embeddings", async () => {
    const transport = mockTransport(true, {
      embedding: { values: [0.1, 0.2, 0.3] },
    });
    const adapter = googleAdapter(transport);

    const result = await adapter.embed({ model: "embedding-001", input: "hello world" });
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage).toBeDefined();
  });

  it("embed() handles array input", async () => {
    const transport = mockTransport(true, {
      embedding: { values: [0.1, 0.2] },
    });
    const adapter = googleAdapter(transport);

    const result = await adapter.embed({ model: "embedding-001", input: ["hello", "world"] });
    expect(result.embeddings).toHaveLength(1);
  });

  it("embed() throws on API error", async () => {
    const transport = mockTransport(false);
    const adapter = googleAdapter(transport);

    await expect(adapter.embed({ model: "embedding-001", input: "test" })).rejects.toThrow(ProviderRequestError);
  });

  it("generateImage() returns images", async () => {
    const transport = mockTransport(true, {
      predictions: [{ bytesBase64Encoded: "base64data", prompt: "revised" }],
    });
    const adapter = googleAdapter(transport);

    const result = await adapter.generateImage({ model: "imagen-3", prompt: "a cat" });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].b64Json).toBe("base64data");
    expect(result.images[0].revisedPrompt).toBe("revised");
  });

  it("generateImage() throws on API error", async () => {
    const transport = mockTransport(false);
    const adapter = googleAdapter(transport);

    await expect(adapter.generateImage({ model: "imagen-3", prompt: "test" })).rejects.toThrow(ProviderRequestError);
  });

  it("generateSpeech() returns audio", async () => {
    const transport = mockTransport(true, {
      audioContent: btoa("audio-data"),
    });
    const adapter = googleAdapter(transport);

    const result = await adapter.generateSpeech({
      model: "tts-1",
      input: "Hello world",
      voice: "alloy" as any,
    });
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.format).toBeDefined();
  });

  it("generateSpeech() throws on API error", async () => {
    const transport = mockTransport(false);
    const adapter = googleAdapter(transport);

    await expect(adapter.generateSpeech({
      model: "tts-1",
      input: "test",
      voice: "alloy" as any,
    })).rejects.toThrow(ProviderRequestError);
  });

  it("transcribe() returns text", async () => {
    const transport = mockTransport(true, {
      results: [{ alternatives: [{ transcript: "Hello world" }] }],
    });
    const adapter = googleAdapter(transport);

    const result = await adapter.transcribe({
      model: "whisper-1",
      file: new Uint8Array([1, 2, 3]),
    });
    expect(result.text).toBe("Hello world");
  });

  it("transcribe() throws on API error", async () => {
    const transport = mockTransport(false);
    const adapter = googleAdapter(transport);

    await expect(adapter.transcribe({
      model: "whisper-1",
      file: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow(ProviderRequestError);
  });
});
