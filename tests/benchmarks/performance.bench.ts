/**
 * @hilbras/sdk — Performance Benchmarks
 *
 * Measures hot-path performance to catch regressions.
 * Run: npm run benchmark
 *
 * Vitest 5 rewrote the benchmarking API: `bench` is no longer a top-level
 * import, it is a fixture on the test context, so each benchmark is wrapped in
 * a `test()` that drives it.
 */

import { describe, test } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { extractJson } from "../../src/output/structured.js";
import { estimateTokens, estimateCost } from "../../src/tokens/counter.js";
import { generateId, createIdGenerator, shortId } from "../../src/utils/id.js";
import { resolvePolicy, getPreset } from "../../src/reliability/presets.js";
import { CircuitBreaker } from "../../src/reliability/circuit-breaker.js";
import { calculateBackoff } from "../../src/reliability/backoff.js";
import { validateBaseUrl } from "../../src/security/url-guard.js";
import { redactPii } from "../../src/security/pii-guard.js";
import { chunk } from "../../src/types/streams.js";

// ─── Router Benchmarks ──────────────────────────────────────────────────────

describe("Router performance", () => {
  const client = new HilbrasClient();
  for (let i = 0; i < 50; i++) {
    client.addProvider({
      name: `provider_${i}`,
      baseUrl: `https://api${i}.example.com/v1`,
      authentication: { type: "bearer", apiKey: `key_${i}` },
      adapter: "openai",
      models: [{
        id: `model_${i}`,
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        capabilities: {
          streaming: true, tools: true, vision: false, reasoning: false,
          structuredOutput: false, parallelTools: false, systemPrompts: true,
          embeddings: false, imageGeneration: false, speech: false,
          transcription: false, reranking: false,
        },
      }],
    });
  }

  test("route 1000 decisions", async ({ bench }) => {
    await bench("route 1000 decisions", () => {
      for (let i = 0; i < 1000; i++) {
        client.router.best({ task: "general" });
      }
    }).run();
  });
});

// ─── JSON Extraction Benchmarks ─────────────────────────────────────────────

describe("extractJson performance", () => {
  const validJson = JSON.stringify({ name: "test", values: [1, 2, 3], nested: { a: true } });
  const markdownWrapped = "Here is the result:\n```json\n" + validJson + "\n```\nDone.";
  const longPrefix = "x".repeat(5000) + validJson;

  test("clean JSON", async ({ bench }) => {
    await bench("clean JSON", () => { extractJson(validJson); }).run();
  });

  test("markdown-wrapped JSON", async ({ bench }) => {
    await bench("markdown-wrapped JSON", () => { extractJson(markdownWrapped); }).run();
  });

  test("long prefix JSON", async ({ bench }) => {
    await bench("long prefix JSON", () => { extractJson(longPrefix); }).run();
  });
});

// ─── Token Estimation Benchmarks ────────────────────────────────────────────

describe("Token estimation performance", () => {
  const shortText = "Hello, how are you?";
  const longText = "The quick brown fox jumps over the lazy dog. ".repeat(100);

  test("estimateTokens (short)", async ({ bench }) => {
    await bench("estimateTokens (short)", () => { estimateTokens(shortText); }).run();
  });

  test("estimateTokens (long, 4500 chars)", async ({ bench }) => {
    await bench("estimateTokens (long, 4500 chars)", () => { estimateTokens(longText); }).run();
  });

  test("estimateCost", async ({ bench }) => {
    await bench("estimateCost", () => { estimateCost(1000, 500, "openai", "gpt-4o"); }).run();
  });
});

// ─── ID Generation Benchmarks ───────────────────────────────────────────────

describe("ID generation performance", () => {
  const gen = createIdGenerator("req");

  test("generateId (UUID)", async ({ bench }) => {
    await bench("generateId (UUID)", () => { generateId(); }).run();
  });

  test("createIdGenerator", async ({ bench }) => {
    await bench("createIdGenerator", () => { gen(); }).run();
  });

  test("shortId", async ({ bench }) => {
    await bench("shortId", () => { shortId(); }).run();
  });
});

// ─── Reliability Benchmarks ─────────────────────────────────────────────────

describe("Reliability performance", () => {
  const cb = new CircuitBreaker("bench", { failureThreshold: 5, successThreshold: 2, timeoutMs: 1000, halfOpenMaxCalls: 3 });

  test("resolvePolicy", async ({ bench }) => {
    await bench("resolvePolicy", () => { resolvePolicy({ preset: "production" }); }).run();
  });

  test("getPreset", async ({ bench }) => {
    await bench("getPreset", () => { getPreset("balanced"); }).run();
  });

  test("calculateBackoff", async ({ bench }) => {
    await bench("calculateBackoff", () => { calculateBackoff(3, { baseDelayMs: 100, maxDelayMs: 10_000, jitter: 0.3 }); }).run();
  });

  test("circuitBreaker.allowRequest (closed)", async ({ bench }) => {
    await bench("circuitBreaker.allowRequest (closed)", () => { cb.isAvailable(); }).run();
  });
});

// ─── Security Benchmarks ────────────────────────────────────────────────────

describe("Security performance", () => {
  test("validateBaseUrl (https)", async ({ bench }) => {
    await bench("validateBaseUrl (https)", () => { validateBaseUrl("https://api.openai.com/v1"); }).run();
  });

  test("validateBaseUrl (rejected)", async ({ bench }) => {
    await bench("validateBaseUrl (rejected)", () => { validateBaseUrl("http://169.254.169.254/metadata"); }).run();
  });

  test("redactPii (clean text)", async ({ bench }) => {
    await bench("redactPii (clean text)", () => { redactPii("Hello world, this is a test."); }).run();
  });

  test("redactPii (PII-heavy)", async ({ bench }) => {
    await bench("redactPii (PII-heavy)", () => { redactPii("Email: test@example.com, SSN: 123-45-6789, Card: 4111111111111111"); }).run();
  });
});

// ─── Stream Chunk Benchmarks ────────────────────────────────────────────────

describe("Stream chunk performance", () => {
  test("chunk.text", async ({ bench }) => {
    await bench("chunk.text", () => { chunk.text("Hello world"); }).run();
  });

  test("chunk.usage", async ({ bench }) => {
    await bench("chunk.usage", () => { chunk.usage(100, 50, 150); }).run();
  });

  test("chunk.finish", async ({ bench }) => {
    await bench("chunk.finish", () => { ({ type: "finish", reason: "stop" } as const); }).run();
  });
});
