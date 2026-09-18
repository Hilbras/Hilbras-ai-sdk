/**
 * @hilbras/vue — Vue 3 Composition API Hooks
 *
 * Composition functions for building streaming LLM UIs with @hilbras/sdk.
 */

export { useChat } from "./use-chat.js";
export { useCompletion } from "./use-completion.js";
export { useObject } from "./use-object.js";
export type { UseObjectOptions } from "./use-object.js";
export { parseUIStream } from "./stream-parser.js";

// Re-export types from the main SDK
export type {
  UIMessage,
  UIToolInvocation,
  UIProtocolMessage,
  UseChatOptions,
  UseCompletionOptions,
} from "@hilbras/sdk";
