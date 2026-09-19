/**
 * @hilbras/nextjs — Next.js Integration
 *
 * Server-side:
 * - createServerClient: Create a HilbrasClient for Server Components
 * - ServerHilbrasClient: Server client with streaming helpers
 *
 * Route Handlers:
 * - createChatHandler: Streaming chat endpoint
 * - createCompletionHandler: Non-streaming completion endpoint
 *
 * Client-side:
 * - useChat: Streaming chat hook
 * - useCompletion: Text completion hook
 */

export { createServerClient, ServerHilbrasClient, type ServerClientOptions } from "./server.js";
export { createChatHandler, createCompletionHandler, type ChatRequest, type ChatResponse } from "./route-handlers.js";
export { useChat, type UseChatOptions, type UseChatReturn } from "./use-chat.js";
export { useCompletion, type UseCompletionOptions, type UseCompletionReturn } from "./use-completion.js";
export type { Message } from "./client.js";
