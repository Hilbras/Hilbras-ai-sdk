import { describe, it, expect } from "vitest";
import { estimateTokens, estimateMessageTokens, estimateToolTokens, estimateCost } from "../src/tokens/counter.js";
import { cacheSystemMessage, cacheLastN, autoCache, supportsCacheControl } from "../src/tokens/prompt-cache.js";

describe("Token estimation", () => {
  it("estimateTokens uses ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBe(2); // 5 chars → ceil(5/4) = 2
    expect(estimateTokens("a".repeat(100))).toBe(25); // 100 chars → 25 tokens
  });

  it("estimateMessageTokens includes role overhead", () => {
    const result = estimateMessageTokens([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ]);
    // 4 role overhead × 2 messages = 8, plus 4+15 chars = ~5.75 → 6
    expect(result.tokens).toBeGreaterThan(8);
    expect(result.tokens).toBeLessThan(15);
  });

  it("estimateToolTokens sums tool definitions", () => {
    const result = estimateToolTokens([
      { function: { name: "read", description: "Read file", parameters: { type: "object", properties: {} } } },
    ]);
    expect(result.tokens).toBeGreaterThan(0);
  });
});

describe("Cost estimation", () => {
  it("calculates cost for GPT-4o", () => {
    const cost = estimateCost(1000, 500, "openai", "gpt-4o");
    // 1000 tokens × $2.50/1M = $0.0025
    // 500 tokens × $10/1M = $0.005
    expect(cost.inputCost).toBeCloseTo(0.0025, 6);
    expect(cost.outputCost).toBeCloseTo(0.005, 6);
    expect(cost.currency).toBe("USD");
  });

  it("returns 0 for unknown models", () => {
    const cost = estimateCost(1000, 1000, "unknown", "unknown");
    expect(cost.totalCost).toBe(0);
  });
});

describe("Prompt caching", () => {
  it("cacheSystemMessage marks system messages", () => {
    const msgs = [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "hi" },
    ];
    const cached = cacheSystemMessage(msgs);
    expect(cached[0].cache_control).toEqual({ type: "ephemeral" });
    expect(cached[1].cache_control).toBeUndefined();
  });

  it("cacheLastN marks the last N messages", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));
    const cached = cacheLastN(msgs, 2);
    expect(cached[0].cache_control).toBeUndefined();
    expect(cached[1].cache_control).toBeUndefined();
    expect(cached[3].cache_control).toEqual({ type: "ephemeral" });
    expect(cached[4].cache_control).toEqual({ type: "ephemeral" });
  });

  it("autoCache marks system + first user message", () => {
    const msgs = [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const cached = autoCache(msgs);
    expect(cached[0].cache_control).toEqual({ type: "ephemeral" });
    expect(cached[1].cache_control).toEqual({ type: "ephemeral" });
    expect(cached[2].cache_control).toBeUndefined();
  });

  it("supportsCacheControl returns true for anthropic/openai", () => {
    expect(supportsCacheControl("anthropic")).toBe(true);
    expect(supportsCacheControl("openai")).toBe(true);
    expect(supportsCacheControl("google")).toBe(false);
  });
});
