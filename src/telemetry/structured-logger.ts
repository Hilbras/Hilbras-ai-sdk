/**
 * @hilbras/sdk — Structured Logger
 *
 * JSON-structured logging for production environments.
 * Outputs newline-delimited JSON (NDJSON) for easy log aggregation.
 *
 * Usage:
 *   import { StructuredLogger } from "@hilbras/sdk";
 *
 *   const logger = new StructuredLogger({ serviceName: "my-app", level: "info" });
 *   client.on("request.completed", (e) => logger.logRequest(e));
 *   client.on("request.failed", (e) => logger.logError(e));
 *
 *   // Or pipe to your own destination
 *   const logger = new StructuredLogger({
 *     destination: (entry) => myLogService.send(entry),
 *   });
 */

import type { HookEvent, RequestCompletedEvent, RequestFailedEvent, RetryEvent, StreamFirstChunkEvent } from "../types/observability.js";
import { redact } from "../logging/logger.js";

/** Log entry severity levels */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Configuration for the structured logger */
export interface StructuredLoggerConfig {
  /** Service name included in every log entry */
  serviceName?: string;
  /** Minimum log level (default: "info") */
  level?: LogLevel;
  /** Custom destination function (default: console.log) */
  destination?: (entry: StructuredLogEntry) => void;
  /** Whether to redact sensitive data (default: true) */
  redact?: boolean;
  /** Additional static fields included in every entry */
  defaultFields?: Record<string, unknown>;
}

/** A structured log entry */
export interface StructuredLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Log category */
  category: string;
  /** Service name */
  service: string;
  /** Request ID (if applicable) */
  requestId?: string;
  /** Provider name */
  provider?: string;
  /** Model name */
  model?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Token counts */
  tokens?: { input?: number; output?: number; total?: number };
  /** Error message */
  error?: string;
  /** Whether the request was successful */
  success?: boolean;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured JSON logger for production environments.
 * Outputs NDJSON (newline-delimited JSON) for easy log aggregation.
 */
export class StructuredLogger {
  private _config: Required<StructuredLoggerConfig>;

  constructor(config?: StructuredLoggerConfig) {
    this._config = {
      serviceName: config?.serviceName ?? "hilbras-sdk",
      level: config?.level ?? "info",
      destination: config?.destination ?? ((entry) => console.log(JSON.stringify(entry))),
      redact: config?.redact ?? true,
      defaultFields: config?.defaultFields ?? {},
    };
  }

  /** Get the current log level */
  get level(): LogLevel {
    return this._config.level;
  }

  /** Set the log level at runtime */
  set level(level: LogLevel) {
    this._config.level = level;
  }

  /** Log a raw structured entry */
  log(level: LogLevel, category: string, data: Partial<StructuredLogEntry>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this._config.level]) return;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      service: this._config.serviceName,
      ...this._config.defaultFields,
      ...data,
    };

    if (this._config.redact) {
      this._redactEntry(entry);
    }

    try {
      this._config.destination(entry);
    } catch {
      // Swallow destination errors to never break the SDK
    }
  }

  /** Log a completed request */
  logRequest(event: RequestCompletedEvent): void {
    this.log("info", "request", {
      requestId: event.requestId,
      provider: event.provider,
      model: event.model,
      durationMs: event.durationMs,
      tokens: {
        input: event.inputTokens,
        output: event.outputTokens,
        total: (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
      },
      success: true,
      meta: { attempts: event.attempts, structuredOutput: event.structuredOutput },
    });
  }

  /** Log a failed request */
  logError(event: RequestFailedEvent): void {
    this.log("error", "request", {
      requestId: event.requestId,
      provider: event.provider,
      model: event.model,
      durationMs: event.durationMs,
      error: event.error,
      success: false,
      meta: { attempts: event.attempts },
    });
  }

  /** Log a retry event */
  logRetry(event: RetryEvent): void {
    this.log("warn", "retry", {
      requestId: event.requestId,
      provider: event.provider,
      meta: { attempt: event.attempt, delayMs: event.delayMs, reason: event.reason },
    });
  }

  /** Log a first-chunk latency event */
  logFirstChunk(event: StreamFirstChunkEvent): void {
    this.log("debug", "stream", {
      requestId: event.requestId,
      durationMs: event.latencyMs,
    });
  }

  /** Log a debug message */
  debug(category: string, data: Partial<StructuredLogEntry>): void {
    this.log("debug", category, data);
  }

  /** Log an info message */
  info(category: string, data: Partial<StructuredLogEntry>): void {
    this.log("info", category, data);
  }

  /** Log a warning message */
  warn(category: string, data: Partial<StructuredLogEntry>): void {
    this.log("warn", category, data);
  }

  /** Log an error message */
  error(category: string, data: Partial<StructuredLogEntry>): void {
    this.log("error", category, data);
  }

  /**
   * Automatically instrument a HilbrasClient by subscribing to hook events.
   * Returns an unsubscribe function.
   */
  instrumentClient(client: { on: (event: string, listener: (e: HookEvent) => void) => () => void }): () => void {
    const unsub1 = client.on("request.completed", (e) => {
      if (e.type === "request.completed") this.logRequest(e);
    });
    const unsub2 = client.on("request.failed", (e) => {
      if (e.type === "request.failed") this.logError(e);
    });
    const unsub3 = client.on("request.retrying", (e) => {
      if (e.type === "request.retrying") this.logRetry(e);
    });
    const unsub4 = client.on("stream.first_chunk", (e) => {
      if (e.type === "stream.first_chunk") this.logFirstChunk(e);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }

  private _redactEntry(entry: StructuredLogEntry): void {
    if (entry.error) entry.error = redact(entry.error);
    if (entry.meta) {
      for (const [key, value] of Object.entries(entry.meta)) {
        if (typeof value === "string") {
          entry.meta[key] = redact(value);
        }
      }
    }
  }
}
