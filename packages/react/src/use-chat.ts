/**
 * @hilbras/react — useChat Hook
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Handles message state, streaming, input, and error recovery.
 */

import { useState, useCallback, useRef } from "react";
import type {
  UIMessage,
  UseChatOptions,
  UseChatState,
  UseChatActions,
} from "@hilbras/sdk";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

export interface UseChatReturn extends UseChatState, UseChatActions {}

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

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
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
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [input, isLoading, messages, api, provider, model, headers, body, onFinish, onError]);

  const append = useCallback(async (message: UIMessage) => {
    setMessages((prev) => [...prev, message]);
    // Re-trigger handleSubmit with the new message context
    setInput(message.content);
  }, []);

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
    setMessages,
    stop,
    clear,
  };
}
