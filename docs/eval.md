# Evaluation Framework

`@hilbras/sdk` provides LLM output evaluation with built-in metrics and custom metric support.

## Installation

```bash
npm install @hilbras/sdk
```

## Quick Start

```typescript
import { evaluate } from "@hilbras/eval";

const result = await evaluate({
  dataset: {
    name: "math-qa",
    items: [
      { id: "1", input: "What is 2+2?", expected: "4" },
      { id: "2", input: "What is 3+3?", expected: "6" },
    ],
  },
  config: {
    metrics: [
      { name: "exact_match", threshold: 1 },
      { name: "contains", threshold: 0.5 },
    ],
  },
  generate: async (input) => {
    return llm.complete(input);
  },
});

console.log(result.passRate);     // 1.0
console.log(result.totalItems);   // 2
console.log(result.aggregates);   // { exact_match: 1, contains: 1 }
```

## Built-in Metrics

| Metric | Description | Score Range |
|--------|-------------|-------------|
| `exact_match` | Case-insensitive exact string match | 0 or 1 |
| `contains` | Output contains expected substring | 0 or 1 |
| `similarity` | Jaccard word overlap similarity | 0-1 |
| `toxicity` | Detects common toxic phrases | 0 (clean) or 1 (toxic) |
| `coherence` | Simple sentence structure analysis | 0-1 |
| `llm_judge` | Uses LLM to evaluate output | 0-1 |

## Custom Metrics

```typescript
import { evaluate, type MetricResult } from "@hilbras/eval";

const result = await evaluate({
  dataset: { name: "test", items: [...] },
  config: {
    metrics: [{
      name: "word_count",
      threshold: 0.5,
      custom: (output, item): MetricResult => {
        const words = output.split(/\s+/).length;
        const score = words >= 10 && words <= 100 ? 1 : 0;
        return { name: "word_count", score, passed: score >= 0.5 };
      },
    }],
  },
  generate: async (input) => llm.complete(input),
});
```

## LLM-as-Judge

```typescript
import { evaluate, llmJudge } from "@hilbras/eval";

const judgeLLM = async (messages) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o", messages }),
  });
  const data = await response.json();
  return { content: data.choices[0].message.content };
};

const result = await evaluate({
  dataset: { name: "test", items: [...] },
  config: {
    metrics: [{ name: "relevance", threshold: 0.7, custom: llmJudge(judgeLLM) }],
  },
  generate: async (input) => llm.complete(input),
});
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | 5 | Max parallel evaluations |
| `signal` | undefined | AbortSignal for cancellation |
| `onEvent` | undefined | Event listener for progress |

---

## A/B Prompt Testing — v3.0.0

Compare multiple prompt variants against a shared dataset to find the
best-performing system prompt.

```typescript
import { runABTest } from "@hilbras/sdk";

const result = await runABTest(client, {
  variants: [
    { name: "concise", systemPrompt: "Answer concisely in one sentence." },
    { name: "detailed", systemPrompt: "Answer in detail with examples and context." },
    { name: "friendly", systemPrompt: "Answer in a warm, friendly tone." },
  ],
  dataset: [
    { id: "1", input: "What is 2+2?", expected: "4" },
    { id: "2", input: "Capital of France?", expected: "Paris" },
    { id: "3", input: "What is photosynthesis?", expected: "process by which plants convert light to energy" },
  ],
});

console.log(`Winner: ${result.winner.name} (${(result.winner.aggregateScore * 100).toFixed(1)}%)`);
console.log(`Margin: ${(result.margin * 100).toFixed(1)}% over runner-up`);

for (const v of result.variants) {
  console.log(`  ${v.name}: ${(v.aggregateScore * 100).toFixed(1)}%`);
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `metrics` | `[{ name: "exact_match" }, { name: "contains" }]` | Metric configurations |
| `concurrency` | 5 | Max parallel evaluations per variant |
| `signal` | undefined | AbortSignal for cancellation |

### Variant options

| Option | Description |
|--------|-------------|
| `name` | Display name for the variant |
| `systemPrompt` | The system prompt to test |
| `model` | Model override (uses client default if omitted) |
| `provider` | Provider override |
| `temperature` | Temperature override |
| `maxTokens` | Max tokens override |
