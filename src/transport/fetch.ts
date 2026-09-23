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

    // Clean up idle connections periodically
    if (typeof setInterval !== "undefined") {
      this._cleanupTimer = setInterval(() => this._cleanupPools(), this._idleTimeout);
    }
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

    const requestFn = async (): Promise<Response> => {
      try {
        const headers = init.headers
          ? Object.fromEntries(Object.entries(init.headers).filter(([, v]) => v !== undefined) as [string, string][])
          : undefined;
        return await fetch(url, {
          method: init.method,
          headers,
          body: init.body,
          signal: controller.signal,
          redirect: "error",
        });
      } finally {
        externalSignal?.removeEventListener("abort", onExternalAbort);
        this._controllers.delete(controller);
        this._release(origin);
      }
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
