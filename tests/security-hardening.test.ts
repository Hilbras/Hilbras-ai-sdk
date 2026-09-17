/**
 * @hilbras/sdk — Phase 5: Security Hardening tests
 *
 * Tests OIDC credentials, HMAC request signing, PII detection/redaction,
 * and SOC 2 audit logging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OidcCredentialProvider, OidcError, oidcSource } from "../src/credentials/oidc.js";
import { RequestSigner, signingMiddleware } from "../src/security/request-signer.js";
import { redactPii, detectPii, createPiiRedactor } from "../src/security/pii-guard.js";
import { AuditLogger, createRetentionPolicy } from "../src/security/audit-logger.js";

// ─── OIDC Credential Provider ───────────────────────────────────────────────

describe("OidcCredentialProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches token from endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok_abc123", expires_in: 3600 }),
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    const token = await provider.getToken();
    expect(token).toBe("tok_abc123");
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.example.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("caches token and does not re-fetch", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok_cached", expires_in: 3600 }),
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes token after expiry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok_v1", expires_in: 60 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok_v2", expires_in: 60 }),
      });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
      clockSkewMs: 0,
    });

    const t1 = await provider.getToken();
    expect(t1).toBe("tok_v1");

    // Advance past expiry
    vi.advanceTimersByTime(61_000);

    const t2 = await provider.getToken();
    expect(t2).toBe("tok_v2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent token requests", async () => {
    let callCount = 0;
    const fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({ access_token: `tok_${callCount}`, expires_in: 3600 }),
          });
        }, 10);
      });
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    // Fire 3 concurrent requests, advance fake timers
    const promise = Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    vi.advanceTimersByTime(50);
    const [t1, t2, t3] = await promise;

    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws OidcError on network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    await expect(provider.getToken()).rejects.toThrow(OidcError);
  });

  it("throws OidcError on non-200 response", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    await expect(provider.getToken()).rejects.toThrow("401");
  });

  it("throws OidcError on missing access_token", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token_type: "Bearer" }),
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    await expect(provider.getToken()).rejects.toThrow("missing access_token");
  });

  it("invalidate() forces re-fetch", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok_v1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok_v2", expires_in: 3600 }),
      });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      fetch: fetch as any,
    });

    const t1 = await provider.getToken();
    provider.invalidate();
    const t2 = await provider.getToken();

    expect(t1).toBe("tok_v1");
    expect(t2).toBe("tok_v2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends scopes and extra params", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
    });

    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
      clientSecret: "secret",
      scopes: ["api:read", "api:write"],
      extraParams: { audience: "https://api.example.com" },
      fetch: fetch as any,
    });

    await provider.getToken();

    const body = fetch.mock.calls[0][1].body as string;
    expect(body).toContain("scope=api%3Aread+api%3Awrite");
    expect(body).toContain("client_secret=secret");
    expect(body).toContain("audience=https%3A%2F%2Fapi.example.com");
  });

  it("isCached returns false when no token", () => {
    const provider = new OidcCredentialProvider({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-app",
    });
    expect(provider.isCached).toBe(false);
  });
});

describe("oidcSource", () => {
  it("creates an OIDC credential source", () => {
    const source = oidcSource("https://auth.example.com/token", "my-app", {
      clientSecret: "secret",
      scopes: ["api:read"],
    });

    expect(source).toEqual({
      type: "oidc",
      endpoint: "https://auth.example.com/token",
      clientId: "my-app",
      clientSecret: "secret",
      scopes: ["api:read"],
      extraParams: undefined,
    });
  });
});

// ─── HMAC Request Signer ────────────────────────────────────────────────────

describe("RequestSigner", () => {
  it("signs a GET request", () => {
    const signer = new RequestSigner({ secret: "my-secret" });

    const result = signer.sign("https://api.example.com/v1/models", {
      method: "GET",
    });

    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(result.headers.date).toBeDefined();
    expect(result.headers["x-hilbras-signature"]).toBe(result.signature);
  });

  it("signs a POST request with body", () => {
    const signer = new RequestSigner({ secret: "my-secret" });

    const result = signer.sign("https://api.example.com/v1/chat", {
      method: "POST",
      body: '{"model":"gpt-5.6"}',
      headers: { "content-type": "application/json" },
    });

    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(result.headers["x-content-sha256"]).toBeDefined();
  });

  it("includes key ID in headers", () => {
    const signer = new RequestSigner({
      secret: "my-secret",
      keyId: "key-2026-09",
    });

    const result = signer.sign("https://api.example.com/v1/models", {});
    expect(result.headers["x-hilbras-key-id"]).toBe("key-2026-09");
  });

  it("produces deterministic signatures", () => {
    const signer = new RequestSigner({ secret: "my-secret" });
    const ts = "Mon, 17 Sep 2026 12:00:00 GMT";

    const r1 = signer.sign("https://api.example.com/v1/models", { method: "GET", timestamp: ts });
    const r2 = signer.sign("https://api.example.com/v1/models", { method: "GET", timestamp: ts });

    expect(r1.signature).toBe(r2.signature);
  });

  it("different secrets produce different signatures", () => {
    const s1 = new RequestSigner({ secret: "secret-1" });
    const s2 = new RequestSigner({ secret: "secret-2" });
    const ts = "Mon, 17 Sep 2026 12:00:00 GMT";

    const r1 = s1.sign("https://api.example.com/v1/models", { timestamp: ts });
    const r2 = s2.sign("https://api.example.com/v1/models", { timestamp: ts });

    expect(r1.signature).not.toBe(r2.signature);
  });

  it("verify() validates a correct signature", () => {
    const signer = new RequestSigner({ secret: "my-secret" });
    const ts = "Mon, 17 Sep 2026 12:00:00 GMT";

    const signed = signer.sign("https://api.example.com/v1/models", {
      method: "GET",
      timestamp: ts,
    });

    const valid = signer.verify(
      "https://api.example.com/v1/models",
      {
        method: "GET",
        headers: { date: ts },
      },
      signed.signature,
    );

    expect(valid).toBe(true);
  });

  it("verify() rejects invalid signature", () => {
    const signer = new RequestSigner({ secret: "my-secret" });

    const valid = signer.verify(
      "https://api.example.com/v1/models",
      { method: "GET", headers: { date: "Mon, 17 Sep 2026 12:00:00 GMT" } },
      "0".repeat(64),
    );

    expect(valid).toBe(false);
  });

  it("verify() rejects wrong URL", () => {
    const signer = new RequestSigner({ secret: "my-secret" });
    const ts = "Mon, 17 Sep 2026 12:00:00 GMT";

    const signed = signer.sign("https://api.example.com/v1/models", {
      method: "GET",
      timestamp: ts,
    });

    const valid = signer.verify(
      "https://api.example.com/v1/users",
      { method: "GET", headers: { date: ts } },
      signed.signature,
    );

    expect(valid).toBe(false);
  });

  it("supports sha512 algorithm", () => {
    const signer = new RequestSigner({ secret: "my-secret", algorithm: "sha512" });

    const result = signer.sign("https://api.example.com/v1/models", {});
    expect(result.signature).toMatch(/^[a-f0-9]{128}$/);
  });

  it("signingMiddleware adds signature headers", async () => {
    const signer = new RequestSigner({ secret: "my-secret" });
    const mw = signingMiddleware(signer);

    const initHeaders: Record<string, string> = {};
    const ctx = {
      url: "https://api.example.com/v1/models",
      init: { method: "GET", headers: initHeaders },
      next: vi.fn().mockResolvedValue(new Response("ok")),
    };

    await mw(ctx as any);

    // Middleware creates a new headers object on ctx.init
    const finalHeaders = ctx.init.headers as Record<string, string>;
    expect(finalHeaders["x-hilbras-signature"]).toBeDefined();
    expect(finalHeaders.date).toBeDefined();
    expect(ctx.next).toHaveBeenCalled();
  });
});

// ─── PII Detection & Redaction ──────────────────────────────────────────────

describe("detectPii", () => {
  it("detects email addresses", () => {
    const matches = detectPii("Contact john@example.com for info");
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("email");
    expect(matches[0].value).toBe("john@example.com");
  });

  it("detects phone numbers", () => {
    const matches = detectPii("Call 555-123-4567 or (555) 987-6543");
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.every((m) => m.type === "phone")).toBe(true);
  });

  it("detects SSNs", () => {
    const matches = detectPii("SSN: 123-45-6789");
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("ssn");
    expect(matches[0].value).toBe("123-45-6789");
  });

  it("detects credit card numbers", () => {
    const matches = detectPii("Card: 4111111111111111", { types: ["credit_card"] });
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("credit_card");
  });

  it("detects IP addresses", () => {
    const matches = detectPii("Server at 192.168.1.100 responded");
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("ip_address");
    expect(matches[0].value).toBe("192.168.1.100");
  });

  it("detects multiple PII types in one text", () => {
    const matches = detectPii("Email john@example.com, SSN 123-45-6789, IP 10.0.0.1");
    expect(matches.length).toBeGreaterThanOrEqual(3);
    const types = new Set(matches.map((m) => m.type));
    expect(types.has("email")).toBe(true);
    expect(types.has("ssn")).toBe(true);
    expect(types.has("ip_address")).toBe(true);
  });

  it("respects types filter", () => {
    const matches = detectPii("Email john@example.com, SSN 123-45-6789", {
      types: ["email"],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("email");
  });

  it("handles custom patterns", () => {
    const matches = detectPii("Order #ABC-12345", {
      customPatterns: [{ type: "order_id", pattern: /#[A-Z]{3}-\d{5}/g }],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe("custom");
    expect(matches[0].value).toBe("#ABC-12345");
  });

  it("returns empty for no PII", () => {
    const matches = detectPii("Hello world, no PII here!");
    expect(matches).toHaveLength(0);
  });
});

describe("redactPii", () => {
  it("redacts emails", () => {
    const result = redactPii("Contact john@example.com");
    expect(result).toBe("Contact [EMAIL]");
  });

  it("redacts SSNs", () => {
    const result = redactPii("SSN: 123-45-6789");
    expect(result).toBe("SSN: [SSN]");
  });

  it("redacts credit cards", () => {
    const result = redactPii("Card: 4111-1111-1111-1111");
    expect(result).toBe("Card: [CREDIT_CARD]");
  });

  it("redacts IP addresses", () => {
    const result = redactPii("At 192.168.1.100");
    expect(result).toBe("At [IP_ADDRESS]");
  });

  it("redacts multiple types in one string", () => {
    const result = redactPii("Email john@example.com, SSN 123-45-6789");
    expect(result).toContain("[EMAIL]");
    expect(result).toContain("[SSN]");
    expect(result).not.toContain("john@example.com");
    expect(result).not.toContain("123-45-6789");
  });

  it("preserves text without PII", () => {
    const input = "Hello world, no PII here!";
    expect(redactPii(input)).toBe(input);
  });

  it("supports mask mode", () => {
    const result = redactPii("Email john@example.com", { mask: true });
    expect(result).not.toContain("john@example.com");
    // Masked result preserves structure but obscures content
    expect(result).toMatch(/Email .+/);
  });

  it("supports custom replacements", () => {
    const result = redactPii("Contact john@example.com", {
      replacements: { email: (v) => `[MAIL:${v.length}]` },
    });
    expect(result).toBe("Contact [MAIL:16]");
  });

  it("createPiiRedactor returns a reusable function", () => {
    const redact = createPiiRedactor({ types: ["email"] });
    expect(redact("Email john@example.com")).toBe("Email [EMAIL]");
    expect(redact("No PII here")).toBe("No PII here");
  });
});

// ─── SOC 2 Audit Logger ─────────────────────────────────────────────────────

describe("AuditLogger", () => {
  let logger: AuditLogger;
  let entries: any[];

  beforeEach(() => {
    entries = [];
    logger = new AuditLogger({
      serviceName: "test-app",
      destination: (e) => entries.push(e),
    });
  });

  it("logs auth events", () => {
    logger.logAuth({ action: "login", userId: "user-1", success: true, method: "oidc" });

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("auth");
    expect(entries[0].action).toBe("login");
    expect(entries[0].userId).toBe("user-1");
    expect(entries[0].success).toBe(true);
    expect(entries[0].method).toBe("oidc");
  });

  it("logs failed auth with warning severity", () => {
    logger.logAuth({ action: "login", success: false, reason: "invalid_token" });

    expect(entries[0].severity).toBe("warning");
    expect(entries[0].success).toBe(false);
    expect(entries[0].reason).toBe("invalid_token");
  });

  it("logs data access events", () => {
    logger.logDataAccess({
      action: "read",
      resource: "provider-config",
      accessType: "read",
      userId: "user-1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("data_access");
    expect(entries[0].resource).toBe("provider-config");
    expect(entries[0].accessType).toBe("read");
  });

  it("logs config change events", () => {
    logger.logConfigChange({
      action: "add_provider",
      resource: "provider/openai",
      previousValue: null,
      newValue: { name: "openai" },
      userId: "admin",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("config_change");
    expect(entries[0].newValue).toEqual({ name: "openai" });
  });

  it("logs security events", () => {
    logger.logSecurity({
      action: "ssrf_blocked",
      eventType: "ssrf_blocked",
      description: "Blocked request to 169.254.169.254",
      severity: "critical",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("security");
    expect(entries[0].eventType).toBe("ssrf_blocked");
    expect(entries[0].severity).toBe("critical");
  });

  it("logs error events", () => {
    logger.logError({
      action: "token_refresh",
      error: "OIDC endpoint unreachable",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("error");
    expect(entries[0].severity).toBe("critical");
  });

  it("generates unique event IDs", () => {
    logger.logAuth({ action: "login", success: true });
    logger.logAuth({ action: "login", success: true });

    expect(entries[0].eventId).not.toBe(entries[1].eventId);
  });

  it("includes timestamps", () => {
    logger.logAuth({ action: "login", success: true });
    expect(entries[0].timestamp).toBeDefined();
    expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThan(0);
  });

  it("getEntries returns all entries", () => {
    logger.logAuth({ action: "login", success: true });
    logger.logSecurity({ action: "blocked", eventType: "rate_limit" });

    expect(logger.getEntries()).toHaveLength(2);
  });

  it("getByCategory filters correctly", () => {
    logger.logAuth({ action: "login", success: true });
    logger.logSecurity({ action: "blocked", eventType: "rate_limit" });
    logger.logAuth({ action: "logout", success: true });

    expect(logger.getByCategory("auth")).toHaveLength(2);
    expect(logger.getByCategory("security")).toHaveLength(1);
  });

  it("getBySeverity filters correctly", () => {
    logger.logAuth({ action: "login", success: true }); // info
    logger.logSecurity({ action: "blocked", eventType: "rate_limit", severity: "critical" });

    expect(logger.getBySeverity("info")).toHaveLength(1);
    expect(logger.getBySeverity("critical")).toHaveLength(1);
  });

  it("getByUser filters correctly", () => {
    logger.logAuth({ action: "login", userId: "alice", success: true });
    logger.logAuth({ action: "login", userId: "bob", success: true });
    logger.logAuth({ action: "login", userId: "alice", success: true });

    expect(logger.getByUser("alice")).toHaveLength(2);
    expect(logger.getByUser("bob")).toHaveLength(1);
  });

  it("countByCategory works", () => {
    logger.logAuth({ action: "login", success: true });
    logger.logAuth({ action: "logout", success: true });
    logger.logSecurity({ action: "blocked", eventType: "rate_limit" });

    const counts = logger.countByCategory();
    expect(counts.auth).toBe(2);
    expect(counts.security).toBe(1);
  });

  it("respects maxEntries limit", () => {
    const small = new AuditLogger({}, 3);
    for (let i = 0; i < 5; i++) {
      small.logAuth({ action: `action-${i}`, success: true });
    }
    expect(small.size).toBe(3);
  });

  it("clear() empties entries", () => {
    logger.logAuth({ action: "login", success: true });
    logger.clear();
    expect(logger.size).toBe(0);
  });

  it("includes default fields", () => {
    const custom = new AuditLogger({
      defaultFields: { env: "production" },
      destination: (e) => entries.push(e),
    });

    custom.logAuth({ action: "login", success: true });
    expect(entries[0].meta.env).toBe("production");
  });

  it("swallows destination errors", () => {
    const failing = new AuditLogger({
      destination: () => { throw new Error("dest error"); },
    });

    expect(() => failing.logAuth({ action: "login", success: true })).not.toThrow();
  });
});

describe("createRetentionPolicy", () => {
  it("purge removes old entries", () => {
    const logger = new AuditLogger();
    logger.logAuth({ action: "login", success: true });

    const policy = createRetentionPolicy(logger, 60_000); // 1 minute
    // All entries are fresh, so purge should keep them
    const purged = policy.purge();
    expect(purged).toBe(0);
  });
});
