"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useHilbrasClient } from "./provider.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number; total: number };
  cost?: number;
}

export interface UseChatOptions {
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** Initial messages */
  initialMessages?: ChatMessage[];
  /** Max messages to keep in context (older messages trimmed) */
  maxContextMessages?: number;
  /** Called on each text chunk during streaming */
  onChunk?: (chunk: { text: string; accumulated: string }) => void;
  /** Called when a message completes */
  onComplete?: (message: ChatMessage) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Extra headers for the request */
  headers?: Record<string, string>;
}

export interface UseChatReturn {
  /** Chat messages */
  messages: ChatMessage[];
  /** Current input value */
  input: string;
  /** Set input value */
  setInput: (value: string) => void;
  /** Send a message (uses current input) */
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  /** Send an arbitrary message */
  sendMessage: (content: string) => Promise<void>;
  /** Whether a response is being generated */
  isLoading: boolean;
  /** Whether streaming is in progress */
  isStreaming: boolean;
  /** Current error (if any) */
  error: Error | null;
  /** Abort the current request */
  stop: () => void;
  /** Clear all messages */
  clear: () => void;
  /** Retry the last message */
  retry: () => Promise<void>;
  /** Total tokens used */
  totalTokens: number;
  /** Total cost */
  totalCost: number;
}

let _idCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++_idCounter}`;
}

/**
 * useChat — streaming chat hook for React.
 *
 * @example
 * ```tsx
 * function Chat() {
 *   const { messages, input, setInput, handleSubmit, isLoading } = useChat({
 *     provider: "openai",
 *     model: "gpt-4o",
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map(m => <div key={m.id}>{m.content}</div>)}
 *       <input value={input} onChange={e => setInput(e.target.value)} />
 *       <button onClick={handleSubmit} disabled={isLoading}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useChat(options: UseChatOptions): UseChatReturn {
  const { provider, model, systemPrompt, initialMessages, maxContextMessages = 50, onChunk, onComplete, onError, headers } = options;

  const client = useHilbrasClient();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string>("");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
    setError(null);
    setTotalTokens(0);
    setTotalCost(0);
  }, [stop]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    lastUserMessageRef.current = content.trim();

    setMessages((prev) => {
      const updated = [...prev, userMessage];
      // Trim context window
      if (updated.length > maxContextMessages + 1) {
        return updated.slice(-maxContextMessages);
      }
      return updated;
    });
    setInput("");
    setIsLoading(true);
    setIsStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Build message array for the API
      const apiMessages = [];
      if (systemPrompt) {
        apiMessages.push({ role: "system" as const, content: systemPrompt });
      }

      // Add context messages (all except the latest user message)
      const contextMessages = messages.slice(-maxContextMessages);
      for (const msg of contextMessages) {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
      apiMessages.push({ role: "user" as const, content: userMessage.content });

      let assistantContent = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of client.stream(
        { messages: apiMessages, model, provider, headers },
        { signal: controller.signal }
      )) {
        if (chunk.type === "text") {
          assistantContent += chunk.text;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: assistantContent };
            } else {
              updated.push({
                id: nextId(),
                role: "assistant",
                content: assistantContent,
                timestamp: Date.now(),
                provider,
                model,
              });
            }
            return updated;
          });
          onChunk?.({ text: chunk.text, accumulated: assistantContent });
        }

        if (chunk.type === "usage") {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
        }
      }

      // Finalize message with token counts
      const finalMessage: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        provider,
        model,
        tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      };

      setMessages((prev) => {
        const updated = [...prev];
        // Replace the streaming message with the final one
        const lastIdx = updated.findIndex((m) => m.role === "assistant" && m.content === assistantContent);
        if (lastIdx >= 0) {
          updated[lastIdx] = finalMessage;
        } else {
          updated.push(finalMessage);
        }
        return updated;
      });

      setTotalTokens((prev) => prev + inputTokens + outputTokens);
      onComplete?.(finalMessage);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [client, messages, provider, model, systemPrompt, maxContextMessages, headers, isLoading, onChunk, onComplete, onError]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    await sendMessage(input);
  }, [input, sendMessage]);

  const retry = useCallback(async () => {
    if (!lastUserMessageRef.current || isLoading) return;
    // Remove last assistant message
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === "assistant") {
        return prev.slice(0, -1);
      }
      return prev;
    });
    await sendMessage(lastUserMessageRef.current);
  }, [isLoading, sendMessage]);

  return {
    messages,
    input,
    setInput,
    handleSubmit,
    sendMessage,
    isLoading,
    isStreaming,
    error,
    stop,
    clear,
    retry,
    totalTokens,
    totalCost,
  };
}
