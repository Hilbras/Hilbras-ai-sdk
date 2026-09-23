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
}

const DEFAULT_EXCLUDE = ["/_next", "/favicon.ico", "/api/health"];

/**
 * Next.js middleware for rate limiting AI API routes.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { hilbrasMiddleware } from "@hilbras/next";
 *
 * export const config = { matcher: ["/api/:path*"] };
 * export default hilbrasMiddleware({ maxRequests: 30 });
 * ```
 */
export function hilbrasMiddleware(options: HilbrasMiddlewareOptions = {}) {
  const { maxRequests = 60, windowSeconds = 60, excludePaths = DEFAULT_EXCLUDE, onError } = options;

  const hits = new Map<string, { count: number; resetAt: number }>();

  function getClientIp(request: NextRequest): string {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown"
    );
  }

  function cleanup() {
    const now = Date.now();
    for (const [key, value] of hits) {
      if (now > value.resetAt) hits.delete(key);
    }
  }

  return function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    if (excludePaths.some((p) => path.startsWith(p))) {
      return NextResponse.next();
    }

    cleanup();

    const ip = getClientIp(request);
    const key = `${ip}:${path}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return NextResponse.next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      if (onError) return onError("Rate limit exceeded");
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    return NextResponse.next();
  };
}
