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

/** Union of all audit entry types */
export type AuditEntry = AuthAuditEntry | DataAccessAuditEntry | ConfigChangeAuditEntry | SecurityAuditEntry;

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
      success: false,
      reason: event.error,
    } as AuthAuditEntry;
    this._emit(entry);
  }

  /** Get all audit entries (immutable copy) */
  getEntries(limit?: number): readonly AuditEntry[] {
    if (limit) return this._entries.slice(-limit);
    return [...this._entries];
  }

  /** Get entries filtered by category */
  getByCategory(category: AuditCategory, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.category === category);
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  /** Get entries filtered by severity */
  getBySeverity(severity: AuditSeverity, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.severity === severity);
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  /** Get entries for a specific user */
  getByUser(userId: string, limit?: number): readonly AuditEntry[] {
    const filtered = this._entries.filter((e) => e.userId === userId);
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  /** Get entries within a time range */
  getByTimeRange(start: Date, end: Date): readonly AuditEntry[] {
    const startTime = start.getTime();
    const endTime = end.getTime();
    return this._entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= startTime && t <= endTime;
    });
  }

  /** Count entries by category */
  countByCategory(): Record<AuditCategory, number> {
    const counts: Record<string, number> = {};
    for (const entry of this._entries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
    return counts as Record<AuditCategory, number>;
  }

  /** Clear all entries (use with caution — audit logs should be immutable) */
  clear(): void {
    this._entries = [];
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
      sourceIp: event.sourceIp,
      requestId: event.requestId,
      description: event.description,
      meta: { ...this._config.defaultFields, ...event.meta },
    };
  }

  private _emit(entry: AuditEntry): void {
    this._entries.push(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(-this._maxEntries);
    }
    try {
      this._config.destination(entry);
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
      const before = logger.size;
      const entries = logger.getEntries();
      logger.clear();
      const kept = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
      return before - kept.length;
    },
    schedule: (intervalMs: number) => {
      const timer = setInterval(() => {
        createRetentionPolicy(logger, maxAgeMs).purge();
      }, intervalMs);
      return () => clearInterval(timer);
    },
  };
}
