import { afterEach, describe, expect, it } from "vitest";
import { HilbrasClient } from "../../../src/client/client.js";
import { getCircuitBreakerRegistry } from "../../../src/reliability/circuit-breaker.js";
import type { ProviderConfig } from "../../../src/types/providers.js";
import type { Transport } from "../../../src/transport/transport.js";

const MODEL = "execution-model";

function provider(name: string): ProviderConfig {
  return {
    name,
    baseUrl: `https://${name.toLowerCase()}.example/v1`,
    authentication: { type: "none" },
    adapter: "openai",
    models: [{
      id: MODEL,
      contextWindow: 128_000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        reasoning: false,
        structuredOutput: true,
        parallelTools: true,
        systemPrompts: true,
        embeddings: false,
        imageGeneration: false,
        speech: false,
        transcription: false,
        reranking: false,
      },
    }],
  };
}

function successTransport(): Transport {
  return {
    async request() {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

function sseTransport(onStream: () => void): Transport {
  return {
    async request() {
      onStream();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`,
          ));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

function failingTransport(): Transport {
  return {
    async request() {
      return new Response(JSON.stringify({ error: { message: "failure" } }), { status: 500 });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

afterEach(() => {
  getCircuitBreakerRegistry().resetAll();
});

describe("v3.2 execution lifecycle characterization", () => {
  it("emits the established complete request lifecycle", async () => {
    const client = new HilbrasClient({ transport: successTransport(), budget: { sessionBudget: 1 } });
    client.addProvider(provider("LifecycleComplete"));
    const events: string[] = [];
    client.on("request.start", () => events.push("request.start"));
    client.on("routing.resolved", () => events.push("routing.resolved"));
    client.on("request.completed", () => events.push("request.completed"));
    client.on("request.failed", () => events.push("request.failed"));

    await client.complete({
      provider: "LifecycleComplete",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      policy: { retry: { maxRetries: 0 } },
    });

    expect(events).toEqual(["request.start", "routing.resolved", "request.completed"]);
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("keeps stream startup lazy and releases the reservation on consumer return", async () => {
    let streamCalls = 0;
    const client = new HilbrasClient({
      transport: sseTransport(() => { streamCalls++; }),
      budget: { sessionBudget: 1 },
    });
    client.addProvider(provider("LifecycleStream"));

    const iterator = client.stream({
      provider: "LifecycleStream",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      policy: { retry: { maxRetries: 0 } },
    });

    expect(streamCalls).toBe(0);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(streamCalls).toBe(1);
    await iterator.return?.(undefined);
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("emits a terminal failure and releases budget for a non-streaming provider failure", async () => {
    const client = new HilbrasClient({ transport: failingTransport(), budget: { sessionBudget: 1 } });
    client.addProvider(provider("LifecycleFailure"));
    const events: string[] = [];
    client.on("request.failed", () => events.push("request.failed"));

    await expect(client.complete({
      provider: "LifecycleFailure",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      policy: { retry: { maxRetries: 0 } },
    })).rejects.toThrow();

    expect(events).toEqual(["request.failed"]);
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("runs the primary plugin lifecycle around a successful complete request", async () => {
    const calls: string[] = [];
    const client = new HilbrasClient({ transport: successTransport(), budget: { sessionBudget: 1 } });
    client.addProvider(provider("LifecyclePlugin"));
    await client.use({
      name: "characterization",
      onRequest() { calls.push("request"); },
      onResponse() { calls.push("response"); },
      onError() { calls.push("error"); },
    });

    await client.complete({
      provider: "LifecyclePlugin",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
      policy: { retry: { maxRetries: 0 } },
    });

    expect(calls).toEqual(["request", "response"]);
  });
});
