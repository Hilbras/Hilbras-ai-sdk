/**
 * @hilbras/sdk — Next.js runtime surface
 *
 * Minimal structural types for the pieces of `next/server` these helpers use.
 *
 * The SDK cannot import from `next/server`: `next` is an optional peer
 * dependency, and the published package must typecheck and build in a project
 * that has never installed Next. Declaring the surface here keeps the build
 * self-contained.
 *
 * Every member below is structurally satisfied by the real Next types, so a
 * Next `NextRequest`/`NextResponse` is assignable to these without a cast, and
 * a real Next route accepts a handler typed against them. That is the whole
 * point of declaring the *shape* rather than the nominal class.
 */

/** The subset of `NextRequest` the helpers read. */
export interface HilbrasNextRequest {
  /** Parse the body as JSON. Present on the Web `Request`. */
  json(): Promise<unknown>;
  /** Abort signal for a client disconnect. */
  readonly signal: AbortSignal;
  /** Incoming headers. */
  readonly headers: Headers;
  /** Path of the matched route, e.g. `/api/chat`. */
  readonly nextUrl: { readonly pathname: string };
  /**
   * Next-resolved client IP.
   *
   * Deliberately never read by the middleware: Next derives this from the
   * forwarded headers, which is the value `trustProxy` exists to correct.
   */
  readonly ip?: string;
}

/** The subset of `NextResponse` the helpers produce. */
export interface HilbrasNextResponse {
  json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): HilbrasNextResponse;
  next(init?: unknown): HilbrasNextResponse;
}

/**
 * A Next middleware request, typed structurally.
 *
 * A real `NextRequest` satisfies this: it extends the Web `Request`, so it has
 * `json`, `signal` and `headers`, and Next adds `nextUrl` and `ip`.
 */
export type NextRequestLike = HilbrasNextRequest;

/**
 * Build the minimal `NextResponse` surface at runtime.
 *
 * `NextResponse.json` and `NextResponse.next` return objects that the Next
 * runtime converts into a real response. Outside Next — in a unit test, or in
 * an app using the Web `Response` — the standard constructors do the same job,
 * so they are used as the fallback and keep the SDK free of a hard Next
 * dependency at runtime too.
 */
export function createNextResponseShim(): {
  json: HilbrasNextResponse["json"];
  next: HilbrasNextResponse["next"];
} {
  return {
    json(body, init) {
      // A plain `Response` already exposes `.status` and `.headers`, which is
      // everything these helpers and their tests read. `Object.assign` cannot
      // be used to graft on a `status` property: `Response.status` is a
      // getter-only accessor on the prototype, so assignment throws.
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      }) as unknown as HilbrasNextResponse;
    },
    next() {
      return new Response(null, { status: 200 }) as unknown as HilbrasNextResponse;
    },
  };
}
