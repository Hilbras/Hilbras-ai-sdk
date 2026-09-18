/**
 * @hilbras/fine-tune — Formatters
 *
 * Format training data for different providers.
 */

import type { TrainingExample, ConversationExample, TrainingFormat, ExportResult, ExportOptions } from "./types.js";

function filterExamples(examples: TrainingExample[], options: ExportOptions): TrainingExample[] {
  let filtered = [...examples];

  if (options.filter) {
    filtered = filtered.filter((ex) => {
      if (!ex.metadata) return false;
      return Object.entries(options.filter!).every(([k, v]) => ex.metadata![k] === v);
    });
  }

  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

function filterConversations(examples: ConversationExample[], options: ExportOptions): ConversationExample[] {
  let filtered = [...examples];

  if (options.filter) {
    filtered = filtered.filter((ex) => {
      if (!ex.metadata) return false;
      return Object.entries(options.filter!).every(([k, v]) => ex.metadata![k] === v);
    });
  }

  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

/**
 * Export training examples in the specified format.
 */
export function exportTrainingData(
  examples: (TrainingExample | ConversationExample)[],
  options: ExportOptions
): ExportResult {
  const { format } = options;

  switch (format) {
    case "openai-finetune":
      return exportOpenAIFineTune(examples as TrainingExample[], options);
    case "openai-chat":
      return exportOpenAIChat(examples as ConversationExample[], options);
    case "anthropic":
      return exportAnthropic(examples as ConversationExample[], options);
    case "jsonl":
      return exportJSONL(examples, options);
    case "csv":
      return exportCSV(examples as TrainingExample[], options);
    case "alpaca":
      return exportAlpaca(examples as TrainingExample[], options);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

function exportOpenAIFineTune(examples: TrainingExample[], options: ExportOptions): ExportResult {
  const filtered = filterExamples(examples, options);
  const lines = filtered.map((ex) => {
    const prompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${ex.input}`
      : ex.input;
    return JSON.stringify({ prompt, completion: ex.output });
  });

  return {
    format: "openai-finetune",
    count: lines.length,
    data: lines.join("\n"),
    extension: "jsonl",
  };
}

function exportOpenAIChat(examples: ConversationExample[], options: ExportOptions): ExportResult {
  const filtered = filterConversations(examples, options);
  const lines = filtered.map((ex) => {
    const messages = [...ex.messages];
    if (options.systemPrompt && !messages.some((m) => m.role === "system")) {
      messages.unshift({ role: "system", content: options.systemPrompt });
    }
    return JSON.stringify({ messages });
  });

  return {
    format: "openai-chat",
    count: lines.length,
    data: lines.join("\n"),
    extension: "jsonl",
  };
}

function exportAnthropic(examples: ConversationExample[], options: ExportOptions): ExportResult {
  const filtered = filterConversations(examples, options);
  const lines = filtered.map((ex) => {
    const messages = ex.messages.filter((m) => m.role !== "system");
    const system = options.systemPrompt || ex.messages.find((m) => m.role === "system")?.content;
    return JSON.stringify({ messages, system });
  });

  return {
    format: "anthropic",
    count: lines.length,
    data: lines.join("\n"),
    extension: "jsonl",
  };
}

function filterJSONL(examples: (TrainingExample | ConversationExample)[], options: ExportOptions): (TrainingExample | ConversationExample)[] {
  let filtered = [...examples];

  if (options.filter) {
    filtered = filtered.filter((ex) => {
      const meta = "metadata" in ex ? ex.metadata : undefined;
      if (!meta) return false;
      return Object.entries(options.filter!).every(([k, v]) => meta[k] === v);
    });
  }

  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

function exportJSONL(examples: (TrainingExample | ConversationExample)[], options: ExportOptions): ExportResult {
  const filtered = filterJSONL(examples, options);
  const lines = filtered.map((ex) => JSON.stringify(ex));

  return {
    format: "jsonl",
    count: lines.length,
    data: lines.join("\n"),
    extension: "jsonl",
  };
}

function exportCSV(examples: TrainingExample[], options: ExportOptions): ExportResult {
  const filtered = filterExamples(examples, options);
  const header = "input,output";
  const rows = filtered.map((ex) => {
    const input = ex.input.replace(/"/g, '""');
    const output = ex.output.replace(/"/g, '""');
    return `"${input}","${output}"`;
  });

  return {
    format: "csv",
    count: rows.length,
    data: [header, ...rows].join("\n"),
    extension: "csv",
  };
}

function exportAlpaca(examples: TrainingExample[], options: ExportOptions): ExportResult {
  const filtered = filterExamples(examples, options);
  const data = filtered.map((ex) => ({
    instruction: ex.input,
    input: "",
    output: ex.output,
  }));

  return {
    format: "alpaca",
    count: data.length,
    data: JSON.stringify(data, null, 2),
    extension: "json",
  };
}
