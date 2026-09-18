import { describe, it, expect } from "vitest";
import {
  exportTrainingData,
  splitData,
  validateTrainingData,
  cleanTrainingData,
  deduplicateTrainingData,
} from "../src/index.js";
import type { TrainingExample, ConversationExample } from "../src/index.js";

const examples: TrainingExample[] = [
  { id: "1", input: "What is 2+2?", output: "The answer is 4" },
  { id: "2", input: "What is 3+3?", output: "The answer is 6" },
  { id: "3", input: "What is 5+5?", output: "The answer is 10" },
  { id: "4", input: "What is 10+10?", output: "The answer is 20" },
  { id: "5", input: "What is 7+7?", output: "The answer is 14" },
];

const conversations: ConversationExample[] = [
  {
    id: "1",
    messages: [
      { role: "system", content: "You are a math tutor." },
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
    ],
  },
  {
    id: "2",
    messages: [
      { role: "user", content: "What is 3+3?" },
      { role: "assistant", content: "6" },
    ],
  },
];

// ─── Export Formats ────────────────────────────────────────────────────────

describe("exportTrainingData", () => {
  it("exports openai-finetune format", () => {
    const result = exportTrainingData(examples, { format: "openai-finetune" });
    expect(result.format).toBe("openai-finetune");
    expect(result.count).toBe(5);
    expect(result.extension).toBe("jsonl");
    const lines = result.data.split("\n");
    expect(JSON.parse(lines[0])).toEqual({ prompt: "What is 2+2?", completion: "The answer is 4" });
  });

  it("exports openai-chat format", () => {
    const result = exportTrainingData(conversations, { format: "openai-chat" });
    expect(result.format).toBe("openai-chat");
    expect(result.count).toBe(2);
    const first = JSON.parse(result.data.split("\n")[0]);
    expect(first.messages[0].role).toBe("system");
  });

  it("exports anthropic format", () => {
    const result = exportTrainingData(conversations, { format: "anthropic" });
    expect(result.format).toBe("anthropic");
    const first = JSON.parse(result.data.split("\n")[0]);
    expect(first.messages.every((m: any) => m.role !== "system")).toBe(true);
    expect(first.system).toBe("You are a math tutor.");
  });

  it("exports csv format", () => {
    const result = exportTrainingData(examples, { format: "csv" });
    expect(result.extension).toBe("csv");
    const lines = result.data.split("\n");
    expect(lines[0]).toBe("input,output");
    expect(lines.length).toBe(6);
  });

  it("exports alpaca format", () => {
    const result = exportTrainingData(examples, { format: "alpaca" });
    expect(result.extension).toBe("json");
    const data = JSON.parse(result.data);
    expect(data[0]).toEqual({ instruction: "What is 2+2?", input: "", output: "The answer is 4" });
  });

  it("exports jsonl format", () => {
    const result = exportTrainingData(examples, { format: "jsonl" });
    expect(result.extension).toBe("jsonl");
    const lines = result.data.split("\n");
    expect(JSON.parse(lines[0]).input).toBe("What is 2+2?");
  });

  it("applies system prompt", () => {
    const result = exportTrainingData(examples, {
      format: "openai-finetune",
      systemPrompt: "You are a calculator.",
    });
    const first = JSON.parse(result.data.split("\n")[0]);
    expect(first.prompt).toContain("You are a calculator.");
  });

  it("applies filter", () => {
    const filtered = exportTrainingData(examples, {
      format: "jsonl",
      filter: { id: "1" },
    });
    // Only examples with matching metadata pass
    expect(filtered.count).toBe(0); // No metadata on these examples
  });

  it("applies limit", () => {
    const result = exportTrainingData(examples, { format: "jsonl", limit: 2 });
    expect(result.count).toBe(2);
  });

  it("throws on unknown format", () => {
    expect(() => exportTrainingData(examples, { format: "unknown" as any })).toThrow();
  });
});

// ─── Data Splitting ────────────────────────────────────────────────────────

describe("splitData", () => {
  it("splits with default ratios", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      input: `q${i}`,
      output: `a${i}`,
    }));
    const split = splitData(items);

    expect(split.train.length).toBe(80);
    expect(split.validation.length).toBe(10);
    expect(split.test.length).toBe(10);
  });

  it("splits with custom ratios", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      input: `q${i}`,
      output: `a${i}`,
    }));
    const split = splitData(items, { trainRatio: 0.7, valRatio: 0.2, testRatio: 0.1 });

    expect(split.train.length).toBe(70);
    expect(split.validation.length).toBe(20);
    expect(split.test.length).toBe(10);
  });

  it("is reproducible with seed", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      input: `q${i}`,
      output: `a${i}`,
    }));
    const split1 = splitData(items, { seed: 42 });
    const split2 = splitData(items, { seed: 42 });

    expect(split1.train.map((x) => x.input)).toEqual(split2.train.map((x) => x.input));
  });

  it("throws on invalid ratios", () => {
    expect(() => splitData(examples, { trainRatio: 0.5, valRatio: 0.5, testRatio: 0.5 })).toThrow();
  });
});

// ─── Quality ───────────────────────────────────────────────────────────────

describe("validateTrainingData", () => {
  it("passes on valid data", () => {
    const report = validateTrainingData(examples);
    expect(report.passed).toBe(true);
    expect(report.total).toBe(5);
  });

  it("detects empty inputs", () => {
    const data = [...examples, { input: "", output: "answer" }];
    const report = validateTrainingData(data);
    expect(report.checks.find((c) => c.name === "empty_inputs")?.passed).toBe(false);
  });

  it("detects empty outputs", () => {
    const data = [...examples, { input: "question", output: "" }];
    const report = validateTrainingData(data);
    expect(report.checks.find((c) => c.name === "empty_outputs")?.passed).toBe(false);
  });

  it("detects duplicates", () => {
    const data = [...examples, { input: "What is 2+2?", output: "also 4" }];
    const report = validateTrainingData(data);
    expect(report.checks.find((c) => c.name === "duplicates")?.passed).toBe(false);
  });
});

describe("cleanTrainingData", () => {
  it("removes empty examples", () => {
    const data = [
      ...examples,
      { input: "", output: "answer" },
      { input: "question", output: "" },
    ];
    const cleaned = cleanTrainingData(data);
    expect(cleaned.length).toBe(5);
  });
});

describe("deduplicateTrainingData", () => {
  it("removes duplicate inputs", () => {
    const data = [
      ...examples,
      { input: "What is 2+2?", output: "also 4" },
    ];
    const deduped = deduplicateTrainingData(data);
    expect(deduped.length).toBe(5);
  });
});
