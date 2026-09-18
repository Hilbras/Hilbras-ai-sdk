/**
 * @hilbras/astro — Astro Integration
 *
 * API endpoints and client-side hooks for Astro.
 */

export { createChatEndpoint, createCompletionEndpoint, type EndpointOptions, type ChatMessage } from "./endpoints.js";
export { createChatState, type UseChatOptions, type UseChatReturn, type Message } from "./hooks.js";
