/**
 * @hilbras/solid — useChat
 *
 * Signal-based chat hook for SolidJS.
 */

import { createSignal } from "./solid-shim.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
}

export interface UseChatOptions {
  api?: string;
  onFinish?: (message: Message) => void;
  onError?: (error: Error) => void;
  initialMessages?: Message[];
}

export interface UseChatReturn {
  messages: () => Message[];
  isLoading: () => boolean;
  error: () => Error | null;
  setMessages: (value: Message[] | ((prev: Message[]) => Message[])) => void;
  append: (message: Message) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const { api = "/api/chat", onFinish, onError, initialMessages = [] } = options;

  const [messages, setMessages] = createSignal<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function sendMessage(msgs: Message[]) {
    setIsLoading(true);
    setError(null);
    abortController = new AbortController();

    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let text = "";
      const assistantMsg: Message = { role: "assistant", content: "", id: crypto.randomUUID() };

      setMessages((prev) => [...prev, assistantMsg]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: text };
          return updated;
        });
      }

      onFinish?.({ ...assistantMsg, content: text });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const e = err as Error;
        setError(e);
        onError?.(e);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function append(message: Message) {
    const newMessages = [...messages(), message];
    setMessages(newMessages);
    await sendMessage(newMessages);
  }

  async function reload() {
    const msgs = messages();
    if (msgs.length === 0) return;
    // Remove last assistant message and re-send
    const userMsgs = msgs.slice(0, -1);
    setMessages(userMsgs);
    await sendMessage(userMsgs);
  }

  function stop() {
    abortController?.abort();
    setIsLoading(false);
  }

  function clear() {
    setMessages([]);
    setError(null);
  }

  return {
    messages,
    isLoading,
    error,
    setMessages,
    append,
    reload,
    stop,
    clear,
  };
}
