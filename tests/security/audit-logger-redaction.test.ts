/**
 * @hilbras/sdk — Audit logger redaction and cloning (B1, H3, H4)
 *
 * The logger redacted only `description`, so a credential in `meta`,
 * `previousValue`, `newValue`, or `error` was written verbatim to the sink.
 */

import { describe, it, expect } from "vitest";
import { AuditLogger } from "../../src/security/audit-logger.js";
import type { AuditEntry } from "../../src/security/audit-logger.js";

const API_KEY = "sk-abcdefghijklmnopqrstuvwxyz0123";
const OPAQUE_TOKEN = "ghp_OPAQUETOKENVALUE1234567890";

function capture(): { logger: AuditLogger; entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  const logger = new AuditLogger({ destination: (entry) => entries.push(entry) });
  return { logger, entries };
}

describe("AuditLogger credential redaction", () => {
  it("redacts a credential stored under a credential-shaped key", () => {
    const { logger, entries } = capture();

    logger.logConfigChange({
      action: "add_provider",
      resource: "openai",
      newValue: { apiKey: API_KEY },
      meta: { token: OPAQUE_TOKEN },
    });

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(OPAQUE_TOKEN);

    const stored = logger.getEntries()[0] as unknown as { newValue: { apiKey: string }; meta: { token: string } };
    expect(stored.newValue.apiKey).toBe("[REDACTED]");
    expect(stored.meta.token).toBe("[REDACTED]");
  });

  it("redacts a recognisable key format inside the error field", () => {
    const { logger, entries } = capture();

    logger.logError({ action: "provider_call", error: `HTTP 401 for key ${API_KEY}` });

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).toContain("[REDACTED]");
  });

  it("redacts nested credentials and still redacts PII", () => {
    const { logger, entries } = capture();

    logger.logSecurity({
      action: "policy_check",
      eventType: "custom",
      meta: { config: { nested: { password: "hunter2xyz" } }, contact: "someone@example.com" },
    });

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain("hunter2xyz");
    expect(serialized).not.toContain("someone@example.com");
    expect(serialized).toContain("[EMAIL]");
  });

  it("leaves non-sensitive fields alone", () => {
    const { logger, entries } = capture();

    logger.logAuth({ action: "login", userId: "user-1", success: true, meta: { role: "viewer" } });

    const entry = entries[0] as unknown as { userId: string; meta: { role: string } };
    expect(entry.userId).toBe("user-1");
    expect(entry.meta.role).toBe("viewer");
  });
});

describe("AuditLogger cloning", () => {
  it("preserves non-plain values such as Date instead of flattening them to {}", () => {
    const { logger } = capture();
    const when = new Date("2026-01-01T00:00:00.000Z");

    logger.logConfigChange({ action: "rotate", resource: "openai", previousValue: when });

    const stored = logger.getEntries()[0] as unknown as { previousValue: unknown };
    expect(stored.previousValue).toBeInstanceOf(Date);
    expect((stored.previousValue as Date).toISOString()).toBe(when.toISOString());
  });

  it("detaches a cyclic value from the caller", () => {
    const { logger } = capture();
    const shared: Record<string, unknown> = { x: 1 };
    shared.self = shared;

    logger.logAuth({ action: "login", success: true, meta: { shared } });

    // Mutating the original must not reach the stored entry.
    shared.x = 999;

    const stored = logger.getEntries()[0] as unknown as { meta: { shared: { x: number; self?: unknown } } };
    expect(stored.meta.shared.x).toBe(1);
    expect(stored.meta.shared.self).toBeUndefined();
  });

  it("counts every category, including the ones with no entries (H4)", () => {
    const { logger } = capture();
    logger.logAuth({ action: "login", success: true });

    const counts = logger.countByCategory();

    expect(Object.keys(counts).sort()).toEqual(["auth", "config_change", "data_access", "error", "security"]);
    expect(counts.auth).toBe(1);
    expect(counts.security).toBe(0);
    expect(counts.error).toBe(0);
    expect(counts.data_access).toBe(0);
    expect(counts.config_change).toBe(0);
  });
});
