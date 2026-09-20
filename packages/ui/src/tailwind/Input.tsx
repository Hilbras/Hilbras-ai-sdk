"use client";

import { useRef, useEffect, useCallback } from "react";
import { useChatBox } from "../ChatBox.js";
import type { InputProps } from "../Input.js";

export function TailwindInput({
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

  useEffect(() => { adjustHeight(); }, [input, adjustHeight]);

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
      className={`flex gap-2 items-end ${className ?? ""}`}
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); handleSubmit(); }}
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
        className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        aria-label="Message input"
      />
      {showSendButton && (
        <button
          type="submit"
          disabled={disabled || isLoading || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={sendLabel}
        >
          {sendLabel}
        </button>
      )}
    </form>
  );
}
