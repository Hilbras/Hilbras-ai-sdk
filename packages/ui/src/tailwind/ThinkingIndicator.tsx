"use client";

import { useChatBox } from "../ChatBox.js";
import type { ThinkingIndicatorProps } from "../ThinkingIndicator.js";

export function TailwindThinkingIndicator({ text = "Thinking...", render, className }: ThinkingIndicatorProps) {
  const { isStreaming, isLoading } = useChatBox();

  if (!isLoading && !isStreaming) return null;

  if (render) {
    return <div className={`${className ?? ""}`}>{render(isStreaming)}</div>;
  }

  return (
    <div className={`flex items-center gap-2 text-sm text-gray-500 ${className ?? ""}`} role="status" aria-label="Loading">
      <span className="flex gap-0.5">
        <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
      </span>
      <span>{text}</span>
    </div>
  );
}
