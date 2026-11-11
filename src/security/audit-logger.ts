/**
 * @hilbras/sdk — SOC 2 Audit Logger
 *
 * Structured audit logging for SOC 2 compliance. Records authentication events,
 * data access, configuration changes, and security-relevant actions with
 * immutable append-only semantics.
 *
 * Usage:
 *   import { AuditLogger } from "@hilbras/sdk";
 *
 *   const audit = new AuditLogger({
 *     serviceName: "my-app",
 *     destination: (entry) => myAuditService.send(entry),
 *   });
 *
 *   audit.logAuth({ action: "login", userId: "user-1", success: true });
 *   audit.logDataAccess({ action: "read", resource: "provider-config", userId: "user-1" });
 *   audit.logConfigChange({ action: "add_provider", provider: "openai", userId: "admin" });
 */

import { redactPii } from "./pii-guard.js";
import { redact } from "../logging/logger.js";

/** Audit event categories */
export type AuditCategory = "auth" | "data_access" | "config_change" | "security" | "error";

/** Audit event severity */
export type AuditSeverity = "info" | "warning" | "critical";

/** Base audit entry fields */
interface AuditBase {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Unique event ID */
  eventId: string;
  /** Event category */
  category: AuditCategory;
  /** Severity level */
  severity: AuditSeverity;
  /** Service name */
  service: string;
  /** The action performed */
  action: string;
  /** User or principal who performed the action */
  userId?: string;
  /** Source IP address */
  sourceIp?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** Free-form description */
  description?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

/** Authentication audit entry */
export interface AuthAuditEntry extends AuditBase {
  category: "auth";
  /** Whether the auth attempt succeeded */
  success: boolean;
  /** Auth method used */
  method?: string;
  /** Failure reason (if !success) */
  reason?: string;
}

/** Data access audit entry */
export interface DataAccessAuditEntry extends AuditBase {
  category: "data_access";
  /** Resource accessed */
  resource: string;
  /** Access type */
  accessType: "read" | "write" | "delete";
}

/** Configuration change audit entry */
export interface ConfigChangeAuditEntry extends AuditBase {
  category: "config_change";
  /** What was changed */
  resource: string;
  /** Previous value (if applicable) */
  previousValue?: unknown;
  /** New value (if applicable) */
  newValue?: unknown;
}

/** Security event audit entry */
export interface SecurityAuditEntry extends AuditBase {
  category: "security";
  /** Security event type */
  eventType: "ssrf_blocked" | "rate_limit" | "circuit_breaker" | "invalid_input" | "pii_detected" | "custom";
}

/** Error audit entry */
export interface ErrorAuditEntry extends AuditBase {
  category: "error";
  /** The error message */
  error: string;
}

/** Union of all audit entry types */
export type AuditEntry = AuthAuditEntry | DataAccessAuditEntry | ConfigChangeAuditEntry | SecurityAuditEntry | ErrorAuditEntry;

/** Configuration for the audit logger */
export interface AuditLoggerConfig {
  /** Service name included in every entry */
  serviceName?: string;
  /** Custom destination function (default: console.log) */
  destination?: (entry: AuditEntry) => void;
  /** Whether to include source IP (default: false) */
  includeSourceIp?: boolean;
  /** Static fields included in every entry */
  defaultFields?: Record<string, unknown>;
  /** Whether to redact PII in descriptions (default: true) */
  redactPii?: boolean;
}

/** Monotonic counter for unique event IDs */
let _eventCounter = 0;

function generateEventId(): string {
  _eventCounter++;
  const ts = Date.now().toString(36);
  const cnt = _eventCounter.toString(36).padStart(4, "0");
  return `audit_${ts}_${cnt}`;
}

function cloneValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item, seen)) as T;
  if (value && typeof value === "object") {
    // Non-plain objects (Date, Map, Set, Error, class instances) are returned
    // as-is: walking them with Object.entries silently turned a Date into {}.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    if (seen.has(value)) return undefined as T; // circular reference — drop the branch
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item, seen);
    return result as T;
  }
  return value;
}

/**
 * Redact PII and credentials from every string in a value, nested objects and
 * arrays included. The logger previously redacted only `description`, so a
 * `meta` / `previousValue` / `newValue` / `error` field carrying a credential
 * was written verbatim to the log sink.
 *
 * Three passes, because no single one covers everything:
 * - a value under a credential-shaped key (`apiKey`, `token`, `password`, ...)
 *   is replaced outright — `ghp_...` and other opaque tokens carry no prefix a
 *   pattern can recognise;
 * - `redact` strips recognisable credential formats (`sk-`, `AKIA`, `AIza`, ...);
 * - `redactPii` strips emails, phone numbers, card numbers and so on.
 */
const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|apikey|credential|authorization|private[_-]?key|session[_-]?id)/i;

function redactDeep<T>(value: T, keyHint = ""): T {
  if (typeof value === "string") {
    if (keyHint && SENSITIVE_KEY.test(keyHint)) return "[REDACTED]" as unknown as T;
    return redact(redactPii(value)) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, keyHint)) as unknown as T;
  if (value && typeof value === "object") {
    // Non-plain objects (Date, Map, Error, ...) are not walked: it would
    // destroy them the same way `cloneValue` used to.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = redactDeep(item, key);
    return result as T;
  }
  return value;
}

function cloneEntry(entry: AuditEntry): AuditEntry {
  return cloneValue(entry);
}

/**
 * Immutable append-only audit logger for SOC 2 compliance.
 * All entries are structured JSON with unique IDs and timestamps.
 */
export class AuditLogger {
  private _config: Required<AuditLoggerConfig>;
  private _entries: AuditEntry[] = [];
  private _maxEntries: number;

  constructor(config?: AuditLoggerConfig, maxEntries = 10_000) {
    this._config = {
      serviceName: config?.serviceName ?? "hilbras-sdk",
      destination: config?.destination ?? ((entry) => console.log(JSON.stringify(entry))),
      includeSourceIp: config?.includeSourceIp ?? false,
      defaultFields: config?.defaultFields ?? {},
      redactPii: config?.redactPii ?? true,
    };
    this._maxEntries = maxEntries;
  }

  /** Log an authentication event */
  logAuth(event: {
    action: string;
    userId?: string;
    success: boolean;
    method?: string;
    reason?: string;
    sourceIp?: string;
    requestId?: string;
    description?: string;
    meta?: Record<string, unknown>;
  }): void {
    const entry = {
      ...this._base("auth", "info", event.action, event),
      success: event.success,
      method: event.method,
      reason: event.reason,
      severity: event.success ? "info" : "warning",
    } as AuthAuditEntry;
    this._emit(entry);
  }

  /** Log a data access event */
  logDataAccess(event: {
    action: string;
    resource: string;
    accessType: "read" | "write" | "delete";
    userId?: string;
    sourceIp?: string;
    requestId?: string;
    description?: string;
    meta?: Record<string, unknown>;
  }): void {
    const entry = {
      ...this._base("data_access", "info", event.action, event),
      resource: event.resource,
      accessType: event.accessType,
    } as DataAccessAuditEntry;
    this._emit(entry);
  }

  /** Log a configuration change event */
  logConfigChange(event: {
    action: string;
    resource: string;
    previousValue?: unknown;
    newValue?: unknown;
    userId?: string;
    sourceIp?: string;
    requestId?: string;
    description?: string;
    meta?: Record<string, unknown>;
  }): void {
    const entry = {
      ...this._base("config_change", "info", event.action, event),
      resource: event.resource,
      previousValue: event.previousValue,
      newValue: event.newValue,
    } as ConfigChangeAuditEntry;
    this._emit(entry);
  }

  /** Log a security event */
  logSecurity(event: {
    action: string;
    eventType: SecurityAuditEntry["eventType"];
    userId?: string;
    sourceIp?: string;
    requestId?: string;
    description?: string;
    severity?: AuditSeverity;
    meta?: Record<string, unknown>;
  }): void {
    const entry = {
      ...this._base("security", event.severity ?? "warning", event.action, event),
      eventType: event.eventType,
    } as SecurityAuditEntry;
    this._emit(entry);
  }

  /** Log an error event */
  logError(event: {
    action: string;
    error: string;
    userId?: string;
    requestId?: string;
    description?: string;
    meta?: Record<string, unknown>;
  }): void {
    const entry = {
      ...this._base("error", "critical", event.action, event),
      error: event.error,
    } as ErrorAuditEntry;
    this._emit(entry);
  }

  /** Get all audit entries (immutable copy) */
  getEntries(limit?: number): readonly AuditEntry[] {
    const entries = limit ? this._entries.slice(-limit) : this._entries;
    return entries.map(cloneEntry);
  }

  /** Get entries filtered by category */
  getByCategory(category: AuditCategory, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.category === category);
    return (limit ? filtered.slice(-limit) : filtered).map(cloneEntry);
  }

  /** Get entries filtered by severity */
  getBySeverity(severity: AuditSeverity, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.severity === severity);
    return (limit ? filtered.slice(-limit) : filtered).map(cloneEntry);
  }

  /** Get entries for a specific user */
  getByUser(userId: string, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.userId === userId);
    return (limit ? filtered.slice(-limit) : filtered).map(cloneEntry);
  }

  /** Get entries within a time range */
  getByTimeRange(start: Date, end: Date): readonly AuditEntry[] {
    const startTime = start.getTime();
    const endTime = end.getTime();
    return this._entries
      .filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= startTime && t <= endTime;
      })
      .map(cloneEntry);
  }

  /** Count entries by category */
  countByCategory(): Record<AuditCategory, number> {
    const counts: Record<AuditCategory, number> = {
      auth: 0,
      data_access: 0,
      config_change: 0,
      security: 0,
      error: 0,
    };
    for (const entry of this._entries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
    return counts;
  }

  /** Clear all entries (use with caution — audit logs should be immutable) */
  clear(): void {
    this._entries = [];
  }

  /** Remove entries older than the supplied timestamp and return the count. */
  pruneBefore(cutoff: Date | number): number {
    const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : cutoff;
    const before = this._entries.length;
    this._entries = this._entries.filter((entry) => new Date(entry.timestamp).getTime() >= cutoffTime);
    return before - this._entries.length;
  }

  /** Number of stored entries */
  get size(): number {
    return this._entries.length;
  }

  private _base(
    category: AuditCategory,
    severity: AuditSeverity,
    action: string,
    event: { userId?: string; sourceIp?: string; requestId?: string; description?: string; meta?: Record<string, unknown> },
  ): AuditBase & { category: AuditCategory } {
    return {
      timestamp: new Date().toISOString(),
      eventId: generateEventId(),
      category,
      severity,
      service: this._config.serviceName,
      action,
      userId: event.userId,
      sourceIp: this._config.includeSourceIp ? event.sourceIp : undefined,
      requestId: event.requestId,
      description: event.description,
      meta: { ...this._config.defaultFields, ...event.meta },
    };
  }

  private _emit(entry: AuditEntry): void {
    const cloned = cloneEntry(entry);
    const stored = this._config.redactPii ? redactDeep(cloned) : cloned;
    this._entries.push(stored);
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(-this._maxEntries);
    }
    try {
      this._config.destination(cloneEntry(stored));
    } catch {
      // Swallow destination errors — audit logging must never break the SDK
    }
  }
}

/**
 * Creates a data retention policy that purges entries older than the
 * specified duration.
 */
export function createRetentionPolicy(
  logger: AuditLogger,
  maxAgeMs: number,
): { purge: () => number; schedule: (intervalMs: number) => () => void } {
  return {
    purge: () => {
      const cutoff = Date.now() - maxAgeMs;
      return logger.pruneBefore(cutoff);
    },
    schedule: (intervalMs: number) => {
      const timer = setInterval(() => {
        createRetentionPolicy(logger, maxAgeMs).purge();
      }, intervalMs);
      return () => clearInterval(timer);
    },
  };
}
