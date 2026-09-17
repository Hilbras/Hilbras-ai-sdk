/**
 * @hilbras/sdk — FetchTransport
 *
 * Native fetch-based transport. Works in Node 18+, Bun, Deno, and browsers.
 *
 * v0.10.0: tracks every in-flight request's AbortController in a Set so that
 * `abort()` cancels *all* in-flight requests, not just the most recent one.
 * Previously, a single `_controller` field was overwritten on every `request()`
 * call, which meant concurrent requests could not all be aborted.
 */

import type { Transport, TransportRequestInit } from "./transport.js";

export class FetchTransport implements Transport {
  /**
   * Every in-flight request's AbortController. A request adds itself on
   * entry and removes itself on completion (success, error, or abort).
   * `abort()` iterates this set and aborts every controller, so a single
   * `abort()` call cancels all concurrent in-flight requests.
   */
  private _controllers = new Set<AbortController>();

  async request(url: string, init: TransportRequestInit): Promise<Response> {
    const controller = new AbortController();
    this._controllers.add(controller);
    const signal = init.signal ?? controller.signal;
    try {
      return await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal,
      });
    } finally {
      this._controllers.delete(controller);
    }
  }

  async stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(url, init);
    if (!res.body) {
      throw new Error(`Response body is null for ${url}`);
    }
    return res.body;
  }

  /**
   * Abort all in-flight requests. Safe to call when no requests are
   * in flight (no-op). Safe to call concurrently with new requests —
   * any request that started before this call is cancelled; requests
   * that start after this call are unaffected.
   */
  abort(): void {
    for (const controller of this._controllers) {
      controller.abort();
    }
    this._controllers.clear();
  }
}
