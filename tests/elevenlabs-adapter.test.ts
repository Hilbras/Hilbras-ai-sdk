import { describe, it, expect } from "vitest";
import { ElevenLabsAdapter } from "../src/adapters/elevenlabs.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "elevenlabs",
  baseUrl: "https://api.elevenlabs.io",
  authentication: { type: "bearer", apiKey: "el_test_key" },
  adapter: "elevenlabs",
  models: [{ id: "eleven_monolingual_v1", contextWindow: 0, maxOutputTokens: 0, capabilities: { streaming: false, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: false, embeddings: false, imageGeneration: false, speech: true, transcription: false, reranking: false } }],
};

describe("ElevenLabsAdapter", () => {
  it("synthesizes speech via text-to-speech endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};
    const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(fakeAudio.buffer, { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new ElevenLabsAdapter({ provider, transport });
    const result = await adapter.generateSpeech({ model: "eleven_monolingual_v1", input: "Hello world", voice: "21m00Tcm4TlvDq8ikWAM" });

    expect(capturedUrl).toContain("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
    expect(capturedHeaders["xi-api-key"]).toBe("el_test_key");
    expect(capturedHeaders["Accept"]).toBe("audio/mpeg");
    const body = JSON.parse(capturedBody);
    expect(body.text).toBe("Hello world");
    expect(result.audio.length).toBe(4);
    expect(result.format).toBe("mp3");
  });

  it("uses default voice when not specified", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(new Uint8Array([0xff]).buffer, { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new ElevenLabsAdapter({ provider, transport });
    await adapter.generateSpeech({ model: "eleven_monolingual_v1", input: "Hi" });

    expect(capturedUrl).toContain("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
  });

  it("passes speed setting", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(new Uint8Array([0xff]).buffer, { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new ElevenLabsAdapter({ provider, transport });
    await adapter.generateSpeech({ model: "eleven_monolingual_v1", input: "Hi", speed: 1.2 });

    const body = JSON.parse(capturedBody);
    expect(body.voice_settings.speed).toBe(1.2);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: "Quota exceeded" }), { status: 429 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new ElevenLabsAdapter({ provider, transport });
    await expect(adapter.generateSpeech({ model: "eleven_monolingual_v1", input: "Hi" })).rejects.toThrow(ProviderRequestError);
  });

  it("throws on embed/complete/stream calls", async () => {
    const adapter = new ElevenLabsAdapter({ provider, transport: {} as Transport });
    await expect(adapter.embed({ model: "x", input: "x" })).rejects.toThrow("does not support embeddings");
    await expect(adapter.complete({ model: "x", messages: [] })).rejects.toThrow("does not support chat");
  });
});
