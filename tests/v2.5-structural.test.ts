/**
 * @hilbras/sdk — v2.5.0 Structural Improvements Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { MiddlewareTransport } from "../src/transport/middleware-transport.js";
import { composeMiddlewares, authMiddleware, loggingMiddleware } from "../src/middleware/middleware.js";
import { setTokenizer, getTokenizer, estimateTokens } from "../src/tokens/counter.js";
import type { Transport, TransportRequestInit } from "../src/transport/transport.js";
import type { Middleware, MiddlewareContext } from "../src/middleware/middleware.js";
import type { StreamChunk } from "../src/types/streams.js";
import type { ProviderConfig } from "../src/types/providers.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockTransport(responseBody: string, status = 200): Transport {
  return {
    async request() {
      return new Response(responseBody, { status, headers: { "Content-Type": "application/json" } });
    },
    async stream() {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(responseBody));
          controller.close();
        },
      });
      return stream;
    },
    abort() {},
  };
}

const MOCK_PROVIDER: ProviderConfig = {
  name: "TestProvider",
  baseUrl: "https://api.test.com/v1",
  authentication: { type: "bearer", apiKey: "sk-test-key" },
  adapter: "openai",
  models: [{ id: "test-model", contextWindow: 4096, maxOutputTokens: 1024 }],
};

// ─── BUG-04: Per-Client Tokenizer ─────────────────────────────────────────

describe("BUG-04: Per-client tokenizer", () => {
  let savedTokenizer: ReturnType<typeof getTokenizer>;

  beforeEach(() => {
    savedTokenizer = getTokenizer();
    setTokenizer(null);
  });

  afterEach(() => {
    setTokenizer(savedTokenizer);
  });

  it("stores per-client tokenizer in client config", () => {
    const tokenizer = { count: () => 42 };
    const client = new HilbrasClient({ tokenizer });
    expect((client as any)._tokenizer).toBe(tokenizer);
  });

  it("defaults to null when no tokenizer configured", () => {
    const client = new HilbrasClient();
    expect((client as any)._tokenizer).toBeNull();
  });

  it("multiple clients can use different tokenizers simultaneously", () => {
    const tokA = { count: (t: string) => t.length * 10 };
    const tokB = { count: (t: string) => t.length * 20 };
    const clientA = new HilbrasClient({ tokenizer: tokA });
    const clientB = new HilbrasClient({ tokenizer: tokB });
    expect((clientA as any)._tokenizer!.count("hello")).toBe(50);
    expect((clientB as any)._tokenizer!.count("hello")).toBe(100);
  });

  it("per-client tokenizer takes precedence over global setTokenizer", () => {
    setTokenizer({ count: () => 999 });
    const client = new HilbrasClient({ tokenizer: { count: () => 42 } });
    expect((client as any)._tokenizer!.count("test")).toBe(42);
  });

  it("falls back to global estimateTokens when no per-client tokenizer", () => {
    const client = new HilbrasClient();
    // _estimateTokens should use the global
    expect((client as any)._tokenizer).toBeNull();
    // The default heuristic: "hello" → 2 tokens
    expect(estimateTokens("hello")).toBe(2);
  });

  it("_estimateTokens uses client tokenizer when set", () => {
    const client = new HilbrasClient({ tokenizer: { count: () => 77 } });
    const result = (client as any)._estimateTokens("any text");
    expect(result).toBe(77);
  });

  it("_estimateTokens uses global when no client tokenizer", () => {
    const client = new HilbrasClient();
    const result = (client as any)._estimateTokens("hello");
    expect(result).toBe(estimateTokens("hello"));
  });
});

// ─── MiddlewareTransport ───────────────────────────────────────────────────

describe("MiddlewareTransport", () => {
  it("delegates to inner transport", async () => {
    const inner: Transport = {
      async request(url) { return new Response(`url:${url}`); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const t = new MiddlewareTransport(inner, async (ctx) => ctx.next());
    const res = await t.request("https://x.com/v1", { method: "GET" });
    expect(await res.text()).toBe("url:https://x.com/v1");
  });

  it("middleware can add headers", async () => {
    let headers: Record<string, string> = {};
    const inner: Transport = {
      async request(_url, init) {
        headers = (init.headers as Record<string, string>) ?? {};
        return new Response("ok");
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const mw: Middleware = async (ctx) => {
      ctx.init.headers = { ...ctx.init.headers, "X-Custom": "yes" };
      return ctx.next();
    };
    const t = new MiddlewareTransport(inner, mw);
    await t.request("https://x.com", { method: "POST" });
    expect(headers["X-Custom"]).toBe("yes");
  });

  it("middleware can short-circuit", async () => {
    const inner: Transport = {
      async request() { throw new Error("should not call"); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const t = new MiddlewareTransport(inner, async (_ctx) => new Response("cached"));
    const res = await t.request("https://x.com", {});
    expect(await res.text()).toBe("cached");
  });

  it("middleware can modify response body", async () => {
    const inner: Transport = {
      async request() { return new Response("original"); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const mw: Middleware = async (ctx) => {
      const res = await ctx.next();
      return new Response((await res.text()) + " [wrapped]");
    };
    const t = new MiddlewareTransport(inner, mw);
    const res = await t.request("https://x.com", {});
    expect(await res.text()).toBe("original [wrapped]");
  });

  it("stream() returns response body after middleware", async () => {
    const encoder = new TextEncoder();
    const inner: Transport = {
      async request() {
        const stream = new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(encoder.encode("streamed")); c.close(); },
        });
        return new Response(stream);
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const t = new MiddlewareTransport(inner, async (ctx) => ctx.next());
    const body = await t.stream("https://x.com", {});
    const reader = body.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("streamed");
  });

  it("stream() throws when response body is null", async () => {
    const inner: Transport = {
      async request() { return new Response(null); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const t = new MiddlewareTransport(inner, async (ctx) => ctx.next());
    await expect(t.stream("https://x.com", {})).rejects.toThrow("body is null");
  });

  it("abort() delegates to inner", () => {
    let called = false;
    const inner: Transport = {
      async request() { return new Response(); },
      async stream() { throw new Error("unused"); },
      abort() { called = true; },
    };
    new MiddlewareTransport(inner, async (ctx) => ctx.next()).abort();
    expect(called).toBe(true);
  });

  it("destroy() delegates to inner", () => {
    let called = false;
    const inner: any = {
      async request() { return new Response(); },
      async stream() { throw new Error("unused"); },
      abort() {},
      destroy() { called = true; },
    };
    new MiddlewareTransport(inner, async (ctx) => ctx.next()).destroy();
    expect(called).toBe(true);
  });

  it("chains with composeMiddlewares", async () => {
    const order: string[] = [];
    const mw1: Middleware = async (ctx) => { order.push("1"); const r = await ctx.next(); order.push("1-end"); return r; };
    const mw2: Middleware = async (ctx) => { order.push("2"); const r = await ctx.next(); order.push("2-end"); return r; };
    const inner: Transport = {
      async request() { order.push("inner"); return new Response("ok"); },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const composed = composeMiddlewares(mw1, mw2);
    const t = new MiddlewareTransport(inner, composed);
    await t.request("https://x.com", {});
    expect(order).toEqual(["1", "2", "inner", "2-end", "1-end"]);
  });
});

// ─── Client Middleware Config ──────────────────────────────────────────────

describe("HilbrasClient middleware config", () => {
  it("wraps transport when middleware is provided", () => {
    const client = new HilbrasClient({ middleware: async (ctx) => ctx.next() });
    expect((client as any)._transport.constructor.name).toBe("MiddlewareTransport");
  });

  it("does not wrap transport when no middleware", () => {
    const client = new HilbrasClient();
    expect((client as any)._transport.constructor.name).toBe("FetchTransport");
  });

  it("applies middleware to complete() requests", async () => {
    let called = false;
    const testMw: Middleware = async (ctx) => { called = true; return ctx.next(); };
    const client = new HilbrasClient({
      middleware: testMw,
      transport: mockTransport(JSON.stringify({ choices: [{ message: { content: "hi" } }] })),
    });
    client.addProvider(MOCK_PROVIDER);
    const result = await client.complete({
      provider: "TestProvider",
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(called).toBe(true);
    expect(result).toBe("hi");
  });

  it("authMiddleware adds Bearer token", async () => {
    let headers: Record<string, string> = {};
    const mockT: Transport = {
      async request(_url, init) {
        headers = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const client = new HilbrasClient({
      middleware: authMiddleware(() => "my-token-12345"),
      transport: mockT,
    });
    client.addProvider(MOCK_PROVIDER);
    await client.complete({
      provider: "TestProvider",
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(headers["Authorization"]).toBe("Bearer my-token-12345");
  });

  it("deprecated setTokenizer still works (backward compat)", () => {
    setTokenizer({ count: () => 999 });
    expect(getTokenizer()?.count("test")).toBe(999);
    setTokenizer(null);
  });
});

// ─── chunk Factory (backward compat) ──────────────────────────────────────

describe("chunk factory (backward compat)", () => {
  it("still constructs typed chunks", async () => {
    const { chunk } = await import("../src/types/streams.js");
    expect(chunk.text("hello")).toEqual({ type: "text", text: "hello" });
    expect(chunk.usage(100, 50)).toEqual({ type: "usage", inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    expect(chunk.error("fail", true)).toEqual({ type: "error", message: "fail", retryable: true });
    expect(chunk.reasoning("think")).toEqual({ type: "reasoning", text: "think" });
  });
});
