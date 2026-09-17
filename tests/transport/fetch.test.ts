/**
 * @hilbras/sdk — tests/transport/fetch.test.ts
 *
 * v0.10.0 PR-3: per-request AbortController in FetchTransport.
 * The pre-PR-3 bug: a single `_controller` field was overwritten on every
 * `request()` call, so `abort()` only cancelled the most recent in-flight
 * request. Concurrent requests (e.g. parallel `client.stream()` and
 * `client.complete()`) could not all be cancelled.
 */

import { describe, it, expect, vi } from "vitest";
import { FetchTransport } from "../../src/transport/fetch.js";

describe("FetchTransport per-request AbortController (PR-3)", () => {
  it("aborts all in-flight requests, not just the most recent", async () => {
    const t = new FetchTransport();
    // Build a fetch mock that returns a never-resolving Response (so the
    // requests stay in-flight until we abort). We attach our own controller
    // so we can observe when the signal is fired.
    const signals: AbortSignal[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: any, init: any) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }) as typeof fetch;
    try {
      const p1 = t.request("https://a.example/", { method: "GET" }).catch((e: unknown) => e);
      const p2 = t.request("https://b.example/", { method: "GET" }).catch((e: unknown) => e);
      const p3 = t.request("https://c.example/", { method: "GET" }).catch((e: unknown) => e);
      // Give the microtask queue a chance to register all three.
      await new Promise((r) => setTimeout(r, 0));

      expect(signals).toHaveLength(3);
      const [s1, s2, s3] = signals;
      expect(s1!.aborted).toBe(false);
      expect(s2!.aborted).toBe(false);
      expect(s3!.aborted).toBe(false);

      t.abort();

      expect(s1!.aborted).toBe(true);
      expect(s2!.aborted).toBe(true);
      expect(s3!.aborted).toBe(true);

      // All three promises reject with AbortError.
      const results = await Promise.all([p1, p2, p3]);
      for (const r of results) {
        expect((r as Error).name).toBe("AbortError");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("abort() is a no-op when no requests are in flight", () => {
    const t = new FetchTransport();
    expect(() => t.abort()).not.toThrow();
    expect(() => t.abort()).not.toThrow();
  });

  it("completed requests are removed from the in-flight set", async () => {
    const t = new FetchTransport();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    try {
      await t.request("https://a.example/", { method: "GET" });
      await t.request("https://b.example/", { method: "GET" });
      // After both complete, abort() should not throw or have any side effect.
      expect(() => t.abort()).not.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a new request after abort() runs to completion unaffected", async () => {
    const t = new FetchTransport();
    const originalFetch = globalThis.fetch;
    let callIndex = 0;
    globalThis.fetch = vi.fn((_url: any, init: any) => {
      callIndex++;
      if (callIndex === 1) {
        // First call: stay in-flight until aborted.
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      // Subsequent calls: succeed.
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;
    try {
      const p1 = t.request("https://a.example/", { method: "GET" }).catch((e: unknown) => e);
      // Give the microtask queue a chance to register p1.
      await new Promise((r) => setTimeout(r, 0));

      t.abort();
      const r1 = await p1;
      expect((r1 as Error).name).toBe("AbortError");

      // A new request after abort should succeed normally.
      const r2 = await t.request("https://b.example/", { method: "GET" });
      expect(r2.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("user-supplied signal aborts the request, not the transport-wide abort()", async () => {
    const t = new FetchTransport();
    const userController = new AbortController();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: any, init: any) => {
      const signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }) as typeof fetch;
    try {
      const p = t.request("https://a.example/", { method: "GET", signal: userController.signal }).catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 0));

      userController.abort();
      const r = await p;
      expect((r as Error).name).toBe("AbortError");

      // After the user abort, the transport's controller set should be empty.
      // A subsequent transport.abort() is a no-op (no other requests).
      expect(() => t.abort()).not.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
