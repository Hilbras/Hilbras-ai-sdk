/**
 * @hilbras/qwik — Qwik Integration
 *
 * Signal-based hooks for Qwik:
 * - useChat: Streaming chat with message management
 * - useCompletion: Text completion streaming
 */

export { useChat, type UseChatOptions, type UseChatReturn } from "./use-chat.js";
export { useCompletion, type UseCompletionOptions, type UseCompletionReturn } from "./use-completion.js";
export { useSignal, type QwikSignal } from "./signal-shim.js";
