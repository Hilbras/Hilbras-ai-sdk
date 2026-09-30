/**
 * @hilbras/sdk — Middleware Transport Wrapper
 *
 * Wraps any Transport with a middleware pipeline. Each middleware can inspect
 * and modify requests before they reach the underlying transport, and
 * intercept responses on the way back.
 *
 * This is the bridge between the `middleware/` module and the transport layer,
 * allowing cross-cutting concerns (auth, logging, rate limiting, caching)
 * to be applied transparently to all requests.
 *
 * Usage:
 *   import { MiddlewareTransport } from "@hilbras/sdk";
 *   import { composeMiddlewares, authMiddleware, loggingMiddleware } from "@hilbras/sdk";
 *
 *   const mw = composeMiddlewares(authMiddleware(getToken), loggingMiddleware());
 *   const transport = new MiddlewareTransport(new FetchTransport(), mw);
 *   const client = new HilbrasClient({ transport });
 */

import type { Transport, TransportRequestInit } from "./transport.js";
import type { Middleware } from "../middleware/middleware.js";
import { ProviderRequestError } from "../errors/index.js";

export class MiddlewareTransport implements Transport {
  private _inner: Transport;
  private _middleware: Middleware;

  constructor(inner: Transport, middleware: Middleware) {
    this._inner = inner;
    this._middleware = middleware;
  }

  async request(url: string, init: TransportRequestInit): Promise<Response> {
    return this._middleware({
      url,
      init,
      next: () => this._inner.request(url, init),
    });
  }

  async stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>> {
    // Middleware wraps request() which returns a Response; extract the body
    const res = await this._middleware({
      url,
      init,
      next: () => this._inner.request(url, init),
    });
    // A non-2xx response must not be handed back as a stream. Middleware such
    // as RBAC returns 403/429 with a JSON body; returning it here would look to
    // an adapter like an empty SSE stream, turning a denial into a silent empty
    // completion.
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderRequestError(res.status, body || res.statusText, "middleware");
    }
    if (!res.body) {
      throw new Error(`Response body is null for ${url}`);
    }
    return res.body;
  }

  abort(): void {
    if (typeof this._inner.abort === "function") {
      this._inner.abort();
    }
  }

  destroy(): void {
    if (typeof this._inner.destroy === "function") {
      this._inner.destroy();
    }
  }
}