/**
 * @hilbras/next — Next.js integration for @hilbras/sdk
 *
 * Streaming API routes, edge runtime support, and rate limiting middleware.
 */

export { createStreamHandler, createStreamCompletionHandler } from "./stream.js";
export type { StreamChatOptions, StreamCompletionOptions } from "./stream.js";

export { hilbrasMiddleware } from "./middleware.js";
export type { HilbrasMiddlewareOptions } from "./middleware.js";
