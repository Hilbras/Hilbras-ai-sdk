/**
 * @hilbras/react — React Hooks
 *
 * React hooks for building streaming LLM UIs with @hilbras/sdk.
 */

export { useChat } from "./use-chat.js";
export type { UseChatReturn } from "./use-chat.js";

export { useCompletion } from "./use-completion.js";
export type { UseCompletionReturn } from "./use-completion.js";

export { useObject } from "./use-object.js";
export type { UseObjectReturn, UseObjectOptions, UseObjectState, UseObjectActions } from "./use-object.js";

export { parseUIStream } from "./stream-parser.js";

// Re-export types from the main SDK
export type {
  UIMessage,
  UIToolInvocation,
  UIProtocolMessage,
  UseChatOptions,
  UseChatState,
  UseChatActions,
  UseCompletionOptions,
  UseCompletionState,
  UseCompletionActions,
} from "../../index.js";
