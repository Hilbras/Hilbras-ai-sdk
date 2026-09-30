/**
 * @hilbras/sdk — React client-mode hooks
 *
 * Subpath: `@hilbras/sdk/react-client`
 *
 * These hooks hold a `HilbrasClient` and call `client.stream()` directly, so
 * inference runs **in the browser**. They live under their own subpath rather
 * than joining `@hilbras/sdk/react` for two reasons:
 *
 * 1. Name collision. `useChat` and `useCompletion` are exported by both, with
 *    different signatures and different transports. Merging them into one
 *    entry would make the import ambiguous.
 * 2. Different design. `@hilbras/sdk/react`'s `useChat` takes an `api` route and
 *    calls `fetch(api)` — credentials stay on your server. These take a
 *    `provider` and `model` and reach the provider from the browser.
 *
 * ## Prefer the route-based hooks
 *
 * A client built from `config` with an API key will bundle that key into your
 * client-side JavaScript, where anyone can read it. For a public app, use
 * `@hilbras/sdk/react` and point `api` at a route handler from
 * `@hilbras/sdk/nextjs/api` — the key never leaves the server.
 *
 * These hooks remain the supported path for a **trusted, authenticated
 * environment** — an internal tool behind SSO, an Electron app, or a server
 * component tree where the "client" is not really a browser.
 */

export { HilbrasProvider, useHilbrasClient } from "./provider.js";
export type { HilbrasProviderProps } from "./provider.js";

export { useChat } from "./use-chat.js";
export type { ChatMessage, UseChatOptions, UseChatReturn } from "./use-chat.js";

export { useCompletion } from "./use-completion.js";
export type { UseCompletionOptions, UseCompletionReturn } from "./use-completion.js";

export { useCost } from "./use-cost.js";
export type { CostSnapshot, UseCostOptions, UseCostReturn } from "./use-cost.js";
