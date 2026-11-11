/**
 * @hilbras/sdk — Adapter stream terminators (A3)
 *
 * Every adapter must emit a `usage` chunk when the provider reports token
 * counts and a `finish` chunk when generation ends. The client runs final
 * structured-output validation on `finish`, so a missing `finish` silently
 * skips validation and repair.
 */

import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "../src/adapters/anthropic.js";
import { GoogleGenAIAdapter } from "../src/adapters/google-genai.js";
import { VertexAIAdapter } from "../src/adapters/google-vertex.js";
import { GroqAdapter } from "../src/adapters/groq.js";
import { OllamaAdapter } from "../src/adapters/ollama.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { AIProvider } from "../src/types/adapter.js";
import type { StreamChunk } from "../src/types/streams.js";

function mockTransport(chunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200 }); },
    async stream() { return stream; },
    abort() {},
  };
}

function openAiSse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function anthropicSse(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collect(adapter: AIProvider, model: string): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of adapter.stream({ model, messages: [{ role: "user", content: "hi" }] })) {
    chunks.push(chunk);
  }
  return chunks;
}

function usageOf(chunks: StreamChunk[]) {
  const usage = chunks.filter((c) => c.type === "usage");
  expect(usage).toHaveLength(1);
  return usage[0] as { inputTokens: number; outputTokens: number; totalTokens: number };
}

function finishReasonOf(chunks: StreamChunk[]) {
  const finish = chunks.filter((c) => c.type === "finish");
  expect(finish).toHaveLength(1);
  return (finish[0] as { reason: string }).reason;
}

const bearer = (apiKey = "test-key") => ({ type: "bearer" as const, apiKey });

describe("adapter stream terminators", () => {
  it("groq emits a finish chunk from finish_reason", async () => {
    const provider: ProviderConfig = {
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      authentication: bearer("gsk_test"),
      adapter: "groq",
      models: [],
    };
    const adapter = new GroqAdapter({
      provider,
      transport: mockTransport([
        openAiSse({ choices: [{ delta: { content: "hi" } }] }),
        openAiSse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]),
    });

    const chunks = await collect(adapter, "llama-3.3-70b-versatile");
    expect(finishReasonOf(chunks)).toBe("stop");
  });

  it("ollama emits usage and finish chunks", async () => {
    const provider: ProviderConfig = {
      name: "ollama",
      baseUrl: "http://localhost:11434/v1",
      authentication: { type: "none" },
      adapter: "ollama",
      models: [],
    };
    const adapter = new OllamaAdapter({
      provider,
      transport: mockTransport([
        openAiSse({ choices: [{ delta: { content: "hi" } }] }),
        openAiSse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
        openAiSse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]),
    });

    const chunks = await collect(adapter, "llama3.1");
    expect(usageOf(chunks)).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(finishReasonOf(chunks)).toBe("stop");
  });

  it("anthropic takes prompt tokens from message_start and finishes on message_stop", async () => {
    const provider: ProviderConfig = {
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      authentication: bearer(),
      adapter: "anthropic",
      models: [],
    };
    const adapter = new AnthropicAdapter({
      provider,
      transport: mockTransport([
        anthropicSse("message_start", {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 42, output_tokens: 0 } },
        }),
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hi" },
        }),
        anthropicSse("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 7 },
        }),
        anthropicSse("message_stop", { type: "message_stop" }),
      ]),
    });

    const chunks = await collect(adapter, "claude-3");
    expect(usageOf(chunks)).toMatchObject({ inputTokens: 42, outputTokens: 7, totalTokens: 49 });
    expect(finishReasonOf(chunks)).toBe("end_turn");
  });

  it("google-vertex emits usageMetadata and finishReason", async () => {
    const provider: ProviderConfig = {
      name: "google-vertex",
      baseUrl: "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
      authentication: bearer(),
      adapter: "google-vertex",
      models: [],
    };
    const adapter = new VertexAIAdapter({
      provider,
      transport: mockTransport([
        openAiSse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }),
        openAiSse({
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, totalTokenCount: 15 },
        }),
      ]),
    });

    const chunks = await collect(adapter, "google/gemini-2.5-flash");
    expect(usageOf(chunks)).toMatchObject({ inputTokens: 11, outputTokens: 4, totalTokens: 15 });
    expect(finishReasonOf(chunks)).toBe("STOP");
  });

  it("google-genai emits usageMetadata and finishReason", async () => {
    const provider: ProviderConfig = {
      name: "google-genai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authentication: bearer(),
      adapter: "google-genai",
      models: [],
    };
    const adapter = new GoogleGenAIAdapter({
      provider,
      transport: mockTransport([
        openAiSse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }),
        openAiSse({
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 6, totalTokenCount: 15 },
        }),
      ]),
    });

    const chunks = await collect(adapter, "gemini-2.5-flash");
    expect(usageOf(chunks)).toMatchObject({ inputTokens: 9, outputTokens: 6, totalTokens: 15 });
    expect(finishReasonOf(chunks)).toBe("STOP");
  });
});
