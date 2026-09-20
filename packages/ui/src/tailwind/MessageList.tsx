"use client";

import { useChatBox } from "../ChatBox.js";
import type { MessageListProps } from "../MessageList.js";

export function TailwindMessageList({ renderMessage, showTimestamp, showTokens, className }: MessageListProps) {
  const { messages, isStreaming } = useChatBox();

  return (
    <div className={`flex flex-col gap-3 overflow-y-auto ${className ?? ""}`} role="log" aria-label="Chat messages" aria-live="polite">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`rounded-lg px-4 py-3 ${
            msg.role === "user"
              ? "bg-blue-600 text-white self-end max-w-[80%]"
              : "bg-gray-100 text-gray-900 self-start max-w-[80%]"
          }`}
          role="article"
        >
          {renderMessage ? (
            renderMessage(msg)
          ) : (
            <>
              <div className="text-xs font-semibold opacity-70 mb-1">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {showTimestamp && (
                <div className="text-xs opacity-50 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              )}
              {showTokens && msg.tokens && (
                <div className="text-xs opacity-50 mt-1">{msg.tokens.total} tokens</div>
              )}
            </>
          )}
        </div>
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="bg-gray-100 rounded-lg px-4 py-3 self-start" role="status">
          <span className="animate-pulse">Thinking...</span>
        </div>
      )}
    </div>
  );
}
