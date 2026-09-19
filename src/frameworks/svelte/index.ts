/**
 * @hilbras/svelte — Svelte 5 Runes-Based Hooks
 *
 * Reactive hooks for building streaming LLM UIs with @hilbras/sdk.
 * Works with Svelte 5 runes ($state, $derived, $effect) via getter/setter pattern.
 */

export { useChat } from "./use-chat.js";
export type { ChatState } from "./use-chat.js";

export { useCompletion } from "./use-completion.js";
export type { CompletionState } from "./use-completion.js";

export { useObject } from "./use-object.js";
export type { UseObjectOptions, ObjectState } from "./use-object.js";

export { parseUIStream } from "./stream-parser.js";

// Re-export types from the main SDK
export type {
  UIMessage,
  UIToolInvocation,
  UIProtocolMessage,
  UseChatOptions,
  UseCompletionOptions,
} from "../../index.js";
