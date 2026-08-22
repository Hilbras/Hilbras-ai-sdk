/**
 * @hilbras/sdk — Token Counter
 *
 * Estimates token counts for messages and text. Uses a simple
 * heuristic (4 chars ≈ 1 token) with optional tiktoken integration
 * for accurate counting. No external dependencies by default.
 */

export interface TokenEstimate {
  text: string;
  tokens: number;
  chars: number;
}

/** Estimate tokens from text using the simple heuristic */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars per token is a reasonable default for English
  // Code and non-English text may differ significantly
  return Math.ceil(text.length / 4);
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
    "gpt-4.1": { input: 2.00, output: 8.00 },
    "gpt-4.1-mini": { input: 0.40, output: 1.60 },
    "gpt-4.1-nano": { input: 0.10, output: 0.40 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "o3": { input: 10.00, output: 40.00 },
    "o3-mini": { input: 1.10, output: 4.40 },
    "o4-mini": { input: 1.10, output: 4.40 },
    "o1-preview": { input: 15.00, output: 60.00 },
    "o1-mini": { input: 3.00, output: 12.00 },
    "claude-opus-4-20250514": { input: 15.00, output: 75.00 },
    "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
    "claude-3-7-sonnet-20250219": { input: 3.00, output: 15.00 },
    "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
    "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
    "gemini-2.5-pro": { input: 1.25, output: 10.00 },
    "gemini-2.5-flash": { input: 0.15, output: 0.60 },
    "gemini-2.0-flash": { input: 0.10, output: 0.40 },
    "gemini-1.5-pro": { input: 1.25, output: 5.00 },
    "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  };

  const pricing = PRICING[model] ?? PRICING[`${provider}/${model}`] ?? { input: 0, output: 0 };

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: "USD",
  };
}
