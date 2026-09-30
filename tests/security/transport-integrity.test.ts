/**
 * @hilbras/sdk — Transport integrity
 *
 * Middleware composition re-entry (S4) and streaming error propagation (R10).
 */

import { describe, it, expect } from "vitest";
import { composeMiddlewares, retryMiddleware, authMiddleware, rateLimitMiddleware } from "../../src/middleware/middleware.js";
import { MiddlewareTransport } from "../../src/transport/middleware-transport.js";
import { ProviderRequestError } from "../../src/errors/index.js";
import { RequestSigner, signingMiddleware } from "../../src/security/request-signer.js";
import type { Middleware, MiddlewareContext } from "../../src/middleware/middleware.js";
import type { Transport } from "../../src/transport/transport.js";

const URL_ = "https://api.openai.com/v1/chat/completions";
const ok = (): Response => new Response("ok", { status: 200 });

const transportOf = (
  request: Transport["request"],
): Transport => ({ request, stream: async () => new ReadableStream<Uint8Array>(), abort: () => {} });

const ctxOf = (): MiddlewareContext => ({
  url: URL_,
  init: { method: "POST", headers: {} },
  next: async () => ok(),
});

/** Fails the first `failures` transport calls, then succeeds. */
const flaky = (failures: number, counter: { calls: number }): Transport["request"] => async () => {
  counter.calls += 1;
  if (counter.calls <= failures) throw new Error("transient");
  return ok();
};

describe("composeMiddlewares ordering", () => {
  it("runs the leftmost middleware first", async () => {
    const order: string[] = [];
    const tag = (name: string): Middleware => async (ctx) => {
      order.push(name);
      return ctx.next();
    };
    await composeMiddlewares(tag("a"), tag("b"), tag("c"))(ctxOf());
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("passes the response back out through every stage", async () => {
    const seen: number[] = [];
    const tag = (): Middleware => async (ctx) => {
      const res = await ctx.next();
      seen.push(res.status);
      return res;
    };
    const composed = composeMiddlewares(tag(), tag());
    const res = await composed({
      url: URL_,
      init: { method: "GET" },
      next: async () => new Response("ok", { status: 201 }),
    });
    expect(seen).toEqual([201, 201]);
    expect(res.status).toBe(201);
  });

  it("short-circuits when a stage does not call next", async () => {
    let reached = false;
    const composed = composeMiddlewares(
      async () => new Response("denied", { status: 403 }),
      async (ctx) => {
        reached = true;
        return ctx.next();
      },
    );
    const res = await composed(ctxOf());
    expect(res.status).toBe(403);
    expect(reached).toBe(false);
  });

  it("passes through an empty chain", async () => {
    const res = await composeMiddlewares()(ctxOf());
    expect(res.status).toBe(200);
  });

  it("propagates a throw from an upstream stage", async () => {
    const composed = composeMiddlewares(async () => {
      throw new Error("nope");
    }, async (ctx) => ctx.next());
    await expect(composed(ctxOf())).rejects.toThrow("nope");
  });
});

describe("retry re-entry (S4)", () => {
  it("re-runs downstream stages on every attempt", async () => {
    const counter = { calls: 0 };
    let downstream = 0;
    const counting: Middleware = async (ctx) => {
      downstream += 1;
      return ctx.next();
    };
    const inner = transportOf(flaky(2, counter));
    const transport = new MiddlewareTransport(inner, composeMiddlewares(retryMiddleware(2, 0), counting));

    const res = await transport.request(URL_, { method: "POST", headers: {} });
    expect(res.status).toBe(200);
    expect(counter.calls).toBe(3);
    expect(downstream).toBe(3);
  });

  it("re-signs each attempt with a fresh nonce", async () => {
    const counter = { calls: 0 };
    const nonces: string[] = [];
    const recording: Middleware = async (ctx) => {
      nonces.push(String(ctx.init.headers?.["x-hilbras-nonce"]));
      return ctx.next();
    };
    const signer = new RequestSigner({ secret: "s", profile: "v2" });
    const inner = transportOf(flaky(2, counter));
    const transport = new MiddlewareTransport(
      inner,
      composeMiddlewares(retryMiddleware(2, 0), signingMiddleware(signer), recording),
    );

    await transport.request(URL_, { method: "POST", headers: {}, body: '{"model":"gpt-4o"}' });

    expect(nonces).toHaveLength(3);
    expect(new Set(nonces).size).toBe(3);
  });

  it("re-authenticates each attempt", async () => {
    const counter = { calls: 0 };
    const tokens: string[] = [];
    let current = "token-a";
    const recording: Middleware = async (ctx) => {
      tokens.push(String(ctx.init.headers?.Authorization));
      return ctx.next();
    };
    const inner = transportOf(async () => {
      counter.calls += 1;
      if (counter.calls === 2) current = "token-b";
      if (counter.calls < 3) throw new Error("transient");
      return ok();
    });
    const transport = new MiddlewareTransport(
      inner,
      composeMiddlewares(retryMiddleware(2, 0), authMiddleware(() => current), recording),
    );

    await transport.request(URL_, { method: "POST", headers: {} });
    expect(tokens).toEqual(["Bearer token-a", "Bearer token-a", "Bearer token-b"]);
  });

  it("re-runs a rate limiter per attempt", async () => {
    const counter = { calls: 0 };
    const inner = transportOf(flaky(2, counter));
    const transport = new MiddlewareTransport(
      inner,
      composeMiddlewares(retryMiddleware(2, 0), rateLimitMiddleware({ max: 10, windowMs: 60_000 })),
    );
    // Three attempts against a bucket of ten all succeed.
    await expect(transport.request(URL_, { method: "POST", headers: {} })).resolves.toBeDefined();
    expect(counter.calls).toBe(3);
  });

  it("still throws once retries are exhausted", async () => {
    const counter = { calls: 0 };
    let downstream = 0;
    const counting: Middleware = async (ctx) => {
      downstream += 1;
      return ctx.next();
    };
    const inner = transportOf(flaky(99, counter));
    const transport = new MiddlewareTransport(inner, composeMiddlewares(retryMiddleware(2, 0), counting));

    await expect(transport.request(URL_, { method: "POST", headers: {} })).rejects.toThrow("transient");
    expect(counter.calls).toBe(3);
    expect(downstream).toBe(3);
  });
});

describe("streaming error propagation (R10)", () => {
  const sseBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';

  it("returns the body for a successful stream", async () => {
    const inner: Transport = {
      request: async () => new Response(sseBody, { status: 200 }),
      stream: async () => new ReadableStream<Uint8Array>(),
      abort: () => {},
    };
    const transport = new MiddlewareTransport(inner, composeMiddlewares());
    const stream = await transport.stream(URL_, { method: "POST", headers: {} });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("throws ProviderRequestError instead of returning a 403 body as a stream", async () => {
    const denying: Middleware = async () =>
      new Response(JSON.stringify({ error: "Provider \"x\" is not allowed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    const inner = transportOf(async () => ok());
    const transport = new MiddlewareTransport(inner, composeMiddlewares(denying));

    const error = await transport.stream(URL_, { method: "POST", headers: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).status).toBe(403);
    expect((error as ProviderRequestError).message).toContain("not allowed");
  });

  it("throws for a 429 from a rate limiter", async () => {
    const limiting: Middleware = async () =>
      new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    const inner = transportOf(async () => ok());
    const transport = new MiddlewareTransport(inner, composeMiddlewares(limiting));

    const error = await transport.stream(URL_, { method: "POST", headers: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).status).toBe(429);
  });

  it("throws when a 2xx response has no body", async () => {
    const inner: Transport = {
      request: async () => new Response(null, { status: 204 }),
      stream: async () => new ReadableStream<Uint8Array>(),
      abort: () => {},
    };
    const transport = new MiddlewareTransport(inner, composeMiddlewares());
    await expect(transport.stream(URL_, { method: "POST", headers: {} })).rejects.toThrow(/body is null/);
  });

  it("does not consume the error body twice", async () => {
    let reads = 0;
    const failing: Middleware = async () => {
      const res = new Response("denied", { status: 403 });
      const original = res.text.bind(res);
      res.text = async () => {
        reads += 1;
        return original();
      };
      return res;
    };
    const inner = transportOf(async () => ok());
    const transport = new MiddlewareTransport(inner, composeMiddlewares(failing));
    await transport.stream(URL_, { method: "POST", headers: {} }).catch(() => undefined);
    expect(reads).toBe(1);
  });
});
