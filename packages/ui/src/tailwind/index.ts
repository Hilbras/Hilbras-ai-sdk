/**
 * @hilbras/ui/tailwind — Tailwind CSS styled components
 *
 * Pre-styled versions of all headless components using Tailwind CSS classes.
 * Import from "@hilbras/ui/tailwind" instead of "@hilbras/ui".
 */

export { ChatBox, useChatBox } from "../ChatBox.js";
export type { ChatBoxProps } from "../ChatBox.js";

export { TailwindMessageList as MessageList } from "./MessageList.js";
export { TailwindInput as Input } from "./Input.js";
export { TailwindCostBadge as CostBadge } from "./CostBadge.js";
export { TailwindModelSelector as ModelSelector } from "./ModelSelector.js";
export { TailwindErrorBanner as ErrorBanner } from "./ErrorBanner.js";
export { TailwindThinkingIndicator as ThinkingIndicator } from "./ThinkingIndicator.js";
export { TailwindToolCallCard as ToolCallCard } from "./ToolCallCard.js";
