"use client";

import { useChatBox } from "./ChatBox.js";

export interface MessageListProps {
  /** Custom message renderer */
  renderMessage?: (message: { id: string; role: string; content: string; timestamp: number }) => React.ReactNode;
  /** Show timestamp */
  showTimestamp?: boolean;
  /** Show token count per message */
  showTokens?: boolean;
  /** Additional CSS class for the container */
  className?: string;
}

/**
 * Headless MessageList — renders chat messages with streaming cursor.
 *
 * @example
 * ```tsx
 * <MessageList showTimestamp showTokens />
 * ```
 */
export function MessageList({ renderMessage, showTimestamp, showTokens, className }: MessageListProps) {
  const { messages, isStreaming } = useChatBox();

  return (
    <div className={className} role="log" aria-label="Chat messages" aria-live="polite">
      {messages.map((msg) => (
        <div key={msg.id} className={`hilbras-msg hilbras-msg--${msg.role}`} role="article">
          {renderMessage ? (
            renderMessage(msg)
          ) : (
            <>
              <div className="hilbras-msg-role">{msg.role === "user" ? "You" : "Assistant"}</div>
              <div className="hilbras-msg-content">{msg.content}</div>
              {showTimestamp && (
                <div className="hilbras-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              )}
              {showTokens && msg.tokens && (
                <div className="hilbras-msg-tokens">
                  {msg.tokens.total} tokens
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="hilbras-msg hilbras-msg--thinking" role="status">
          <span className="hilbras-cursor" />
        </div>
      )}
    </div>
  );
}
