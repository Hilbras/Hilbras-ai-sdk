"use client";

import { useChatBox } from "./ChatBox.js";

export interface ThinkingIndicatorProps {
  /** Custom text */
  text?: string;
  /** Custom render function */
  render?: (isStreaming: boolean) => React.ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Headless ThinkingIndicator — loading/thinking animation.
 */
export function ThinkingIndicator({ text = "Thinking...", render, className }: ThinkingIndicatorProps) {
  const { isStreaming, isLoading } = useChatBox();

  if (!isLoading && !isStreaming) return null;

  if (render) {
    return <div className={className}>{render(isStreaming)}</div>;
  }

  return (
    <div className={className} role="status" aria-label="Loading">
      <span className="hilbras-thinking-dots">
        <span>.</span><span>.</span><span>.</span>
      </span>
      <span>{text}</span>
    </div>
  );
}
