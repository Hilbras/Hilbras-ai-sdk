/**
 * @hilbras/sdk — Signature profiles and replay protection
 *
 * `v1` is the frozen pre-v3.4.0 wire format. `v2` binds the body, the key id,
 * and a nonce. These tests pin both the v2 guarantees and the fact that v1 did
 * not change.
 */

import { describe, it, expect } from "vitest";
import { RequestSigner, signingMiddleware } from "../../src/security/request-signer.js";
import { ReplayGuard, createReplayGuard } from "../../src/security/replay-guard.js";
import type { MiddlewareContext } from "../../src/middleware/middleware.js";

const URL_ = "https://api.openai.com/v1/chat/completions";
const BODY = '{"model":"gpt-4o","messages":[]}';
const TS = "Wed, 30 Sep 2026 12:00:00 GMT";

const makeCtx = (body: string | FormData | undefined, headers: Record<string, string> = {}): MiddlewareContext => ({
  url: URL_,
  init: { method: "POST", headers, body },
  next: async () => new Response("ok", { status: 200 }),
});

describe("v1 profile is unchanged", () => {
  it("still emits x-content-sha256 for a string body", () => {
    const signed = new RequestSigner({ secret: "s" }).sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(signed.headers["x-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.headers["x-hilbras-content-digest"]).toBeUndefined();
  });

  it("still produces a deterministic signature for a fixed timestamp", () => {
    const signer = new RequestSigner({ secret: "s" });
    const a = signer.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    const b = signer.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(a.signature).toBe(b.signature);
  });

  it("does not bind the body, which is why v2 exists", () => {
    const signer = new RequestSigner({ secret: "s" });
    const a = signer.sign(URL_, { method: "POST", body: '{"a":1}', timestamp: TS });
    const b = signer.sign(URL_, { method: "POST", body: '{"b":2}', timestamp: TS });
    expect(a.signature).toBe(b.signature);
  });

  it("exposes its profile", () => {
    expect(new RequestSigner({ secret: "s" }).profile).toBe("v1");
    expect(new RequestSigner({ secret: "s", profile: "v2" }).profile).toBe("v2");
  });
});

describe("v2 profile binds the request", () => {
  const signer = (extra: Record<string, unknown> = {}) =>
    new RequestSigner({ secret: "s", profile: "v2", ...extra });

  it("binds the body, so different bodies differ", () => {
    const a = signer().sign(URL_, { method: "POST", body: '{"a":1}', timestamp: TS });
    const b = signer().sign(URL_, { method: "POST", body: '{"b":2}', timestamp: TS });
    expect(a.signature).not.toBe(b.signature);
  });

  it("binds the path and query", () => {
    const s = signer();
    const a = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    const b = s.sign("https://api.openai.com/v1/other?x=1", { method: "POST", body: BODY, timestamp: TS });
    expect(a.signature).not.toBe(b.signature);
  });

  it("binds the method", () => {
    const s = signer();
    const a = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    const b = s.sign(URL_, { method: "PUT", body: BODY, timestamp: TS });
    expect(a.signature).not.toBe(b.signature);
  });

  it("binds the timestamp", () => {
    const s = signer();
    const a = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    const b = s.sign(URL_, { method: "POST", body: BODY, timestamp: "Wed, 30 Sep 2026 12:00:01 GMT" });
    expect(a.signature).not.toBe(b.signature);
  });

  it("accepts a Uint8Array body and verifies it", () => {
    const s = signer();
    const bytes = new TextEncoder().encode(BODY);
    const signed = s.sign(URL_, { method: "POST", body: bytes, timestamp: TS });
    expect(s.verify(URL_, { method: "POST", body: bytes, headers: signed.headers }, signed.signature)).toBe(true);
    expect(s.verify(URL_, { method: "POST", body: new TextEncoder().encode("{}"), headers: signed.headers }, signed.signature)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    const s = signer();
    const signed = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(s.verify(URL_, { method: "POST", body: BODY, headers: signed.headers }, "")).toBe(false);
    expect(s.verify(URL_, { method: "POST", body: BODY, headers: signed.headers }, "zz")).toBe(false);
    expect(s.verify(URL_, { method: "POST", body: BODY, headers: signed.headers }, "0".repeat(64))).toBe(false);
  });

  it("rejects an unparseable url", () => {
    const s = signer();
    const signed = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(s.verify("not-a-url", { method: "POST", body: BODY, headers: signed.headers }, signed.signature)).toBe(false);
  });

  it("names the profile in signatureInput", () => {
    const signed = signer().sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(signed.signatureInput).toContain('profile="v2"');
  });

  it("uses an injected clock and nonce source deterministically", () => {
    const s = new RequestSigner({
      secret: "s",
      profile: "v2",
      now: () => Date.parse(TS),
      nonce: () => "fixed-nonce",
    });
    const a = s.sign(URL_, { method: "POST", body: BODY });
    const b = s.sign(URL_, { method: "POST", body: BODY });
    expect(a.headers.date).toBe(TS);
    expect(a.headers["x-hilbras-nonce"]).toBe("fixed-nonce");
    expect(a.signature).toBe(b.signature);
  });

  it("accepts a caller-supplied nonce and honours it during verification", () => {
    const s = signer();
    const signed = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS, nonce: "abc123" });
    expect(signed.headers["x-hilbras-nonce"]).toBe("abc123");
    expect(s.verify(URL_, { method: "POST", body: BODY, headers: signed.headers }, signed.signature)).toBe(true);
  });

  it("honours custom header names", () => {
    const s = new RequestSigner({
      secret: "s",
      profile: "v2",
      signatureHeader: "x-sig",
      keyIdHeader: "x-kid",
      keyId: "k1",
      nonceHeader: "X-Nonce",
      contentDigestHeader: "x-digest",
    });
    const signed = s.sign(URL_, { method: "POST", body: BODY, timestamp: TS });
    expect(signed.headers["x-sig"]).toBe(signed.signature);
    expect(signed.headers["x-kid"]).toBe("k1");
    expect(signed.headers["x-nonce"]).toBeTruthy();
    expect(signed.headers["x-digest"]).toBeTruthy();
    expect(s.verify(URL_, { method: "POST", body: BODY, headers: signed.headers }, signed.signature)).toBe(true);
  });

  it("omits the digest for a body it cannot read", () => {
    const signed = signer().sign(URL_, { method: "POST", body: new FormData(), timestamp: TS });
    expect(signed.headers["x-hilbras-content-digest"]).toBeUndefined();
    // The rest of the request is still signed.
    expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies a request signed with no body", () => {
    const s = signer();
    const signed = s.sign(URL_, { method: "GET", headers: {}, timestamp: TS });
    expect(signed.headers["x-hilbras-content-digest"]).toBeUndefined();
    expect(s.verify(URL_, { method: "GET", headers: signed.headers }, signed.signature)).toBe(true);
  });
});

describe("signingMiddleware normalization", () => {
  it("emits one key per header name and preserves values", async () => {
    const ctx = makeCtx(BODY, { "Content-Type": "application/json", Authorization: "Bearer t", "X-Custom": "1" });
    await signingMiddleware(new RequestSigner({ secret: "s", profile: "v2" }))(ctx);
    const headers = ctx.init.headers ?? {};
    const lowered = Object.keys(headers).map((k) => k.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBe("Bearer t");
    expect(headers["x-custom"]).toBe("1");
  });

  it("drops undefined header values instead of emitting them", async () => {
    const ctx: MiddlewareContext = {
      url: URL_,
      init: { method: "POST", headers: { "content-type": "application/json", "x-absent": undefined } },
      next: async () => new Response("ok"),
    };
    await signingMiddleware(new RequestSigner({ secret: "s" }))(ctx);
    expect(Object.keys(ctx.init.headers ?? {})).not.toContain("x-absent");
  });

  it("signs a request that arrives with no headers at all", async () => {
    const ctx: MiddlewareContext = { url: URL_, init: { method: "GET" }, next: async () => new Response("ok") };
    await signingMiddleware(new RequestSigner({ secret: "s", profile: "v2" }))(ctx);
    expect(ctx.init.headers?.["x-hilbras-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("ReplayGuard", () => {
  const now = Date.parse(TS);
  const guard = (options = {}) => createReplayGuard({ now: () => now, ...options });

  it("accepts a fresh, unseen signature", () => {
    expect(guard().verify({ date: TS }, "sig-1")).toEqual({ valid: true });
  });

  it("rejects a replayed signature", () => {
    const g = guard();
    expect(g.verify({ date: TS }, "sig-1").valid).toBe(true);
    const second = g.verify({ date: TS }, "sig-1");
    expect(second.valid).toBe(false);
    expect(second.reason).toContain("already been used");
  });

  it("rejects a stale request", () => {
    const g = guard({ maxAgeMs: 60_000 });
    const old = new Date(now - 120_000).toUTCString();
    const result = g.verify({ date: old }, "sig-old");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("older than");
  });

  it("rejects a request dated too far in the future", () => {
    const g = guard({ maxSkewMs: 5_000 });
    const future = new Date(now + 60_000).toUTCString();
    const result = g.verify({ date: future }, "sig-future");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("future");
  });

  it("rejects a missing or unparseable date", () => {
    const g = guard();
    expect(g.verify({}, "s").valid).toBe(false);
    expect(g.verify({ date: "nonsense" }, "s").reason).toContain("unparseable");
  });

  it("is case-insensitive about header names", () => {
    expect(guard().verify({ Date: TS }, "sig-1").valid).toBe(true);
  });

  it("does not record a signature that fails the window", () => {
    const g = guard({ maxAgeMs: 1_000 });
    const stale = new Date(now - 60_000).toUTCString();
    expect(g.verify({ date: stale }, "sig-stale").valid).toBe(false);
    // The rejected signature must not have poisoned the cache.
    expect(g.size).toBe(0);
  });

  it("bounds its cache", () => {
    const g = guard({ maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) g.verify({ date: TS }, `sig-${i}`);
    expect(g.size).toBe(3);
  });

  it("clears and reports its size", () => {
    const g = new ReplayGuard({ now: () => now });
    g.verify({ date: TS }, "s");
    expect(g.size).toBe(1);
    g.clear();
    expect(g.size).toBe(0);
  });

  it("honours a custom date header", () => {
    const g = guard({ dateHeader: "x-timestamp" });
    expect(g.verify({ "x-timestamp": TS }, "s").valid).toBe(true);
    expect(g.verify({ date: TS }, "s2").valid).toBe(false);
  });
});

describe("RequestSigner.verifyFresh", () => {
  const now = Date.parse(TS);
  const signer = new RequestSigner({ secret: "s", profile: "v2", now: () => now });

  it("accepts a fresh request once", () => {
    const signed = signer.sign(URL_, { method: "POST", body: BODY });
    const guard = new ReplayGuard({ now: () => now });
    const request = { method: "POST", body: BODY, headers: signed.headers };
    expect(signer.verifyFresh(URL_, request, signed.signature, { guard })).toEqual({ valid: true });
    const replay = signer.verifyFresh(URL_, request, signed.signature, { guard });
    expect(replay.valid).toBe(false);
    expect(replay.reason).toContain("already been used");
  });

  it("rejects a bad signature before consulting the cache", () => {
    const signed = signer.sign(URL_, { method: "POST", body: BODY });
    const result = signer.verifyFresh(URL_, { method: "POST", body: BODY, headers: signed.headers }, "0".repeat(64), {
      now: () => now,
    });
    expect(result).toEqual({ valid: false, reason: "signature does not match" });
  });

  it("rejects a stale request", () => {
    const signed = signer.sign(URL_, { method: "POST", body: BODY });
    const result = signer.verifyFresh(URL_, { method: "POST", body: BODY, headers: signed.headers }, signed.signature, {
      now: () => now + 10 * 60_000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("older than");
  });
});
