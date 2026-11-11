/**
 * @hilbras/sdk — FetchTransport connection slots (E6)
 *
 * `request()` released the per-origin slot — and deregistered its
 * AbortController — inside the `finally` around `fetch()`, which runs when the
 * response *headers* arrive. The body was still unread at that point, so
 * `maxConnectionsPerOrigin` limited nothing for streams, and `destroy()` had
 * already forgotten any body still being read.
 */

import { describe, expect, it, vi } from "vitest";
import { FetchTransport } from "../../src/transport/fetch.js";

const ORIGIN = "https://a.example";

/** Replace global fetch with a stream whose body the test controls. */
function stubStreamingFetch() {
  const state: { body?: ReadableStreamDefaultController<Uint8Array> } = {};
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        state.body = controller;
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { state, restore: () => { globalThis.fetch = original; } };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("FetchTransport holds a slot until the body finishes", () => {
  it("enforces maxConnectionsPerOrigin while a stream body is unread", async () => {
    const stub = stubStreamingFetch();
    const transport = new FetchTransport({ maxConnectionsPerOrigin: 1 });

    try {
      const first = await transport.request(`${ORIGIN}/one`, { method: "GET" });
      let secondSettled = false;
      const second = transport
        .request(`${ORIGIN}/two`, { method: "GET" })
        .then((response) => {
          secondSettled = true;
          return response;
        });

      await tick(30);
      // The first body is still open, so the second request must be waiting.
      expect(secondSettled).toBe(false);
      expect(transport.getPoolStats()[ORIGIN]?.count).toBe(1);

      stub.state.body?.close();
      await first.text();

      await tick(30);
      expect(secondSettled).toBe(true);
      await second;
    } finally {
      stub.restore();
      transport.destroy();
    }
  });

  it("releases the slot when the consumer cancels the body", async () => {
    const stub = stubStreamingFetch();
    const transport = new FetchTransport({ maxConnectionsPerOrigin: 1 });

    try {
      const first = await transport.request(`${ORIGIN}/one`, { method: "GET" });
      expect(transport.getPoolStats()[ORIGIN]?.count).toBe(1);

      await first.body!.cancel();

      // `_release` drops the origin entry once its count reaches zero.
      expect(transport.getPoolStats()[ORIGIN]?.count ?? 0).toBe(0);
    } finally {
      stub.restore();
      transport.destroy();
    }
  });
});
