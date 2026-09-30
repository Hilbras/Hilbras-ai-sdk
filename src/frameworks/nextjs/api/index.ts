/**
 * @hilbras/sdk — Next.js API route helpers
 *
 * Subpath: `@hilbras/sdk/nextjs/api`
 *
 * These helpers import `next/server`, so they live under their own subpath
 * rather than in `@hilbras/sdk/nextjs`. The `./nextjs` entry must keep working
 * in a project with no `next` installed, and re-exporting these from there
 * would make `next/server` a hard resolution requirement for every consumer.
 *
 * `createChatHandler` and friends — which take a plain `Request` and return a
 * plain `Response` and need no Next types at all — remain in `@hilbras/sdk/nextjs`.
 */

export { createStreamHandler, createStreamCompletionHandler } from "./stream.js";
export type { ChatMessage, StreamChatOptions, StreamCompletionOptions } from "./stream.js";
