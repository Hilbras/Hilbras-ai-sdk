# Fine-tuning Helpers

`@hilbras/fine-tune` provides training data export, formatting, validation, and splitting.

## Installation

```bash
npm install @hilbras/fine-tune
```

## Export Training Data

```typescript
import { exportTrainingData } from "@hilbras/fine-tune";

const examples = [
  { input: "What is 2+2?", output: "The answer is 4" },
  { input: "What is 3+3?", output: "The answer is 6" },
];

// OpenAI fine-tuning format
const result = exportTrainingData(examples, { format: "openai-finetune" });
// result.data → JSONL with { prompt, completion }

// OpenAI chat format
const chat = exportTrainingData(conversations, { format: "openai-chat" });
// result.data → JSONL with { messages }

// Anthropic format
const anthropic = exportTrainingData(conversations, { format: "anthropic" });

// CSV format
const csv = exportTrainingData(examples, { format: "csv" });

// Alpaca format (for Llama, etc.)
const alpaca = exportTrainingData(examples, { format: "alpaca" });
```

## Supported Formats

| Format | Output | Use Case |
|--------|--------|----------|
| `openai-finetune` | `{ prompt, completion }` | OpenAI fine-tuning API |
| `openai-chat` | `{ messages }` | OpenAI chat fine-tuning |
| `anthropic` | `{ messages, system }` | Anthropic fine-tuning |
| `jsonl` | Raw JSONL | Generic |
| `csv` | CSV | Spreadsheet import |
| `alpaca` | `{ instruction, input, output }` | Llama, Alpaca format |

## Data Splitting

```typescript
import { splitData } from "@hilbras/fine-tune";

const split = splitData(examples, {
  trainRatio: 0.8,
  valRatio: 0.1,
  testRatio: 0.1,
  seed: 42, // reproducible
});

console.log(split.train.length);      // 80
console.log(split.validation.length); // 10
console.log(split.test.length);       // 10
```

## Quality Validation

```typescript
import { validateTrainingData } from "@hilbras/fine-tune";

const report = validateTrainingData(examples);
console.log(report.passed); // true/false
console.log(report.checks); // Array of QualityCheck

// Each check:
// - empty_inputs: No empty input strings
// - empty_outputs: No empty output strings
// - duplicates: No duplicate inputs
// - too_long: No examples >10k chars
// - short_outputs: <10% with <5 char outputs
```

## Data Cleaning

```typescript
import { cleanTrainingData, deduplicateTrainingData } from "@hilbras/fine-tune";

// Remove empty examples
const cleaned = cleanTrainingData(examples);

// Remove duplicate inputs
const deduped = deduplicateTrainingData(examples);
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `format` | — | Export format (required) |
| `systemPrompt` | — | System prompt to add to all examples |
| `filter` | — | Filter by metadata key-value pairs |
| `limit` | 0 | Max examples to export (0 = no limit) |
