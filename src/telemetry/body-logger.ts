/**
 * @hilbras/sdk — Body Logger
 *
 * Logs request/response bodies with automatic redaction of sensitive data.
 * Useful for debugging and audit trails.
 *
 * Usage:
 *   import { BodyLogger } from "@hilbras/sdk";
 *
 *   const bodyLogger = new BodyLogger({ level: "debug", maxBodyLength: 1000 });
 *   bodyLogger.logRequest("openai", "POST", "/v1/chat/completions", requestBody);
 *   bodyLogger.logResponse("openai", 200, responseBody);
 *
 *   // Get captured logs
 *   const logs = bodyLogger.getEntries();
 */

import { redact } from "../logging/logger.js";

/** Configuration for the body logger */
export interface BodyLoggerConfig {
  /** Minimum log level (default: "debug") */
  level?: "debug" | "info" | "warn" | "error";
  /** Maximum body length before truncation (default: 2000) */
  maxBodyLength?: number;
  /** Whether to redact sensitive data (default: true) */
  redact?: boolean;
  /** Custom destination function */
  destination?: (entry: BodyLogEntry) => void;
  /** Whether to enable body logging (default: true) */
  enabled?: boolean;
}

/** A logged request/response entry */
export interface BodyLogEntry {
  timestamp: string;
  type: "request" | "response" | "error";
  provider: string;
  method?: string;
  url?: string;
  status?: number;
  body: string;
  headers?: Record<string, string>;
  durationMs?: number;
}

/**
 * Captures and logs request/response bodies with redaction.
 */
export class BodyLogger {
  private _config: Required<BodyLoggerConfig>;
  private _entries: BodyLogEntry[] = [];
  private _maxEntries: number;

  constructor(config?: BodyLoggerConfig, maxEntries = 500) {
    this._config = {
      level: config?.level ?? "debug",
      maxBodyLength: config?.maxBodyLength ?? 2000,
      redact: config?.redact ?? true,
      destination: config?.destination ?? (() => {}),
      enabled: config?.enabled ?? true,
    };
    this._maxEntries = maxEntries;
  }

  /** Whether body logging is enabled */
  get enabled(): boolean {
    return this._config.enabled;
  }

  /** Enable or disable body logging */
  set enabled(value: boolean) {
    this._config.enabled = value;
  }

  /** Log a request body */
  logRequest(
    provider: string,
    method: string,
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): void {
    if (!this._config.enabled) return;

    let bodyStr = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    if (bodyStr.length > this._config.maxBodyLength) {
      bodyStr = bodyStr.slice(0, this._config.maxBodyLength) + "... [truncated]";
    }
    if (this._config.redact) bodyStr = redact(bodyStr);

    const entry: BodyLogEntry = {
      timestamp: new Date().toISOString(),
      type: "request",
      provider,
      method,
      url,
      body: bodyStr,
      headers: this._config.redact ? redactHeaders(headers) : headers,
    };

    this._addEntry(entry);
  }

  /** Log a response body */
  logResponse(
    provider: string,
    status: number,
    body: unknown,
    durationMs?: number,
  ): void {
    if (!this._config.enabled) return;

    let bodyStr = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    if (bodyStr.length > this._config.maxBodyLength) {
      bodyStr = bodyStr.slice(0, this._config.maxBodyLength) + "... [truncated]";
    }
    if (this._config.redact) bodyStr = redact(bodyStr);

    const entry: BodyLogEntry = {
      timestamp: new Date().toISOString(),
      type: "response",
      provider,
      status,
      body: bodyStr,
      durationMs,
    };

    this._addEntry(entry);
  }

  /** Log an error */
  logError(provider: string, error: unknown): void {
    if (!this._config.enabled) return;

    const bodyStr = error instanceof Error ? error.message : String(error);

    const entry: BodyLogEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      body: this._config.redact ? redact(bodyStr) : bodyStr,
    };

    this._addEntry(entry);
  }

  /** Get all captured log entries */
  getEntries(limit?: number): BodyLogEntry[] {
    if (limit) return this._entries.slice(-limit);
    return [...this._entries];
  }

  /** Clear all captured entries */
  clear(): void {
    this._entries = [];
  }

  /** Number of captured entries */
  get size(): number {
    return this._entries.length;
  }

  private _addEntry(entry: BodyLogEntry): void {
    this._entries.push(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(-this._maxEntries);
    }
    try {
      this._config.destination(entry);
    } catch {
      // Swallow destination errors
    }
  }
}

/** Redact sensitive headers (authorization, api keys) */
function redactHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower.includes("key") || lower.includes("token")) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
