import { describe, it, expect, vi } from "vitest";
import {
  composeMiddlewares,
  authMiddleware,
  loggingMiddleware,
  retryMiddleware,
  rateLimitMiddleware,
  cacheMiddleware,
} from "../src/middleware/middleware.js";
import type { MiddlewareContext } from "../src/middleware/middleware.js";

function mockCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    url: "https://api.example.com/v1/chat",
    init: { method: "POST", body: "{}" },
    next: async () => new Response("ok", { status: 200 }),
    ...overrides,
  };
}

describe("composeMiddlewares", () => {
  it("chains middlewares in order", async () => {
    const order: string[] = [];
    const mw1 = async (ctx: MiddlewareContext) => { order.push("mw1-before"); const res = await ctx.next(); order.push("mw1-after"); return res; };
    const mw2 = async (ctx: MiddlewareContext) => { order.push("mw2-before"); const res = await ctx.next(); order.push("mw2-after"); return res; };

    const composed = composeMiddlewares(mw1, mw2);
    await composed(mockCtx());
    expect(order).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
  });

  it("calls transport when all middlewares exhausted", async () => {
    let called = false;
    const mw = async (ctx: MiddlewareContext) => { called = true; return ctx.next(); };
    const composed = composeMiddlewares(mw);
    const res = await composed(mockCtx());
    expect(called).toBe(true);
    expect(await res.text()).toBe("ok");
  });
});

describe("authMiddleware", () => {
  it("adds Authorization header from token function", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mw = authMiddleware(() => "my-token");
    const ctx = mockCtx({
      next: async () => { return new Response("ok"); },
    });
    const origNext = ctx.next;
    ctx.next = async () => {
      capturedHeaders = { ...ctx.init.headers };
      return origNext();
    };
    await mw(ctx);
    expect(capturedHeaders["Authorization"]).toBe("Bearer my-token");
  });

  it("does not add header when token is empty", async () => {
    const mw = authMiddleware(() => "");
    const ctx = mockCtx();
    await mw(ctx);
    expect(ctx.init.headers?.["Authorization"]).toBeUndefined();
  });
});

describe("loggingMiddleware", () => {
  it("logs request and response", async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    await mw(mockCtx());
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("POST");
    expect(logs[1]).toContain("200");
  });

  it("logs errors", async () => {
    const logs: string[] = [];
    const mw = loggingMiddleware((msg) => logs.push(msg));
    const ctx = mockCtx({ next: async () => { throw new Error("boom"); } });
    await expect(mw(ctx)).rejects.toThrow("boom");
    expect(logs.some((l) => l.includes("error"))).toBe(true);
  });
});

describe("retryMiddleware", () => {
  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const mw = retryMiddleware(3, 1);
    const ctx = mockCtx({
      next: async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return new Response("ok");
      },
    });
    const res = await mw(ctx);
    expect(attempts).toBe(3);
    expect(await res.text()).toBe("ok");
  });

  it("throws after exhausting retries", async () => {
    let attempts = 0;
    const mw = retryMiddleware(2, 1);
    const ctx = mockCtx({
      next: async () => { attempts++; throw new Error("always fail"); },
    });
    await expect(mw(ctx)).rejects.toThrow("always fail");
    expect(attempts).toBe(3);
  });
});

describe("rateLimitMiddleware", () => {
  it("delays requests that come too fast", async () => {
    const mw = rateLimitMiddleware(50);
    const ctx = mockCtx();

    const start = Date.now();
    await mw(ctx);
    const first = Date.now() - start;

    const ctx2 = mockCtx();
    const start2 = Date.now();
    await mw(ctx2);
    const second = Date.now() - start2;

    // Second call should be delayed
    expect(second).toBeGreaterThanOrEqual(40);
  });
});

describe("cacheMiddleware", () => {
  it("caches GET responses", async () => {
    let callCount = 0;
    const mw = cacheMiddleware(60_000);
    const ctx = mockCtx({ init: { method: "GET" }, next: async () => { callCount++; return new Response("cached-body"); } });

    const res1 = await mw(ctx);
    expect(await res1.text()).toBe("cached-body");
    expect(callCount).toBe(1);

    const res2 = await mw(ctx);
    expect(await res2.text()).toBe("cached-body");
    expect(callCount).toBe(1);
  });

  it("does not cache POST requests", async () => {
    let callCount = 0;
    const mw = cacheMiddleware(60_000);
    const ctx = mockCtx({ init: { method: "POST", body: "{}" }, next: async () => { callCount++; return new Response("fresh"); } });

    await mw(ctx);
    await mw(ctx);
    expect(callCount).toBe(2);
  });
});
