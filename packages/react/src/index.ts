/**
 * @hilbras/react — React hooks and components for @hilbras/sdk
 *
 * Zero-dependency React integration for the Hilbras AI SDK.
 * Provides streaming chat, text completion, and cost tracking hooks.
 */

export { HilbrasProvider, useHilbrasClient } from "./provider.js";
export type { HilbrasProviderProps } from "./provider.js";

export { useChat } from "./useChat.js";
export type { ChatMessage, UseChatOptions, UseChatReturn } from "./useChat.js";

export { useCompletion } from "./useCompletion.js";
export type { UseCompletionOptions, UseCompletionReturn } from "./useCompletion.js";

export { useCost } from "./useCost.js";
export type { CostSnapshot, UseCostOptions, UseCostReturn } from "./useCost.js";
