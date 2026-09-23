/** Fields owned by the SDK/adapters and not overrideable through provider extras. */
const RESERVED_FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "max_tokens",
  "max_output_tokens",
  "maxTokens",
  "tools",
  "tool_choice",
  "contents",
  "generationConfig",
  "system",
  "input",
  "prompt",
  "options",
]);

export function assertExtraFieldAllowed(key: string): void {
  if (key === "__proto__" || key === "prototype" || key === "constructor") {
    throw new Error(`Unsafe provider extra field: ${key}`);
  }
  if (RESERVED_FIELDS.has(key)) {
    throw new Error(`Provider extra cannot override reserved field: ${key}`);
  }
}

export function mergeExtraParams(body: Record<string, unknown>, extra?: Record<string, unknown>): void {
  if (!extra) return;
  for (const [key, value] of Object.entries(extra)) {
    assertExtraFieldAllowed(key);
    body[key] = value;
  }
}
