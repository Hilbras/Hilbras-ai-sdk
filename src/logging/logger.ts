/**
 * @hilbras/sdk — Request/Response Logger
 *
 * Logs API requests and responses for debugging.
 * Redacts sensitive fields (API keys, tokens) automatically.
 * Can be enabled/disabled at runtime.
 */

export interface LogEntry {
  timestamp: number;
  type: "request" | "response" | "error";
  provider: string;
  model?: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  tokens?: { input: number; output: number };
  error?: string;
  body?: string;
}

export type LogLevel = "none" | "error" | "info" | "debug";

const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[=:]\s*["']?[A-Za-z0-9\-_]{20,}["']?/gi,
  /bearer\s+[A-Za-z0-9\-_.]{20,}/gi,
  /x-api-key\s*[=:]\s*["']?[A-Za-z0-9\-_]{20,}["']?/gi,
  // OpenAI/Anthropic/Groq key shapes: sk-..., sk-proj-..., sk-ant-...
  // Conservative: match `sk-` followed by 20+ word chars, anchored at a word
  // boundary so "sketch" or "sk-" inside an unrelated word is unaffected.
  /\bsk-[A-Za-z0-9\-_]{20,}/g,
  // Generic JSON "key"/"token"/"secret"/"password" field values.
  /"(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|token|apiKey|accessToken|authToken)"\s*:\s*"[^"]*"/gi,
];

/**
 * Redact sensitive substrings (API keys, bearer tokens, JSON secret fields)
 * from arbitrary text. Idempotent and safe to call on already-redacted text.
 */
export function redact(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Preserve the leading quote/structure for JSON-shaped patterns so the
      // surrounding JSON remains syntactically valid. For "sk-..." patterns,
      // we redact the whole token.
      if (match.startsWith('"')) {
        return match.replace(/("[^"]*"\s*:\s*)"[^"]*"/, '$1"[REDACTED]"');
      }
      return "[REDACTED]";
    });
  }
  return result;
}

class SDKLogger {
  private _level: LogLevel = "none";
  private _entries: LogEntry[] = [];
  private _maxEntries = 1000;

  setLevel(level: LogLevel): void { this._level = level; }
  getLevel(): LogLevel { return this._level; }

  log(entry: Omit<LogEntry, "timestamp">): void {
    if (this._level === "none") return;
    if (entry.type === "error" && this._level !== "error" && this._level !== "info" && this._level !== "debug") return;
    if (entry.type !== "error" && this._level !== "info" && this._level !== "debug") return;

    const full: LogEntry = { ...entry, timestamp: Date.now() };
    this._entries.push(full);
    if (this._entries.length > this._maxEntries) this._entries.shift();

    if (this._level === "debug") {
      const prefix = `[SDK:${entry.provider}]`;
      if (entry.type === "request") {
        console.debug(`${prefix} → ${entry.method} ${entry.url}`);
        if (entry.body) console.debug(`  body: ${redact(entry.body).slice(0, 200)}`);
      } else if (entry.type === "response") {
        console.debug(`${prefix} ← ${entry.status} (${entry.durationMs}ms)`);
      } else if (entry.type === "error") {
        console.error(`${prefix} ✗ ${entry.error}`);
      }
    }
  }

  getEntries(limit?: number): LogEntry[] {
    return limit ? this._entries.slice(-limit) : [...this._entries];
  }

  clear(): void { this._entries = []; }
}

export const sdkLogger = new SDKLogger();
