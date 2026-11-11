/**
 * @hilbras/sdk — Multimodal retry policy (C3) and abort (C4)
 *
 * The multimodal loop used `(status > 0 && shouldRetry(...)) || shouldRetryNetworkError(...)`.
 * The second clause ignores the status and defaults on, so 401/403/404 were
 * retried with full backoff and each attempt recorded a circuit-breaker
 * failure. The loop also never checked `signal.aborted`, so a cancelled request
 * kept retrying for minutes, with a non-cancellable sleep.
 */

import { afterEach, describe, expect, it } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { getCircuitBreakerRegistry } from "../src/reliability/circuit-breaker.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { Transport } from "../src/transport/transport.js";

const MODEL = "text-embedding-3-small";

function provider(): ProviderConfig {
  return {
    name: "EmbedProvider",
    baseUrl: "https://embed.example/v1",
    authentication: { type: "none" },
    adapter: "openai",
    models: [{
      id: MODEL,
      contextWindow: 8_000,
      capabilities: {
        streaming: false,
        tools: false,
        vision: false,
        reasoning: false,
        structuredOutput: false,
        parallelTools: false,
        systemPrompts: true,
        embeddings: true,
        imageGeneration: false,
        speech: false,
        transcription: false,
        reranking: false,
      },
    }],
  };
}

function countingTransport(status: number, calls: { n: number }): Transport {
  return {
    async request() {
      calls.n += 1;
      return new Response(JSON.stringify({ error: { message: "provider said no" } }), { status });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

function clientWith(status: number, calls: { n: number }): HilbrasClient {
  const client = new HilbrasClient({ transport: countingTransport(status, calls), maxRetries: 1 });
  client.addProvider(provider());
  return client;
}

afterEach(() => {
  getCircuitBreakerRegistry().resetAll();
});

describe("multimodal retry policy", () => {
  it("does not retry a non-retryable status", async () => {
    const calls = { n: 0 };
    const client = clientWith(401, calls);

    await expect(
      client.embed({ provider: "EmbedProvider", model: MODEL, input: "hi" }),
    ).rejects.toThrow();

    expect(calls.n).toBe(1);
  });

  it("still retries a retryable status", async () => {
    const calls = { n: 0 };
    const client = clientWith(503, calls);

    await expect(
      client.embed({ provider: "EmbedProvider", model: MODEL, input: "hi" }),
    ).rejects.toThrow();

    // Only the bound matters here: the retry path must still exist.
    expect(calls.n).toBeGreaterThan(1);
  }, 20_000);

  it("does not retry once the caller has aborted", async () => {
    const calls = { n: 0 };
    const client = clientWith(503, calls);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.embed({ provider: "EmbedProvider", model: MODEL, input: "hi", signal: controller.signal }),
    ).rejects.toThrow();

    expect(calls.n).toBe(1);
  });
});
