/**
 * @hilbras/sdk — WebSocket Transport
 *
 * Real-time bidirectional transport for providers that support WebSocket
 * connections (e.g., Kimi Code's kap-server, OpenAI's real-time API).
 *
 * Falls back to FetchTransport when WebSocket is not available.
 *
 * NOTE: Node 18–21 does not have a global WebSocket. Either:
 *   - Upgrade to Node 22+ (which ships global WebSocket)
 *   - Install a polyfill like `ws` and assign it to globalThis.WebSocket
 *   - Use this transport only in browser/Deno/Bun environments
 */

import type { Transport, TransportRequestInit } from "./transport.js";

function getWebSocketConstructor(): typeof WebSocket {
  // Node 22+, Bun, Deno, and browsers all expose globalThis.WebSocket
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  throw new Error(
    "WebSocket is not available in this environment. " +
    "For Node 18–21, install a WebSocket polyfill (e.g., `ws`) and assign it to globalThis.WebSocket, " +
    "or upgrade to Node 22+ which ships a built-in WebSocket."
  );
}

export class WebSocketTransport implements Transport {
  private _url: string;
  private _ws: WebSocket | null = null;
  private _pending: Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }> = new Map();
  private _counter = 0;

  constructor(url: string) {
    this._url = url;
  }

  private _ensureConnection(): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return;
    const WS = getWebSocketConstructor();
    this._ws = new WS(this._url);
    this._ws.binaryType = "arraybuffer";

    this._ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data));
        const pending = this._pending.get(data.id);
        if (pending) {
          this._pending.delete(data.id);
          const stream = new ReadableStream({
            start(controller) {
              if (data.body) controller.enqueue(new TextEncoder().encode(data.body));
              controller.close();
            },
          });
          pending.resolve(new Response(stream, { status: data.status ?? 200, headers: data.headers ?? {} }));
        }
      } catch {
        // Ignore parse errors
      }
    };

    this._ws.onerror = (event) => {
      for (const pending of this._pending.values()) {
        pending.reject(new Error(`WebSocket error: ${(event as ErrorEvent).message ?? "unknown"}`));
      }
      this._pending.clear();
    };
  }

  async request(url: string, init: TransportRequestInit): Promise<Response> {
    this._ensureConnection();
    const id = `req_${++this._counter}`;

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._ws!.send(JSON.stringify({ id, method: init.method, url, headers: init.headers, body: init.body }));
    });
  }

  async stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(url, init);
    if (!res.body) throw new Error("No response body");
    return res.body;
  }

  abort(): void {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const pending of this._pending.values()) {
      pending.reject(new Error("Transport aborted"));
    }
    this._pending.clear();
  }
}
