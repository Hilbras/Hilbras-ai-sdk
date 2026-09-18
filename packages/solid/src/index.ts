/**
 * @hilbras/solid — SolidJS Integration
 *
 * Signal-based hooks for SolidJS:
 * - useChat: Streaming chat with message management
 * - useCompletion: Text completion streaming
 * - useObject: Streaming structured objects
 */

export { useChat, type UseChatOptions, type UseChatReturn, type Message } from "./use-chat.js";
export { useCompletion, type UseCompletionOptions, type UseCompletionReturn } from "./use-completion.js";
export { useObject, type UseObjectOptions, type UseObjectReturn } from "./use-object.js";
export { createSignal, type Signal } from "./solid-shim.js";
