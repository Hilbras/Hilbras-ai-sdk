/**
 * @hilbras/sdk — Next.js edge middleware
 *
 * Subpath: `@hilbras/sdk/nextjs/edge`
 *
 * `hilbrasMiddleware` implements the rate-limit bucket keying. It is typed
 * structurally against the Next request surface rather than importing
 * `next/server`, and it has its own subpath so that `@hilbras/sdk/nextjs` stays
 * importable in a project with no Next dependency.
 */

export { hilbrasMiddleware, forwardedClientIp } from "./middleware.js";
export type { HilbrasMiddlewareOptions, RateLimitStore } from "./middleware.js";
