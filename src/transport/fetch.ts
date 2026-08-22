/**
 * @hilbras/sdk — FetchTransport
 *
 * Native fetch-based transport. Works in Node 18+, Bun, Deno, and browsers.
 */

import type { Transport, TransportRequestInit } from "./transport.js";

export class FetchTransport implements Transport {
  private _controller: AbortController | null = null;

  async request(url: string, init: TransportRequestInit): Promise<Response> {
    this._controller = new AbortController();
    const signal = init.signal ?? this._controller.signal;

    return fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal,
    });
  }

  async stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(url, init);
    if (!res.body) {
      throw new Error(`Response body is null for ${url}`);
    }
    return res.body;
  }

  abort(): void {
    this._controller?.abort();
    this._controller = null;
  }
}
