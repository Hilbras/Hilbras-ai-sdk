/**
 * @hilbras/sdk — Token Counter
 *
 * Estimates token counts for messages and text. Uses a multi-heuristic
 * approach by default with optional pluggable tokenizer for accurate BPE counting.
 * No external dependencies by default.
 */

export interface TokenEstimate {
  text: string;
  tokens: number;
  chars: number;
}

/**
 * Pluggable tokenizer interface. Implement this to provide accurate
 * BPE tokenization (e.g., via tiktoken WASM or a custom tokenizer).
 */
export interface Tokenizer {
  /** Count tokens in a string */
  count(text: string): number;
}

let _customTokenizer: Tokenizer | null = null;

/**
 * Set a custom tokenizer for accurate token counting.
 * Pass null to reset to the default heuristic.
 *
 * @example
 * ```ts
 * import { setTokenizer } from "@hilbras/sdk";
 * // With tiktoken WASM
 * setTokenizer({ count: (text) => tiktoken.encode(text).length });
 * ```
 */
export function setTokenizer(tokenizer: Tokenizer | null): void {
  _customTokenizer = tokenizer;
}

/**
 * Get the currently active tokenizer (custom or null for default heuristic).
 */
export function getTokenizer(): Tokenizer | null {
  return _customTokenizer;
}

/**
 * Improved multi-heuristic token estimator.
 *
 * Rules of thumb (empirical, based on GPT-4/Claude tokenization):
 * - English text: ~4 chars/token for plain text, ~3.5 for mixed content
 * - Code: ~3 chars/token (shorter tokens due to syntax)
 * - CJK characters: ~1-2 tokens per character
 * - Whitespace-heavy text: closer to 4 chars/token
 * - JSON/structured: ~3 chars/token
 */
function improvedEstimate(text: string): number {
  if (!text) return 0;

  // Count character categories
  let cjkCount = 0;
  let alphaCount = 0;
  let digitCount = 0;
  let spaceCount = 0;
  let punctuationCount = 0;
  let otherCount = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjkCount++; // CJK Unified
    else if (code >= 0x3040 && code <= 0x309f) cjkCount++; // Hiragana
    else if (code >= 0x30a0 && code <= 0x30ff) cjkCount++; // Katakana
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) alphaCount++;
    else if (code >= 0x30 && code <= 0x39) digitCount++;
    else if (code === 0x20 || code === 0x0a || code === 0x0d) spaceCount++;
    else if (code >= 0x21 && code <= 0x2f || code >= 0x3a && code <= 0x40 || code >= 0x5b && code <= 0x60 || code >= 0x7b && code <= 0x7e) punctuationCount++;
    else otherCount++;
  }

  const total = text.length;

  // Pure CJK: ~1.5 tokens per character
  if (cjkCount === total) {
    return Math.ceil(cjkCount * 1.5);
  }

  // Mixed content: weighted estimate
  // CJK chars count as ~1.5 tokens each
  // Alpha/digit count as ~1 token per 3.5 chars
  // Spaces/punctuation count as ~1 token per 5 chars (they're often merged)
  const cjkTokens = cjkCount * 1.5;
  const alphaTokens = alphaCount / 3.5;
  const digitTokens = digitCount / 3;
  const spaceTokens = spaceCount / 6;
  const punctTokens = punctuationCount / 4;
  const otherTokens = otherCount / 4;

  const estimated = cjkTokens + alphaTokens + digitTokens + spaceTokens + punctTokens + otherTokens;

  // Add 10% buffer for subword splits and special tokens
  return Math.max(1, Math.ceil(estimated * 1.1));
}

/** Estimate tokens from text using the active tokenizer or improved heuristic */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (_customTokenizer) return _customTokenizer.count(text);
  return improvedEstimate(text);
}

/** Estimate tokens for a message array */
export function estimateMessageTokens(
  messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>
): TokenEstimate {
  let total = 0;
  let chars = 0;

  for (const msg of messages) {
    // Role overhead (~4 tokens per message for role + separator)
    total += 4;
    chars += (msg.role?.length ?? 0) + 2;

    // Content
    const content = msg.content ?? "";
    total += estimateTokens(content);
    chars += content.length;

    // Tool calls (if any)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(JSON.stringify(tc));
        chars += JSON.stringify(tc).length;
      }
    }
  }

  return { text: messages.map((m) => m.content ?? "").join(""), tokens: total, chars };
}

/** Estimate tokens for tool definitions */
export function estimateToolTokens(
  tools: Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>
): TokenEstimate {
  let total = 0;
  let chars = 0;

  for (const tool of tools) {
    total += estimateTokens(tool.function.name);
    total += estimateTokens(tool.function.description);
    total += estimateTokens(JSON.stringify(tool.function.parameters));
    chars += tool.function.name.length + tool.function.description.length + JSON.stringify(tool.function.parameters).length;
  }

  return { text: "", tokens: total, chars };
}

/** Calculate cost estimate based on provider and token counts */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  provider: string,
  model: string,
): { inputCost: number; outputCost: number; totalCost: number; currency: string } {
  // Approximate pricing per 1M tokens (USD)
  const PRICING: Record<string, { input: number; output: number }> = {
    "gpt-5.6-sol": { input: 4.00, output: 20.00 },
    "gpt-5.6-terra": { input: 2.00, output: 12.00 },
    "gpt-5.6-luna": { input: 0.20, output: 1.20 },
    "o3": { input: 10.00, output: 40.00 },
    "o3-mini": { input: 1.10, output: 4.40 },
    "o4-mini": { input: 1.10, output: 4.40 },
    "claude-fable-5": { input: 10.00, output: 50.00 },
    "claude-opus-5": { input: 5.00, output: 25.00 },
    "claude-sonnet-5": { input: 2.00, output: 10.00 },
    "claude-haiku-4-5": { input: 1.00, output: 5.00 },
    "gemini-3.7-flash": { input: 0.75, output: 3.75 },
    "gemini-3.6-flash": { input: 0.75, output: 3.75 },
    "gemini-3.5-flash": { input: 1.50, output: 9.00 },
    "gemini-3.5-flash-lite": { input: 0.30, output: 2.50 },
    "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 },
    "gemini-3.1-flash-lite": { input: 0.25, output: 1.50 },
    "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
    "gemini-2.5-pro": { input: 1.25, output: 10.00 },
    "gemini-2.5-flash": { input: 0.30, output: 2.50 },
    // Mistral
    "mistral-large-latest": { input: 2.00, output: 6.00 },
    "mistral-small-latest": { input: 0.10, output: 0.30 },
    "codestral-latest": { input: 0.30, output: 0.90 },
    // DeepSeek
    "deepseek-chat": { input: 0.27, output: 1.10 },
    "deepseek-reasoner": { input: 0.55, output: 2.19 },
    // xAI
    "grok-3": { input: 3.00, output: 15.00 },
    "grok-3-mini": { input: 0.30, output: 0.50 },
    // Cohere
    "command-r-plus-08-2024": { input: 2.50, output: 10.00 },
    "command-r-08-2024": { input: 0.15, output: 0.60 },
  };

  const pricing = PRICING[model] ?? PRICING[`${provider}/${model}`] ?? { input: 0, output: 0 };

  const inputCost = Math.max(0, (inputTokens / 1_000_000) * pricing.input);
  const outputCost = Math.max(0, (outputTokens / 1_000_000) * pricing.output);

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: "USD",
  };
}
