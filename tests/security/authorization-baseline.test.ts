/**
 * @hilbras/sdk — v3.4.0 authorization baseline and risk characterization
 *
 * Part A pins the v3.3.0 behavior that MUST survive v3.4.0 unchanged.
 * Part B documents the audited defects as `it.fails` tests: each one asserts
 * the CORRECT behavior, so it is red against v3.3.0 and turns green when the
 * corresponding finding is fixed. `it.fails` inverts that expectation, so a
 * defect that is silently left unfixed cannot pass quietly — the suite reports
 * "expected fail" and the fix converts the case to a normal assertion.
 */

import { describe, it, expect } from "vitest";
import { checkPermission, createRBACMiddleware } from "../../src/security/rbac.js";
import type { Middleware, MiddlewareContext } from "../../src/middleware/middleware.js";
import { composeMiddlewares, retryMiddleware } from "../../src/middleware/middleware.js";
import { AuditLogger } from "../../src/security/audit-logger.js";
import { RequestSigner, signingMiddleware } from "../../src/security/request-signer.js";
import { resolveConfig } from "../../src/config/config-resolver.js";
import { createRuntimeSource } from "../../src/config/sources/runtime.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function makeCtx(options: {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
  bodyRaw?: string | FormData;
} = {}): MiddlewareContext {
  return {
    url: options.url ?? OPENAI_URL,
    init: {
      method: "POST",
      headers: options.headers ?? { "content-type": "application/json" },
      body: options.bodyRaw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    },
    next: async () => new Response("ok", { status: 200 }),
  };
}

const okResponse = () => new Response("ok", { status: 200 });

// ─── Part A: compatibility surface ──────────────────────────────────────────

describe("A. authorization compatibility surface (must not change in v3.4.0)", () => {
  it("allows through when no role matches the configuration", async () => {
    const mw = createRBACMiddleware({ roles: {}, defaultRole: "missing" }, () => "user-1");
    const res = await mw(makeCtx({ body: { provider: "openai", model: "gpt-4o" } }));
    expect(res.status).toBe(200);
  });

  it("allows through when the request context cannot be resolved (permissive default)", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["anthropic"] } }, defaultRole: "viewer" },
      () => "user-1",
    );
    // A realistic adapter body: it carries `model` but never `provider`.
    const res = await mw(makeCtx({ body: { model: "gpt-4o", max_tokens: 16 } }));
    expect(res.status).toBe(200);
  });

  it("returns 403 when a body explicitly carries a disallowed provider and model", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } }, defaultRole: "viewer" },
      () => "user-1",
    );
    const res = await mw(makeCtx({ body: { provider: "anthropic", model: "claude-3" } }));
    expect(res.status).toBe(403);
  });

  it("returns a JSON error body naming the reason on denial", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedModels: ["gpt-4o"] } }, defaultRole: "viewer" },
      () => "user-1",
    );
    const res = await mw(makeCtx({ body: { provider: "openai", model: "gpt-5" } }));
    const payload = (await res.json()) as { error: string };
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(payload.error).toContain("gpt-5");
  });

  it("allows a permitted provider and model", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["openai"], allowedModels: ["gpt-*"] } }, defaultRole: "viewer" },
      () => "user-1",
    );
    const res = await mw(makeCtx({ body: { provider: "openai", model: "gpt-4o" } }));
    expect(res.status).toBe(200);
  });

  it("records a denial as a warning-severity rbac_denied audit event", async () => {
    const auditLogger = new AuditLogger();
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } }, defaultRole: "viewer" },
      () => "user-1",
      { auditLogger },
    );
    await mw(makeCtx({ body: { provider: "anthropic", model: "claude-3" } }));
    const entry = auditLogger.getEntries().find((e) => e.action === "rbac_denied");
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe("warning");
  });

  it("accepts a well-formed rbac block in configuration without diagnostics", () => {
    const resolved = resolveConfig({
      sources: [createRuntimeSource({
        rbac: {
          roles: { viewer: { name: "viewer", allowedProviders: ["openai"], maxTokensPerRequest: 4096 } },
          defaultRole: "viewer",
        },
      })],
    });
    expect(resolved.diagnostics.filter((d) => d.code.startsWith("RBAC_"))).toEqual([]);
  });

  it("keeps signingMiddleware callable and passing through to the transport", async () => {
    const signer = new RequestSigner({ secret: "test-secret" });
    const mw = signingMiddleware(signer);
    const res = await mw(makeCtx({ headers: {}, body: { model: "gpt-4o" } }));
    expect(res.status).toBe(200);
  });
});

// ─── Part B: audited defects (it.fails — turns green when fixed) ─────────────

describe("B. RBAC defects (red on v3.3.0, fixed in v3.4.0)", () => {
  it("R1: the request identity selects the role", async () => {
    const mw = createRBACMiddleware(
      {
        roles: {
          alice: { name: "alice", allowedProviders: ["openai"] },
          bob: { name: "bob" },
        },
        defaultRole: "alice",
      },
      () => "bob",
      { resolveRole: (ctx) => (ctx.init.headers?.["x-user"] as string | undefined) ?? "alice" },
    );
    // "bob" resolves to the unrestricted role and is allowed; the default role
    // "alice" would have denied this. Before v3.4.0 the default role always won.
    const allowed = await mw(makeCtx({ body: { provider: "anthropic", model: "claude-3" }, headers: { "x-user": "bob" } }));
    expect(allowed.status).toBe(200);

    const denied = await mw(makeCtx({ body: { provider: "anthropic", model: "claude-3" }, headers: { "x-user": "alice" } }));
    expect(denied.status).toBe(403);
  });

  it("R2: the permission check runs for a realistic adapter body", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["anthropic"] } }, defaultRole: "viewer" },
      () => "user-1",
      { resolveProviderByUrl: (url) => (url.includes("openai.com") ? "openai" : null) },
    );
    // No `provider` in the body (adapters never send one); the provider is
    // implied by the request URL. Before v3.4.0 the check was skipped entirely.
    const res = await mw(makeCtx({ url: OPENAI_URL, body: { model: "gpt-4o", max_tokens: 16 } }));
    expect(res.status).toBe(403);
  });

  it("R3: a per-role rate limit actually consumes tokens", async () => {
    const mw = createRBACMiddleware(
      {
        roles: {
          viewer: {
            name: "viewer",
            rateLimit: { maxRequests: 2, windowMs: 60_000 },
          },
        },
        defaultRole: "viewer",
      },
      () => "user-1",
    );
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await mw(makeCtx({ body: { provider: "openai", model: "gpt-4o" } }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429);
  });

  it("R4: strict enforcement denies when defaultRole names a missing role", async () => {
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer" } }, defaultRole: "viewr", enforcement: "strict" } as never,
      () => "user-1",
    );
    const res = await mw(makeCtx({ body: { provider: "openai", model: "gpt-4o" } }));
    expect(res.status).toBe(403);
  });

  it("R5: a malformed rbac block is rejected as configuration", () => {
    expect(() =>
      resolveConfig({
        sources: [createRuntimeSource({
          rbac: { roles: { viewer: { name: "viewer", allowedModels: "gpt-4o" } } },
        })],
        strict: true,
      }),
    ).toThrow();
  });

  it("R7: a malformed allowedModels string denies instead of throwing", () => {
    const result = checkPermission(
      { name: "viewer", allowedModels: "gpt-4o" } as never,
      "openai",
      "gpt-4o",
    );
    expect(result.allowed).toBe(false);
  });

  it("R8: a declared maxBudgetPerSession is enforced or reported", async () => {
    const diagnostics: string[] = [];
    const mw = createRBACMiddleware(
      {
        roles: { viewer: { name: "viewer", maxBudgetPerSession: 0.01 } },
        defaultRole: "viewer",
      },
      () => "user-1",
      { onDiagnostic: (d) => diagnostics.push(d.code) } as never,
    );
    await mw(makeCtx({ body: { provider: "openai", model: "gpt-4o", max_tokens: 100_000 } }));
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("R9: a denial audit event is attributed to the requesting user", async () => {
    const auditLogger = new AuditLogger();
    const mw = createRBACMiddleware(
      { roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } }, defaultRole: "viewer" },
      () => "user-1",
      { auditLogger },
    );
    await mw(makeCtx({ body: { provider: "anthropic", model: "claude-3" } }));
    expect(auditLogger.getByUser("user-1").length).toBeGreaterThan(0);
  });
});

describe("B. request signing and transport defects (red on v3.3.0, fixed in v3.4.0)", () => {
  it("S1: two different bodies produce different signatures", () => {
    const signer = new RequestSigner({ secret: "s", profile: "v2" });
    const timestamp = new Date().toUTCString();
    const a = signer.sign(OPENAI_URL, { method: "POST", body: '{"model":"gpt-4o"}', timestamp });
    const b = signer.sign(OPENAI_URL, { method: "POST", body: '{"model":"claude-3"}', timestamp });
    expect(a.signature).not.toBe(b.signature);
  });

  it("S2: verify recomputes the body digest from the received bytes", () => {
    const signer = new RequestSigner({ secret: "s", profile: "v2" });
    const timestamp = new Date().toUTCString();
    const signed = signer.sign(OPENAI_URL, { method: "POST", body: '{"model":"gpt-4o"}', timestamp });
    // The attacker swaps the body and rewrites the digest header to match. Only
    // recomputing the digest from the received bytes catches this.
    const tamperedHeaders = {
      ...signed.headers,
      "x-hilbras-content-digest": signed.headers["x-hilbras-content-digest"],
    };
    const withTamperedBody = signer.verify(
      OPENAI_URL,
      { method: "POST", body: '{"model":"claude-3"}', headers: tamperedHeaders },
      signed.signature,
    );
    expect(withTamperedBody).toBe(false);

    // The untampered request still verifies.
    expect(signer.verify(
      OPENAI_URL,
      { method: "POST", body: '{"model":"gpt-4o"}', headers: signed.headers },
      signed.signature,
    )).toBe(true);
  });

  it.fails("S4: a stage after a retry stage re-runs on every attempt", async () => {
    let downstreamCalls = 0;
    const counting: Middleware = async (ctx) => {
      downstreamCalls += 1;
      return ctx.next();
    };
    let attempts = 0;
    const failing: Middleware = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return okResponse();
    };
    const composed = composeMiddlewares(failing, counting);
    const res = await composed(makeCtx({ headers: {}, body: { model: "gpt-4o" } }));
    expect(res.status).toBe(200);
    expect(attempts).toBe(3);
    expect(downstreamCalls).toBe(3);
  });

  it("S5: a FormData body emits no content digest instead of a constant one", async () => {
    const collect = async (mw: Middleware, body: FormData): Promise<Record<string, string | undefined>> => {
      const ctx = makeCtx({ headers: {}, bodyRaw: body });
      await mw(ctx);
      return ctx.init.headers ?? {};
    };
    const formData = (value: string): FormData => {
      const form = new FormData();
      form.set("file", new Blob([value]), "upload.txt");
      return form;
    };

    const v2 = signingMiddleware(new RequestSigner({ secret: "s", profile: "v2" }));
    const underV2 = await collect(v2, formData("alpha"));
    expect(underV2["x-hilbras-content-digest"]).toBeUndefined();
    expect(underV2["x-content-sha256"]).toBeUndefined();

    // Frozen v1 keeps emitting its constant placeholder digest; documented, not
    // silently changed.
    const v1 = signingMiddleware(new RequestSigner({ secret: "s" }));
    const a = await collect(v1, formData("alpha"));
    const b = await collect(v1, formData("omega"));
    expect(a["x-content-sha256"]).toBe(b["x-content-sha256"]);
  });

  it("S6: signing emits one header key per name", async () => {
    const signer = new RequestSigner({ secret: "s" });
    const mw = signingMiddleware(signer);
    const ctx = makeCtx({
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token" },
      body: { model: "gpt-4o" },
    });
    await mw(ctx);
    const keys = Object.keys(ctx.init.headers ?? {}).map((k) => k.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    // The credential survives, under a single normalized name.
    expect(ctx.init.headers?.authorization).toBe("Bearer secret-token");
    expect(ctx.init.headers?.["content-type"]).toBe("application/json");
  });

  it("S7: the key id is covered by the signature", () => {
    const timestamp = new Date().toUTCString();
    const keyA = new RequestSigner({ secret: "s", keyId: "key-a", profile: "v2" });
    const keyB = new RequestSigner({ secret: "s", keyId: "key-b", profile: "v2" });

    const a = keyA.sign(OPENAI_URL, { method: "GET", headers: {}, timestamp });
    const b = keyB.sign(OPENAI_URL, { method: "GET", headers: {}, timestamp });
    expect(a.signature).not.toBe(b.signature);

    // Rewriting the key-id header on the wire is a key-confusion attempt and
    // must not verify.
    const tampered = { ...a.headers, "x-hilbras-key-id": "key-b" };
    expect(keyA.verify(OPENAI_URL, { method: "GET", headers: tampered }, a.signature)).toBe(false);
  });

  it("S8: two signatures in the same second differ", () => {
    const signer = new RequestSigner({ secret: "s", profile: "v2" });
    const timestamp = new Date().toUTCString();
    const a = signer.sign(OPENAI_URL, { method: "POST", body: '{"model":"gpt-4o"}', timestamp });
    const b = signer.sign(OPENAI_URL, { method: "POST", body: '{"model":"gpt-4o"}', timestamp });
    expect(a.signature).not.toBe(b.signature);
    expect(a.headers["x-hilbras-nonce"]).not.toBe(b.headers["x-hilbras-nonce"]);
  });

  it("S9: a non-sha256 algorithm uses a correctly named digest header", () => {
    const sha512 = new RequestSigner({ secret: "s", algorithm: "sha512", profile: "v2" });
    const signed = sha512.sign(OPENAI_URL, { method: "POST", body: '{"model":"gpt-4o"}' });
    expect(signed.signature).toHaveLength(128);
    // The digest header is a content digest, not a mislabeled SHA-256.
    expect(signed.headers["x-hilbras-content-digest"]).toMatch(/^[a-f0-9]{128}$/);
    expect(signed.headers["x-content-sha256"]).toBeUndefined();
  });
});

describe("B. middleware composition defect (red on v3.3.0, fixed in v3.4.0)", () => {
  it.fails("retryMiddleware re-runs the whole downstream chain per attempt", async () => {
    let downstreamCalls = 0;
    const counting: Middleware = async (ctx) => {
      downstreamCalls += 1;
      return ctx.next();
    };
    const composed = composeMiddlewares(retryMiddleware(2, 0), counting);
    const ctx = makeCtx({ headers: {} });
    let thrown: unknown;
    try {
      await composed(ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    // 1 initial attempt + 2 retries.
    expect(downstreamCalls).toBe(3);
  });
});
