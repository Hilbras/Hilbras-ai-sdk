/**
 * @hilbras/qwik — useChat
 *
 * Qwik-compatible chat hook.
 */

import { useSignal } from "./signal-shim.js";

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
  setMessages: (msgs: Message[]) => void;
  append: (message: Message) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const { api = "/api/chat", onFinish, onError, initialMessages = [] } = options;

  const messages = useSignal<Message[]>(initialMessages);
  const isLoading = useSignal(false);
  const error = useSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function sendRequest(msgs: Message[]) {
    isLoading.value = true;
    error.value = null;
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

      messages.value = [...messages.value, assistantMsg];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        const updated = [...messages.value];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: text };
        messages.value = updated;
      }

      onFinish?.({ ...assistantMsg, content: text });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const e = err as Error;
        error.value = e;
        onError?.(e);
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function append(message: Message) {
    const newMessages = [...messages.value, message];
    messages.value = newMessages;
    await sendRequest(newMessages);
  }

  async function reload() {
    const msgs = messages.value;
    if (msgs.length === 0) return;
    const userMsgs = msgs.slice(0, -1);
    messages.value = userMsgs;
    await sendRequest(userMsgs);
  }

  function stop() {
    abortController?.abort();
    isLoading.value = false;
  }

  function clear() {
    messages.value = [];
    error.value = null;
  }

  function setMessages(msgs: Message[]) {
    messages.value = msgs;
  }

  return {
    messages: () => messages.value,
    isLoading: () => isLoading.value,
    error: () => error.value,
    setMessages,
    append,
    reload,
    stop,
    clear,
  };
}
