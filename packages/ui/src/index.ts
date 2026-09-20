/**
 * @hilbras/ui — Headless UI components for AI chat
 *
 * Framework-agnostic components that work with React, Vue, Svelte, or vanilla JS.
 * Import from "@hilbras/ui" for headless components, "@hilbras/ui/tailwind" for styled.
 */

export { ChatBox, useChatBox } from "./ChatBox.js";
export type { ChatBoxProps } from "./ChatBox.js";

export { MessageList } from "./MessageList.js";
export type { MessageListProps } from "./MessageList.js";

export { Input } from "./Input.js";
export type { InputProps } from "./Input.js";

export { CostBadge } from "./CostBadge.js";
export type { CostBadgeProps } from "./CostBadge.js";

export { ModelSelector } from "./ModelSelector.js";
export type { ModelSelectorProps } from "./ModelSelector.js";

export { ErrorBanner } from "./ErrorBanner.js";
export type { ErrorBannerProps } from "./ErrorBanner.js";

export { ThinkingIndicator } from "./ThinkingIndicator.js";
export type { ThinkingIndicatorProps } from "./ThinkingIndicator.js";

export { ToolCallCard } from "./ToolCallCard.js";
export type { ToolCallCardProps, ToolCall } from "./ToolCallCard.js";
