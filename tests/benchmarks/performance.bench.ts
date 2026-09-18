/**
 * @hilbras/sdk — Performance Benchmarks
 *
 * Measures hot-path performance to catch regressions.
 * Run: npm run benchmark
 */

import { describe, it, bench } from "vitest";
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
        costPer1kInput: 0.001 * (i + 1),
        costPer1kOutput: 0.002 * (i + 1),
        capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true },
      }],
    });
  }

  bench("route 1000 decisions", () => {
    for (let i = 0; i < 1000; i++) {
      client.best({ task: "general" });
    }
  });
});

// ─── JSON Extraction Benchmarks ─────────────────────────────────────────────

describe("extractJson performance", () => {
  const validJson = JSON.stringify({ name: "test", values: [1, 2, 3], nested: { a: true } });
  const markdownWrapped = "Here is the result:\n```json\n" + validJson + "\n```\nDone.";
  const longPrefix = "x".repeat(5000) + validJson;

  bench("clean JSON", () => extractJson(validJson));
  bench("markdown-wrapped JSON", () => extractJson(markdownWrapped));
  bench("long prefix JSON", () => extractJson(longPrefix));
});

// ─── Token Estimation Benchmarks ────────────────────────────────────────────

describe("Token estimation performance", () => {
  const shortText = "Hello, how are you?";
  const longText = "The quick brown fox jumps over the lazy dog. ".repeat(100);

  bench("estimateTokens (short)", () => estimateTokens(shortText));
  bench("estimateTokens (long, 4500 chars)", () => estimateTokens(longText));
  bench("estimateCost", () => estimateCost("gpt-4o", 1000, 500));
});

// ─── ID Generation Benchmarks ───────────────────────────────────────────────

describe("ID generation performance", () => {
  const gen = createIdGenerator("req");

  bench("generateId (UUID)", () => generateId());
  bench("createIdGenerator", () => gen());
  bench("shortId", () => shortId());
});

// ─── Reliability Benchmarks ─────────────────────────────────────────────────

describe("Reliability performance", () => {
  const cb = new CircuitBreaker({ failureThreshold: 5, recoveryTimeout: 1000 });

  bench("resolvePolicy", () => resolvePolicy({ preset: "production" }));
  bench("getPreset", () => getPreset("balanced"));
  bench("calculateBackoff", () => calculateBackoff(3, { baseMs: 100, maxMs: 10_000, multiplier: 2, jitter: true }));
  bench("circuitBreaker.allowRequest (closed)", () => cb.allowRequest());
});

// ─── Security Benchmarks ────────────────────────────────────────────────────

describe("Security performance", () => {
  bench("validateBaseUrl (https)", () => validateBaseUrl("https://api.openai.com/v1"));
  bench("validateBaseUrl (rejected)", () => validateBaseUrl("http://169.254.169.254/metadata"));
  bench("redactPii (clean text)", () => redactPii("Hello world, this is a test."));
  bench("redactPii (PII-heavy)", () => redactPii("Email: test@example.com, SSN: 123-45-6789, Card: 4111111111111111"));
});

// ─── Stream Chunk Benchmarks ────────────────────────────────────────────────

describe("Stream chunk performance", () => {
  bench("chunk.text", () => chunk.text("Hello world"));
  bench("chunk.usage", () => chunk.usage(100, 50, 150));
  bench("chunk.finish", () => chunk.finish("stop"));
});
