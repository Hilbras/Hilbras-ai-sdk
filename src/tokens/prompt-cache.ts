/**
 * @hilbras/sdk — Prompt Caching Support
 *
 * Anthropic and OpenAI support prompt caching to reduce costs and latency.
 * This module helps identify cache-eligible content and builds the
 * appropriate metadata for cache control.
 *
 * Anthropic: cache_control: { type: "ephemeral" } on messages
 * OpenAI: cache_control on content blocks
 */

export interface CacheControl {
  type: "ephemeral";
}

export interface CacheableMessage {
  role: string;
  content: string;
  cache_control?: CacheControl;
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown[];
}

/**
 * Mark a system message for caching. The system prompt is typically
 * repeated every request, making it the best cache candidate.
 */
export function cacheSystemMessage(
  messages: Array<{ role: string; content: string | null }>
): CacheableMessage[] {
  return messages.map((m, i) => {
    if (m.role === "system") {
      return { ...m, content: m.content ?? "", cache_control: { type: "ephemeral" } };
    }
    return { ...m, content: m.content ?? "" };
  });
}

/**
 * Mark the last N messages for caching. Useful when the conversation
 * has a stable prefix (system + context) that should be cached.
 */
export function cacheLastN(
  messages: CacheableMessage[],
  n: number
): CacheableMessage[] {
  if (n <= 0) return messages;
  const startIdx = Math.max(0, messages.length - n);
  return messages.map((m, i) => {
    if (i >= startIdx) {
      return { ...m, cache_control: { type: "ephemeral" } };
    }
    return { ...m, cache_control: undefined };
  });
}

/**
 * Mark a specific message by index for caching.
 */
export function cacheAtIndex(
  messages: CacheableMessage[],
  index: number
): CacheableMessage[] {
  return messages.map((m, i) => {
    if (i === index) {
      return { ...m, cache_control: { type: "ephemeral" } };
    }
    return { ...m, cache_control: undefined };
  });
}

/**
 * Build cache-eligible messages from a message array.
 * Automatically caches the system message and the first user message
 * (which typically contains the task description).
 */
export function autoCache(messages: Array<{ role: string; content: string | null }>): CacheableMessage[] {
  return messages.map((m, i) => {
    if (m.role === "system" || (m.role === "user" && i === 1)) {
      return { ...m, content: m.content ?? "", cache_control: { type: "ephemeral" } };
    }
    return { ...m, content: m.content ?? "" };
  });
}

/**
 * Check if a provider supports prompt caching.
 */
export function supportsCacheControl(provider: string): boolean {
  // Anthropic and OpenAI both support prompt caching
  return ["anthropic", "openai"].includes(provider);
}
