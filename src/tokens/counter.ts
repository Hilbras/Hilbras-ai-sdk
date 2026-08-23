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
