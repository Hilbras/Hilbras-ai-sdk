import { type NextRequest, NextResponse } from "next/server";

export interface HilbrasMiddlewareOptions {
  /** Rate limit: max requests per window (default: 60) */
  maxRequests?: number;
  /** Rate limit: window duration in seconds (default: 60) */
  windowSeconds?: number;
  /** Paths to exclude from middleware (default: ["/_next", "/favicon.ico"]) */
  excludePaths?: string[];
  /** Custom error response */
  onError?: (error: string) => Response;
  /**
   * How many trusted reverse proxies sit in front of the app.
   *
   * `x-forwarded-for` is a comma-separated list that each proxy appends to, so
   * the real client address sits `trustProxy` entries from the **right**. Taking
   * the leftmost entry — which is what this middleware did before 2.3.0 — reads
   * the value the *client* supplied, because the common proxies (nginx
   * `proxy_add_x_forwarded_for`, Vercel, Cloudflare) prepend the real address to
   * whatever the client sent. An attacker who rotated the header therefore got a
   * fresh rate-limit bucket per request.
   *
   * Defaults to `0`: trust the rightmost entry, i.e. the address added by the
   * proxy directly in front of you. Correct for a single proxy, and safe for
   * none — see `fallbackKey`.
   *
   * Set this to the number of proxies in your chain. With no proxy at all,
   * leave it at `0` and supply `fallbackKey`.
   */
  trustProxy?: number;
  /**
   * Key derivation for the rate-limit bucket, used when no trustworthy forwarded
   * address is available.
   */
  fallbackKey?: (request: NextRequest) => string;
  /**
   * Counter backend. The default is in-process `Map` state, which is correct
   * for a single instance or a dev server. Behind more than one instance each
   * keeps its own counter, so the effective limit becomes
   * `maxRequests × instances`. Pass a shared store (Redis, KV, or anything with
   * a `hit` method) to make the limit global; that store must expire its own
   * keys.
   */
  store?: RateLimitStore;
}

/** A counter backend. Entries must expire themselves. */
export interface RateLimitStore {
  /** Increment and return the counter for `key` within a `windowMs` window. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  /** Drop expired entries. Optional — a shared store expires its own keys. */
  cleanup?(): void | Promise<void>;
}

interface RateEntry {
  count: number;
  resetAt: number;
}

/** In-process store. Not shared across instances — see `store`. */
function createMemoryStore(): RateLimitStore {
  const hits = new Map<string, RateEntry>();
  return {
    async hit(key: string, windowMs: number) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        const fresh = { count: 1, resetAt: now + windowMs };
        hits.set(key, fresh);
        return fresh;
      }
      entry.count++;
      return entry;
    },
    cleanup() {
      const now = Date.now();
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key);
      }
    },
  };
}

const DEFAULT_EXCLUDE = ["/_next", "/favicon.ico", "/api/health"];

/**
 * Extract the client address from a `x-forwarded-for` list.
 *
 * Each proxy *appends* the address it saw, so the list reads
 * `client-supplied, …, nearest-hop`. With `trustProxy` trusted proxies the real
 * client sits `trustProxy` entries from the right, which is index
 * `entries.length - trustProxy`:
 *
 * - `trustProxy: 0` — index `length`, i.e. out of range. Nothing is trusted, so
 *   there is no entry we can attribute to the client rather than to a proxy.
 * - `trustProxy: 1` — `"9.9.9.1, 1.1.1.1"` gives index 1, the real client, and
 *   `9.9.9.1` (the attacker's) is correctly ignored.
 * - `trustProxy: 2` — `"9.9.9.1, 1.1.1.1, 10.0.0.1"` gives index 1 again.
 *
 * Returns `undefined` when the list is absent or shorter than the trust depth,
 * because in that case every entry present was chosen by the client.
 */
export function forwardedClientIp(
  headerValue: string | null | undefined,
  trustProxy: number,
): string | undefined {
  if (!headerValue) return undefined;
  const entries = headerValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;

  const index = entries.length - trustProxy;
  if (index < 0) return undefined;
  return entries[index];
}

/**
 * Next.js middleware for rate limiting AI API routes.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { hilbrasMiddleware } from "@hilbras/next";
 *
 * export const config = { matcher: ["/api/:path*"] };
 * export default hilbrasMiddleware({ maxRequests: 30, trustProxy: 1 });
 * ```
 */
export function hilbrasMiddleware(options: HilbrasMiddlewareOptions = {}) {
  const {
    maxRequests = 60,
    windowSeconds = 60,
    excludePaths = DEFAULT_EXCLUDE,
    onError,
    trustProxy = 0,
    fallbackKey,
    store = createMemoryStore(),
  } = options;

  function getClientKey(request: NextRequest): string {
    const fromHeader = forwardedClientIp(
      request.headers.get("x-forwarded-for"),
      trustProxy,
    );
    if (fromHeader) return fromHeader;

    // `x-real-ip` is written by the proxy rather than derived from the client's
    // header chain, so it is a better fallback — but only when at least one
    // proxy is trusted.
    if (trustProxy > 0) {
      const realIp = request.headers.get("x-real-ip")?.trim();
      if (realIp) return realIp;
    }

    const explicit = fallbackKey?.(request);
    if (explicit) return explicit;

    // Deliberately not `request.ip`: Next.js derives it from the forwarded
    // headers in exactly the way `trustProxy` exists to correct, so trusting it
    // here would reintroduce the spoof.
    //
    // Collapsing everything unidentifiable into one bucket is the safe
    // direction: it can under-serve anonymous callers, but it cannot hand an
    // attacker a fresh budget by omitting a header.
    return "unidentified";
  }

  return async function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    if (excludePaths.some((p) => path.startsWith(p))) {
      return NextResponse.next();
    }

    await store.cleanup?.();

    const key = `${getClientKey(request)}:${path}`;
    const { count, resetAt } = await store.hit(key, windowSeconds * 1000);

    if (count > maxRequests) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      if (onError) return onError("Rate limit exceeded");
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    return NextResponse.next();
  };
}
