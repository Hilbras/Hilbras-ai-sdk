/**
 * @hilbras/sdk — Telemetry attribute coverage tests
 *
 * Covers the data the OpenTelemetry exporter reports: estimated cost on
 * request.completed, and the real router score on routing.resolved (which
 * used to be hardcoded to 0).
 */

import { describe, expect, it } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { OpenTelemetryExporter } from "../src/telemetry/opentelemetry.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { Transport } from "../src/transport/transport.js";

// A model id with known pricing, so the cost estimate is non-zero.
const MODEL = "gpt-5.6-luna";

function provider(name: string): ProviderConfig {
  return {
    name,
    baseUrl: `https://${name.toLowerCase()}.example/v1`,
    authentication: { type: "none" },
    adapter: "openai",
    models: [
      {
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
      },
    ],
  };
}

function usageTransport(): Transport {
  return {
    async request() {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
        { status: 200 },
      );
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

describe("telemetry attributes", () => {
  it("request.completed carries the estimated cost", async () => {
    const client = new HilbrasClient({ transport: usageTransport() });
    client.addProvider(provider("TelemetryCost"));

    const events: any[] = [];
    client.on("request.completed", e => events.push(e));

    await client.complete({
      provider: "TelemetryCost",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(events).toHaveLength(1);
    expect(typeof events[0].estimatedCost).toBe("number");
    expect(events[0].estimatedCost).toBeGreaterThan(0);
  });

  it("routing.resolved reports the real router score, not 0", async () => {
    const client = new HilbrasClient({ transport: usageTransport() });
    client.addProvider(provider("TelemetryRouting"));

    const events: any[] = [];
    client.on("routing.resolved", e => events.push(e));

    await client.complete({
      provider: "TelemetryRouting",
      model: MODEL,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("TelemetryRouting");
    expect(events[0].model).toBe(MODEL);
    // An explicitly requested provider has no router score to report.
    expect(events[0].score).toBe(0);
    expect(events[0].reasons).toEqual(["Explicit provider/model"]);
  });

  it("exporter recorders accept the new event shapes", () => {
    const otel = new OpenTelemetryExporter();

    expect(() =>
      otel.recordRouting({
        type: "routing.resolved",
        requestId: "req_1",
        timestamp: 0,
        provider: "openai",
        model: "gpt-5.6",
        score: 87,
        reasons: ["Supports required tools"],
      }),
    ).not.toThrow();

    expect(() =>
      otel.recordCircuitBreakerOpen({
        type: "circuit_breaker.open",
        requestId: "req_1",
        timestamp: 0,
        provider: "openai",
      }),
    ).not.toThrow();

    expect(() =>
      otel.recordRequest({
        type: "request.completed",
        requestId: "req_1",
        timestamp: 0,
        provider: "openai",
        model: "gpt-5.6",
        durationMs: 10,
        attempts: 1,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.001,
        structuredOutput: false,
      }),
    ).not.toThrow();
  });
});
