import { describe, it, expect } from "vitest";
import { evaluate, exactMatch, contains, similarity, toxicity, coherence, UnknownMetricError } from "../src/features/eval/index.js";
import type { EvalDataset, EvalDatasetItem } from "../src/features/eval/index.js";

// ─── Built-in Metrics ──────────────────────────────────────────────────────

describe("exactMatch", () => {
  it("passes on exact match", () => {
    const r = exactMatch("Paris", { id: "1", input: "Capital of France?", expected: "Paris" });
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it("fails on mismatch", () => {
    const r = exactMatch("London", { id: "1", input: "Capital of France?", expected: "Paris" });
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });

  it("is case-insensitive", () => {
    const r = exactMatch("paris", { id: "1", input: "Capital of France?", expected: "Paris" });
    expect(r.passed).toBe(true);
  });

  it("trims whitespace", () => {
    const r = exactMatch("  Paris  ", { id: "1", input: "Capital of France?", expected: "Paris" });
    expect(r.passed).toBe(true);
  });
});

describe("contains", () => {
  it("passes when output contains expected", () => {
    const r = contains("The capital is Paris, France", { id: "1", input: "", expected: "Paris" });
    expect(r.passed).toBe(true);
  });

  it("fails when output missing expected", () => {
    const r = contains("The capital is London", { id: "1", input: "", expected: "Paris" });
    expect(r.passed).toBe(false);
  });
});

describe("similarity", () => {
  it("scores high on similar text", () => {
    const r = similarity("The capital of France is Paris", {
      id: "1", input: "", expected: "Paris is the capital of France",
    });
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("scores low on dissimilar text", () => {
    const r = similarity("Quantum physics is complex", {
      id: "1", input: "", expected: "Paris is the capital of France",
    });
    expect(r.score).toBeLessThan(0.5);
  });
});

describe("toxicity", () => {
  it("passes on clean text", () => {
    const r = toxicity("Hello, how are you?", { id: "1", input: "" });
    expect(r.passed).toBe(true);
    expect(r.score).toBe(0);
  });

  it("fails on toxic text", () => {
    const r = toxicity("You are an idiot", { id: "1", input: "" });
    expect(r.passed).toBe(false);
    expect(r.score).toBe(1);
  });
});

describe("coherence", () => {
  it("passes on well-formed text", () => {
    const r = coherence("This is a sentence. This is another sentence. And a third.", { id: "1", input: "" });
    expect(r.passed).toBe(true);
  });
});

// ─── Evaluate Function ─────────────────────────────────────────────────────

describe("evaluate", () => {
  const dataset: EvalDataset = {
    name: "test-dataset",
    items: [
      { id: "1", input: "What is 2+2?", expected: "4" },
      { id: "2", input: "What is 3+3?", expected: "6" },
      { id: "3", input: "What is 5+5?", expected: "10" },
    ],
  };

  it("evaluates dataset with exact_match", async () => {
    const result = await evaluate({
      dataset,
      config: { metrics: [{ name: "exact_match" }] },
      generate: async (input) => {
        if (input.includes("2+2")) return "4";
        if (input.includes("3+3")) return "6";
        if (input.includes("5+5")) return "10";
        return "unknown";
      },
    });

    expect(result.passRate).toBe(1);
    expect(result.totalItems).toBe(3);
    expect(result.passedItems).toBe(3);
    expect(result.failedItems).toBe(0);
    expect(result.dataset).toBe("test-dataset");
  });

  it("tracks failures", async () => {
    const result = await evaluate({
      dataset,
      config: { metrics: [{ name: "exact_match" }] },
      generate: async () => "wrong answer",
    });

    expect(result.passRate).toBe(0);
    expect(result.failedItems).toBe(3);
  });

  it("computes aggregate scores", async () => {
    const result = await evaluate({
      dataset,
      config: { metrics: [{ name: "exact_match" }, { name: "contains" }] },
      generate: async (input) => {
        if (input.includes("2+2")) return "4";
        if (input.includes("3+3")) return "The answer is 6";
        return "10 is the result";
      },
    });

    expect(result.aggregates["exact_match"]).toBeGreaterThan(0);
    expect(result.aggregates["contains"]).toBe(1);
  });

  it("respects threshold", async () => {
    const result = await evaluate({
      dataset: {
        name: "threshold-test",
        items: [{ id: "1", input: "test", expected: "hello world" }],
      },
      config: { metrics: [{ name: "similarity", threshold: 0.9 }] },
      generate: async () => "goodbye universe",
    });

    expect(result.passRate).toBe(0);
  });

  it("handles generation errors", async () => {
    const result = await evaluate({
      dataset: {
        name: "error-test",
        items: [{ id: "1", input: "test", expected: "ok" }],
      },
      config: { metrics: [{ name: "exact_match" }] },
      generate: async () => { throw new Error("API error"); },
    });

    expect(result.failedItems).toBe(1);
    expect(result.items[0].error).toBe("API error");
  });

  it("reports unknown metric", async () => {
    await expect(
      evaluate({
        dataset: { name: "test", items: [{ id: "1", input: "x" }] },
        config: { metrics: [{ name: "nonexistent_metric" as any }] },
        generate: async () => "ok",
      })
    ).rejects.toThrow(UnknownMetricError);
  });

  it("fires events", async () => {
    const events: string[] = [];
    await evaluate({
      dataset: {
        name: "event-test",
        items: [{ id: "1", input: "test", expected: "ok" }],
      },
      config: {
        metrics: [{ name: "exact_match" }],
        onEvent: (e) => events.push(e.type),
      },
      generate: async () => "ok",
    });

    expect(events).toContain("item_start");
    expect(events).toContain("item_complete");
    expect(events).toContain("metric_complete");
    expect(events).toContain("complete");
  });

  it("handles empty dataset", async () => {
    const result = await evaluate({
      dataset: { name: "empty", items: [] },
      config: { metrics: [{ name: "exact_match" }] },
      generate: async () => "",
    });

    expect(result.totalItems).toBe(0);
    expect(result.passRate).toBe(0);
  });

  it("uses custom metric", async () => {
    const result = await evaluate({
      dataset: { name: "custom", items: [{ id: "1", input: "test", expected: "ok" }] },
      config: {
        metrics: [{
          name: "custom_length",
          custom: (output) => ({
            name: "custom_length",
            score: output.length > 0 ? 1 : 0,
            passed: output.length > 0,
          }),
        }],
      },
      generate: async () => "hello",
    });

    expect(result.passRate).toBe(1);
    expect(result.aggregates["custom_length"]).toBe(1);
  });
});
