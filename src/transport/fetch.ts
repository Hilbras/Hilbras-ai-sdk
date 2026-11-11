/**
 * @hilbras/sdk — FetchTransport
 *
 * Native fetch-based transport with connection pooling. Works in Node 18+, Bun, Deno, and browsers.
 *
 * Features:
 * - Connection pooling: reuse connections to the same origin
 * - Request coalescing: deduplicate identical in-flight requests
 * - Abort all in-flight requests with abort()
 */

import type { Transport, TransportRequestInit } from "./transport.js";

interface PoolEntry {
  count: number;
  lastUsed: number;
}

export interface FetchTransportOptions {
  /** Max connections per origin (default: 6) */
  maxConnectionsPerOrigin?: number;
  /** Connection idle timeout in ms (default: 30000) */
  idleTimeout?: number;
  /** Enable request coalescing for identical requests (default: false) */
  coalesceRequests?: boolean;
}

export class FetchTransport implements Transport {
  private _controllers = new Set<AbortController>();
  private _pools = new Map<string, PoolEntry>();
  private _pendingRequests = new Map<string, Promise<Response>>();
  private _maxConnections: number;
  private _idleTimeout: number;
  private _coalesce: boolean;
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: FetchTransportOptions = {}) {
    this._maxConnections = options.maxConnectionsPerOrigin ?? 6;
    this._idleTimeout = options.idleTimeout ?? 30000;
    this._coalesce = options.coalesceRequests ?? false;
  }

  /**
   * Start the idle-connection cleanup timer on first use.
   *
   * The timer is deliberately lazy. A client that never issues a request —
   * including one whose constructor throws before the caller can dispose it —
   * then holds no interval, so a failed construction cannot leave a repeating
   * timer that pins the Node event loop open.
   */
  private _ensureCleanupTimer(): void {
    if (this._cleanupTimer !== null || typeof setInterval === "undefined") return;
    this._cleanupTimer = setInterval(() => this._cleanupPools(), this._idleTimeout);
    // Never keep a process alive just to age out an idle connection pool.
    this._cleanupTimer.unref?.();
  }

  private _getOrigin(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  }

  private _acquire(origin: string): boolean {
    const entry = this._pools.get(origin);
    if (!entry) {
      this._pools.set(origin, { count: 1, lastUsed: Date.now() });
      return true;
    }
    if (entry.count < this._maxConnections) {
      entry.count++;
      entry.lastUsed = Date.now();
      return true;
    }
    return false;
  }

  private _release(origin: string): void {
    const entry = this._pools.get(origin);
    if (entry) {
      entry.count--;
      entry.lastUsed = Date.now();
      if (entry.count <= 0) {
        this._pools.delete(origin);
      }
    }
  }

  private _cleanupPools(): void {
    const now = Date.now();
    for (const [origin, entry] of this._pools) {
      if (now - entry.lastUsed > this._idleTimeout && entry.count <= 0) {
        this._pools.delete(origin);
      }
    }
  }

  private _getRequestKey(url: string, init: TransportRequestInit): string | null {
    // Signal-bearing and non-serializable requests must not share an underlying
    // fetch: one caller's cancellation must never affect another caller.
    if (init.signal || (init.body !== undefined && typeof init.body !== "string")) return null;

    const headers = Object.entries(init.headers ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([init.method || "GET", url, init.body ?? "", headers]);
  }

  async request(url: string, init: TransportRequestInit): Promise<Response> {
    this._ensureCleanupTimer();
    const origin = this._getOrigin(url);
    const externalSignal = init.signal;

    if (externalSignal?.aborted) {
      throw externalSignal.reason instanceof Error
        ? externalSignal.reason
        : new DOMException("The operation was aborted", "AbortError");
    }

    // Request coalescing: deduplicate only requests whose complete wire
    // identity is known and which have no caller-owned cancellation.
    const requestKey = this._coalesce ? this._getRequestKey(url, init) : null;
    if (requestKey) {
      const pending = this._pendingRequests.get(requestKey);
      if (pending) return (await pending).clone();
    }

    // Wait for a connection slot without ignoring caller cancellation.
    while (!this._acquire(origin)) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          externalSignal?.removeEventListener("abort", onAbort);
          resolve();
        }, 10);
        const onAbort = () => {
          clearTimeout(timer);
          reject(externalSignal!.reason instanceof Error
            ? externalSignal!.reason
            : new DOMException("The operation was aborted", "AbortError"));
        };
        externalSignal?.addEventListener("abort", onAbort, { once: true });
      });
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      if (externalSignal.aborted) onExternalAbort();
    }
    this._controllers.add(controller);

    // The connection slot and the controller registration are held until the
    // response BODY finishes, not until the headers arrive. Releasing at headers
    // made `maxConnectionsPerOrigin` cosmetic for streams, and let
    // destroy()/abort() forget a body that was still being read.
    const settle = (): void => {
      externalSignal?.removeEventListener("abort", onExternalAbort);
      this._controllers.delete(controller);
      this._release(origin);
    };

    const requestFn = async (): Promise<Response> => {
      let response: Response;
      try {
        const headers = init.headers
          ? Object.fromEntries(Object.entries(init.headers).filter(([, v]) => v !== undefined) as [string, string][])
          : undefined;
        response = await fetch(url, {
          method: init.method,
          headers,
          body: init.body,
          signal: controller.signal,
          redirect: "error",
        });
      } catch (error) {
        // No response arrived, so no body will complete to release the slot.
        settle();
        throw error;
      }

      // 204/205/304 and similar carry no body to wait for.
      if (!response.body) {
        settle();
        return response;
      }

      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(out) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              settle();
              out.close();
              return;
            }
            out.enqueue(value);
          } catch (error) {
            settle();
            out.error(error);
          }
        },
        cancel(reason) {
          settle();
          return reader.cancel(reason);
        },
      });

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };

    const promise = requestFn();

    if (requestKey) {
      this._pendingRequests.set(requestKey, promise);
      try {
        return await promise;
      } finally {
        this._pendingRequests.delete(requestKey);
      }
    }

    return await promise;
  }

  async stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(url, init);
    if (!res.body) {
      throw new Error(`Response body is null for ${url}`);
    }
    return res.body;
  }

  /**
   * Clean up resources. Call this when the transport is no longer needed.
   */
  destroy(): void {
    if (this._cleanupTimer !== null) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.abort();
  }

  /**
   * Abort all in-flight requests.
   */
  abort(): void {
    for (const controller of this._controllers) {
      controller.abort();
    }
    this._controllers.clear();
    this._pendingRequests.clear();
  }

  /**
   * Get connection pool stats.
   */
  getPoolStats(): Record<string, { count: number; lastUsed: number }> {
    const stats: Record<string, { count: number; lastUsed: number }> = {};
    for (const [origin, entry] of this._pools) {
      stats[origin] = { count: entry.count, lastUsed: entry.lastUsed };
    }
    return stats;
  }
}
