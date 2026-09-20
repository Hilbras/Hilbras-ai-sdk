"use client";

import { useRef, useEffect, useCallback } from "react";
import { useChatBox } from "./ChatBox.js";

export interface InputProps {
  /** Placeholder text */
  placeholder?: string;
  /** Disable input */
  disabled?: boolean;
  /** Max rows before scroll (default: 8) */
  maxRows?: number;
  /** Show send button (default: true) */
  showSendButton?: boolean;
  /** Send button label */
  sendLabel?: string;
  /** Additional CSS class */
  className?: string;
  /** Called on submit (for custom submit logic) */
  onSubmit?: () => void;
}

/**
 * Headless Input — auto-resizing textarea with send button.
 *
 * @example
 * ```tsx
 * <Input placeholder="Ask anything..." maxRows={6} />
 * ```
 */
export function Input({
  placeholder = "Type a message...",
  disabled = false,
  maxRows = 8,
  showSendButton = true,
  sendLabel = "Send",
  className,
  onSubmit,
}: InputProps) {
  const { input, setInput, handleSubmit, isLoading } = useChatBox();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 24;
    el.style.height = `${Math.min(el.scrollHeight, maxRows * lineHeight)}px`;
  }, [maxRows]);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit?.();
        handleSubmit();
      }
    },
    [handleSubmit, onSubmit]
  );

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
        handleSubmit();
      }}
      role="form"
      aria-label="Chat input"
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isLoading}
        rows={1}
        aria-label="Message input"
      />
      {showSendButton && (
        <button type="submit" disabled={disabled || isLoading || !input.trim()} aria-label={sendLabel}>
          {sendLabel}
        </button>
      )}
    </form>
  );
}
