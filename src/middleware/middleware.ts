/**
 * @hilbras/sdk — Middleware System
 *
 * Interceptors that wrap the transport layer for cross-cutting concerns.
 */

import type { Transport, TransportRequestInit } from "../transport/transport.js";

export interface MiddlewareContext {
  url: string;
  init: TransportRequestInit;
  next: () => Promise<Response>;
}

export type Middleware = (ctx: MiddlewareContext) => Promise<Response>;

export function composeMiddlewares(...middlewares: Middleware[]): Middleware {
  return async (ctx: MiddlewareContext) => {
    let idx = 0;
    const next = async (): Promise<Response> => {
      if (idx >= middlewares.length) return ctx.next();
      const mw = middlewares[idx++];
      return mw({ ...ctx, next });
    };
    return next();
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

export function cacheMiddleware(ttlMs = 60_000): Middleware {
  const cache = new Map<string, { response: Response; expiresAt: number }>();
  return async (ctx) => {
    if (ctx.init.method === "GET" || !ctx.init.method) {
      const cached = cache.get(ctx.url);
      if (cached && cached.expiresAt > Date.now()) return cached.response.clone();
      const res = await ctx.next();
      if (res.ok) cache.set(ctx.url, { response: res.clone(), expiresAt: Date.now() + ttlMs });
      return res;
    }
    return ctx.next();
  };
}
