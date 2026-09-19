/**
 * @hilbras/react — useChat Hook
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Handles message state, streaming, input, error recovery,
 * optimistic updates, reload, and step-level callbacks.
 */

import { useState, useCallback, useRef } from "react";
import type {
  UIMessage,
  UseChatOptions,
  UseChatState,
  UseChatActions,
} from "../../index.js";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

export interface UseChatReturn extends UseChatState, UseChatActions {
  /** Reload the last assistant message */
  reload: () => Promise<void>;
  /** Append a message and get a response */
  append: (message: UIMessage | { role: "user"; content: string }) => Promise<void>;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const {
    api,
    initialMessages = [],
    provider,
    model,
    onFinish,
    onError,
    headers = {},
    body = {},
  } = options;

  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const sendRequest = useCallback(async (
    messageHistory: UIMessage[],
    assistantMessage: UIMessage,
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: messageHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          provider,
          model,
          stream: true,
          ...body,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("Response body is null");
      }

      let content = "";
      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "text_delta":
            content += msg.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id ? { ...m, content } : m
              )
            );
            break;
          case "message_end":
            if (msg.usage) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, usage: msg.usage }
                    : m
                )
              );
            }
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      const finalMessage = { ...assistantMessage, content };
      onFinish?.(finalMessage);
      return finalMessage;
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [api, provider, model, headers, body, onFinish, onError]);

  const handleSubmit = useCallback(async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: UIMessage = {
      id: generateId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider,
      model,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    await sendRequest([...messages, userMessage], assistantMessage);
  }, [input, isLoading, messages, provider, model, sendRequest]);

  const append = useCallback(async (message: UIMessage | { role: "user"; content: string }) => {
    const userMessage: UIMessage = {
      id: generateId(),
      role: "user",
      content: message.content,
      createdAt: Date.now(),
    };

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider,
      model,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsLoading(true);
    setError(null);

    await sendRequest([...messages, userMessage], assistantMessage);
  }, [messages, provider, model, sendRequest]);

  const reload = useCallback(async () => {
    if (isLoading || messages.length === 0) return;

    // Find the last user message
    const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;

    // Remove everything after the last user message
    const messagesUpToLastUser = messages.slice(0, lastUserIdx + 1);
    const lastUserMessage = messages[lastUserIdx];

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider,
      model,
    };

    setMessages([...messagesUpToLastUser, assistantMessage]);
    setIsLoading(true);
    setError(null);

    await sendRequest(messagesUpToLastUser, assistantMessage);
  }, [isLoading, messages, provider, model, sendRequest]);

  const clear = useCallback(() => {
    setMessages([]);
    setInput("");
    setError(null);
  }, []);

  return {
    messages,
    input,
    isLoading,
    error,
    setInput,
    handleSubmit,
    append,
    reload,
    setMessages,
    stop,
    clear,
  };
}
