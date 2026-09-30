/**
 * @hilbras/remix — Remix Integration
 *
 * Actions and hooks for Remix.
 */

export { createChatAction, createCompletionAction, type ActionOptions, type ChatMessage } from "./actions.js";
export type {
  FrameworkErrorContext,
  FrameworkHandlerLimits,
  FrameworkRequestContext,
} from "../shared/handler-core.js";
export { createChatHook, type UseChatOptions, type UseChatReturn, type Message } from "./hooks.js";
