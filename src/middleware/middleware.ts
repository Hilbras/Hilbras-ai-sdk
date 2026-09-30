/**
 * @hilbras/sdk — Middleware System
 *
 * Interceptors that wrap the transport layer for cross-cutting concerns.
 */

import type { TransportRequestInit } from "../transport/transport.js";

export interface MiddlewareContext {
  url: string;
  init: TransportRequestInit;
  next: () => Promise<Response>;
}

export type Middleware = (ctx: MiddlewareContext) => Promise<Response>;

/**
 * Compose middlewares into a single middleware. The leftmost middleware runs
 * first.
 *
 * Each `next()` re-enters the chain at the following index rather than
 * consuming a shared cursor, so a stage that calls `next()` more than once —
 * `retryMiddleware`, for example — re-runs every downstream stage on each
 * attempt. A shared monotonic cursor permanently exhausts the chain after the
 * first attempt, which silently skipped signing and auth on all retries.
 */
export function composeMiddlewares(...middlewares: Middleware[]): Middleware {
  return async (ctx: MiddlewareContext) => {
    const invoke = async (index: number): Promise<Response> => {
      if (index >= middlewares.length) return ctx.next();
      const mw = middlewares[index];
      return mw({ ...ctx, next: () => invoke(index + 1) });
    };
    return invoke(0);
  };
}

export function authMiddleware(getToken: () => string): Middleware {
  return async (ctx) => {
    const token = getToken();
    if (token) {
      ctx.init.headers = { ...ctx.init.headers, Authorization: `Bearer ${token}` };
    }
    return ctx.next();
  };
}

export function loggingMiddleware(log: (msg: string) => void = console.log): Middleware {
  return async (ctx) => {
    const start = Date.now();
    log(`→ ${ctx.init.method} ${ctx.url}`);
    try {
      const res = await ctx.next();
      log(`← ${res.status} (${Date.now() - start}ms)`);
      return res;
    } catch (err) {
      log(`✗ error: ${err}`);
      throw err;
    }
  };
}

export function retryMiddleware(maxRetries = 3, baseDelay = 1000): Middleware {
  return async (ctx) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await ctx.next();
      } catch (err) {
        if (ctx.init.signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt) + Math.random() * 100));
        }
      }
    }
    throw lastError!;
  };
}

export function rateLimitMiddleware(minDelayMs = 100): Middleware {
  let lastRequestTime = 0;
  return async (ctx) => {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < minDelayMs) await new Promise((r) => setTimeout(r, minDelayMs - elapsed));
    lastRequestTime = Date.now();
    return ctx.next();
  };
}

export function cacheMiddleware(ttlMs = 60_000, maxEntries = 1_000): Middleware {
  const cache = new Map<string, { response: Response; expiresAt: number }>();
  return async (ctx) => {
    if (ctx.init.method !== "GET" && ctx.init.method) return ctx.next();

    const headers = Object.entries(ctx.init.headers ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([ctx.init.method || "GET", ctx.url, headers]);

    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.response.clone();
    }
    if (cached) cache.delete(key);

    const res = await ctx.next();
    if (res.ok) {
      cache.set(key, { response: res.clone(), expiresAt: Date.now() + ttlMs });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
    return res;
  };
}
