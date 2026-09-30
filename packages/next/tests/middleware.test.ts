/**
 * @hilbras/next — middleware rate-limit keying
 *
 * Before 2.3.0 the bucket key was `x-forwarded-for.split(",")[0]`, the
 * leftmost entry. Every common proxy (nginx `proxy_add_x_forwarded_for`,
 * Vercel, Cloudflare) *prepends* the real client address to whatever the client
 * sent, so index 0 is the client-supplied value. An attacker rotating the
 * header got a fresh bucket per request, which is a full bypass of the only
 * rate limiter the package shipped.
 *
 * The failure was invisible to the old suite: `createRequest` set `x-forwarded-for`
 * to exactly one IP, so the leftmost and rightmost entries were the same value and
 * both the old and new code produced identical keys. Every test below uses a
 * multi-entry header, which is what a real proxied request carries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => {
  class MockHeaders extends Map {
    constructor(init?: Record<string, string>) {
      super();
      if (init) Object.entries(init).forEach(([k, v]) => this.set(k, v));
    }
  }
  return {
    NextResponse: {
      json: (data: any, init?: any) => ({
        status: init?.status ?? 200,
        headers: new MockHeaders(init?.headers),
        body: JSON.stringify(data),
      }),
      next: () => ({ status: 200, headers: new MockHeaders() }),
    },
  };
});

vi.mock("next", () => ({}));

import { hilbrasMiddleware, forwardedClientIp } from "../src/middleware";

/** Build a request whose x-forwarded-for is `entries.join(", ")`. */
function createRequest(path = "/api/chat", entries: string[] = ["1.1.1.1"], extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": entries.join(", "), ...extra };
  return {
    nextUrl: { pathname: path },
    headers: new Map(Object.entries(headers)),
    ip: entries[0],
  } as any;
}

const blocked = (res: any) => res?.status === 429;

describe("forwardedClientIp", () => {
  it("returns undefined when nothing is trusted — no entry is attributable", () => {
    // With trustProxy 0 the index is out of range by construction: whatever the
    // header holds, the client chose it, so the middleware must fall back.
    expect(forwardedClientIp("1.1.1.1", 0)).toBeUndefined();
  });

  it("reads the nearest hop for one trusted proxy", () => {
    // Pinned to the exact index: `entries.length - trustProxy` is 1 here, so
    // any off-by-one returns "9.9.9.1" instead.
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1", 1)).toBe("1.1.1.1");
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1", 1)).not.toBe("9.9.9.1");
  });

  it("returns undefined at every trust depth that exceeds the chain length", () => {
    // `entries.length - trustProxy` is negative from depth 3 on a 2-entry
    // chain. Without the guard, a negative index reads `entries[-1]`, which is
    // `undefined` here by accident — so the depth must exceed the length by
    // enough that a wrong implementation would return a *client-chosen* value.
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1", 3)).toBeUndefined();
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1", 4)).toBeUndefined();
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1", 9)).toBeUndefined();

    // A 5-entry chain with trust depth 9 indexes at -4. An implementation that
    // clamped instead of rejecting would hand back a real address; the correct
    // answer is to refuse.
    expect(forwardedClientIp("a, b, c, d, e", 9)).toBeUndefined();

    // Depth exactly equal to the length is *in* range and resolves to the
    // leftmost entry — trusting the whole chain. That is legitimate only when
    // the operator really does sit behind that many proxies, so it is asserted
    // rather than assumed away.
    expect(forwardedClientIp("a, b, c, d, e", 5)).toBe("a");
    expect(forwardedClientIp("a, b, c, d, e", 6)).toBeUndefined();
  });

  it("ignores client-supplied entries ahead of the trusted count", () => {
    expect(forwardedClientIp("6.6.6.6, 9.9.9.1, 1.1.1.1", 1)).toBe("1.1.1.1");
  });

  it("moves one entry left for each additional trusted proxy", () => {
    // Chain of two proxies: junk, real client, nearest hop.
    expect(forwardedClientIp("9.9.9.1, 1.1.1.1, 10.0.0.1", 2)).toBe("1.1.1.1");
    // Chain of three: junk, junk, real client, nearest two hops.
    expect(forwardedClientIp("8.8.8.8, 9.9.9.1, 1.1.1.1, 10.0.0.1, 10.0.0.2", 3)).toBe("1.1.1.1");
  });

  it("returns undefined when the header is absent or empty", () => {
    expect(forwardedClientIp(null, 1)).toBeUndefined();
    expect(forwardedClientIp("", 1)).toBeUndefined();
    expect(forwardedClientIp("  ", 1)).toBeUndefined();
  });

  it("returns undefined when the list is shorter than the trust depth", () => {
    // Only client-controlled entries are present, so none can be trusted.
    expect(forwardedClientIp("1.1.1.1", 2)).toBeUndefined();
  });

  it("tolerates whitespace and empty segments", () => {
    // An empty segment must not count as a hop. `"9.9.9.1, , 1.1.1.1"` has two
    // real entries after filtering, so trust depth 1 resolves to `1.1.1.1`.
    // If empty segments were kept, `entries.length` would be 3 and the same
    // depth would index 2 — yielding `undefined` instead.
    expect(forwardedClientIp("9.9.9.1, , 1.1.1.1", 1)).toBe("1.1.1.1");
    expect(forwardedClientIp("9.9.9.1,,1.1.1.1", 1)).toBe("1.1.1.1");
    expect(forwardedClientIp("9.9.9.1, , , 1.1.1.1", 1)).toBe("1.1.1.1");

    // Whitespace-only segments are dropped the same way.
    expect(forwardedClientIp("9.9.9.1,   , 1.1.1.1", 1)).toBe("1.1.1.1");

    // A header of only separators yields no entries at all.
    expect(forwardedClientIp(" , , ", 1)).toBeUndefined();
  });
});

describe("hilbrasMiddleware — bypass regression", () => {
  it("does not give a fresh bucket when the client rotates x-forwarded-for", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1 });

    // Real client 1.1.1.1 behind one proxy. The attacker rotates the entry they
    // control; the proxy-appended address stays last.
    await mw(createRequest("/api/chat", ["9.9.9.1", "1.1.1.1"]));
    await mw(createRequest("/api/chat", ["9.9.9.2", "1.1.1.1"]));
    const third = await mw(createRequest("/api/chat", ["9.9.9.3", "1.1.1.1"]));

    expect(blocked(third)).toBe(true);
  });

  it("gave a fresh bucket before 2.3.0 — the bypass this fixes", () => {
    // Reproduces the old leftmost-entry keying to document the defect. If this
    // test ever fails, the bypass has changed shape rather than disappeared.
    const oldKey = (entries: string[]) => entries[0];
    const buckets = new Map<string, number>();
    const rotate = ["9.9.9.1", "9.9.9.2", "9.9.9.3", "9.9.9.4", "9.9.9.5"];

    for (const entry of rotate) {
      const key = oldKey([entry, "1.1.1.1", "proxy"]);
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      // Each rotated header is a different key, so every one is the 1st request.
      expect(count).toBe(1);
    }
    expect(buckets.size).toBe(5);
  });

  it("counts all header-less callers in one bucket rather than trusting request.ip", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1 });

    const a = createRequest("/api/chat", [], { "x-real-ip": "" });
    // Distinct `ip` fields, no forwarded header: request.ip would split these.
    const b = { ...a, ip: "5.5.5.5" };
    const c = { ...a, ip: "6.6.6.6" };

    await mw(a);
    await mw(b);
    expect(blocked(await mw(c))).toBe(true);
  });

  it("uses x-real-ip as a fallback only when a proxy is trusted", async () => {
    const mk = (ip: string) => createRequest("/api/chat", [], { "x-real-ip": ip });

    // With a trusted proxy, x-real-ip separates callers: two distinct values
    // are each the 1st request against their own bucket.
    const trusting = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60, trustProxy: 1 });
    expect(blocked(await trusting(mk("1.1.1.1")))).toBe(false);
    expect(blocked(await trusting(mk("2.2.2.2")))).toBe(false);

    // With none trusted the header must be ignored, so both values collapse
    // into one bucket and the second request is blocked. `store` records the
    // keys so this distinguishes "ignored" from "still honoured".
    const keys: string[] = [];
    const untrusting = hilbrasMiddleware({
      maxRequests: 5,
      windowSeconds: 60,
      trustProxy: 0,
      store: {
        async hit(key: string, windowMs: number) {
          keys.push(key);
          return { count: 1, resetAt: Date.now() + windowMs };
        },
      },
    });

    await untrusting(mk("1.1.1.1"));
    await untrusting(mk("2.2.2.2"));

    // Neither address appears — both fell through to the shared bucket.
    expect(keys).toEqual(["unidentified:/api/chat", "unidentified:/api/chat"]);
  });

  it("uses a trusted x-real-ip as the bucket key", async () => {
    const keys: string[] = [];
    const mw = hilbrasMiddleware({
      trustProxy: 1,
      store: {
        async hit(key: string, windowMs: number) {
          keys.push(key);
          return { count: 1, resetAt: Date.now() + windowMs };
        },
      },
    });

    await mw(createRequest("/api/chat", [], { "x-real-ip": "7.7.7.7" }));

    expect(keys).toEqual(["7.7.7.7:/api/chat"]);
  });

  it("trusts two proxies in the chain", async () => {
    // Junk, real client, nearest hop — two trusted proxies means the client is
    // the second-from-last entry. This exercises the call site with a depth
    // other than 1, so hardcoding `1` in the middleware is detectable.
    const keys: string[] = [];
    const mw = hilbrasMiddleware({
      trustProxy: 2,
      maxRequests: 5,
      store: {
        async hit(key: string, windowMs: number) {
          keys.push(key);
          return { count: 1, resetAt: Date.now() + windowMs };
        },
      },
    });

    await mw(createRequest("/api/chat", ["9.9.9.1", "1.1.1.1", "10.0.0.1"]));

    expect(keys).toEqual(["1.1.1.1:/api/chat"]);
  });

  it("uses a supplied fallbackKey when no header is usable", async () => {
    const mw = hilbrasMiddleware({
      maxRequests: 1,
      windowSeconds: 60,
      trustProxy: 1,
      fallbackKey: (req: any) => `sess-${req.headers.get("cookie") ?? "none"}`,
    });

    const a = createRequest("/api/chat", [], { cookie: "a=1" });
    const b = createRequest("/api/chat", [], { cookie: "b=1" });

    expect(blocked(await mw(a))).toBe(false);
    expect(blocked(await mw(b))).toBe(false);
    expect(blocked(await mw(a))).toBe(true);
  });
});

describe("hilbrasMiddleware — existing behaviour", () => {
  it("allows requests within limit", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 5, windowSeconds: 60, trustProxy: 1 });
    const req = createRequest("/api/chat", ["1.1.1.1"]);
    for (let i = 0; i < 5; i++) {
      expect(blocked(await mw(req))).toBe(false);
    }
  });

  it("blocks requests over limit", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1 });
    const req = createRequest("/api/chat", ["1.1.1.1"]);

    await mw(req);
    await mw(req);
    expect(blocked(await mw(req))).toBe(true);
  });

  it("excludes configured paths", async () => {
    const mw = hilbrasMiddleware({ excludePaths: ["/api/health"], trustProxy: 1 });
    const res = await mw(createRequest("/api/health", ["1.1.1.1"]));
    expect(blocked(res)).toBe(false);
  });

  it("tracks different clients separately", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60, trustProxy: 1 });

    const a = createRequest("/api/chat", ["1.1.1.1"]);
    const b = createRequest("/api/chat", ["2.2.2.2"]);

    expect(blocked(await mw(a))).toBe(false);
    expect(blocked(await mw(b))).toBe(false);
    expect(blocked(await mw(a))).toBe(true);
  });

  it("keys per path as well as per client", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60, trustProxy: 1 });
    const entries = ["1.1.1.1"];

    await mw(createRequest("/api/chat", entries));
    expect(blocked(await mw(createRequest("/api/completion", entries)))).toBe(false);
  });

  it("returns Retry-After header", async () => {
    const mw = hilbrasMiddleware({ maxRequests: 1, windowSeconds: 60, trustProxy: 1 });
    const req = createRequest("/api/chat", ["1.1.1.1"]);

    await mw(req);
    const res = await mw(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("calls a custom onError instead of the default response", async () => {
    const mw = hilbrasMiddleware({
      maxRequests: 1,
      windowSeconds: 60,
      trustProxy: 1,
      onError: (msg) => ({ status: 503, body: msg } as any),
    });
    const req = createRequest("/api/chat", ["1.1.1.1"]);

    await mw(req);
    const res = await mw(req);

    expect(res.status).toBe(503);
    expect(res.body).toBe("Rate limit exceeded");
  });
});

describe("hilbrasMiddleware — pluggable store", () => {
  it("uses the supplied store for counting", async () => {
    const calls: string[] = [];
    const store = {
      async hit(key: string, windowMs: number) {
        calls.push(key);
        return { count: calls.length, resetAt: Date.now() + windowMs };
      },
    };
    const mw = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1, store });

    await mw(createRequest("/api/chat", ["1.1.1.1"]));
    await mw(createRequest("/api/chat", ["1.1.1.1"]));
    const third = await mw(createRequest("/api/chat", ["1.1.1.1"]));

    expect(calls).toEqual(["1.1.1.1:/api/chat", "1.1.1.1:/api/chat", "1.1.1.1:/api/chat"]);
    expect(blocked(third)).toBe(true);
  });

  it("calls store.cleanup when the store provides one", async () => {
    let cleaned = 0;
    const store = {
      async hit(_key: string, windowMs: number) {
        return { count: 1, resetAt: Date.now() + windowMs };
      },
      cleanup() {
        cleaned++;
      },
    };
    const mw = hilbrasMiddleware({ trustProxy: 1, store });

    await mw(createRequest("/api/chat", ["1.1.1.1"]));
    expect(cleaned).toBe(1);
  });

  it("shares one limit across instances when the store is shared", async () => {
    const counts = new Map<string, number>();
    const store = {
      async hit(key: string, windowMs: number) {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { count, resetAt: Date.now() + windowMs };
      },
    };

    // Two app instances, one shared store — the deployment shape the default
    // in-process Map gets wrong.
    const instanceA = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1, store });
    const instanceB = hilbrasMiddleware({ maxRequests: 2, windowSeconds: 60, trustProxy: 1, store });
    const entries = ["1.1.1.1"];

    await instanceA(createRequest("/api/chat", entries));
    await instanceB(createRequest("/api/chat", entries));

    expect(blocked(await instanceA(createRequest("/api/chat", entries)))).toBe(true);
  });
});
