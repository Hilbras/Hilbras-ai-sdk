/**
 * @hilbras/svelte — useChat
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Svelte 5 runes-compatible: returns a state object with reactive getters.
 *
 * Usage in Svelte 5:
 *   const chat = useChat({ api: '/api/chat' });
 *   $: messages = chat.messages;
 */

import type { UIMessage, UseChatOptions } from "@hilbras/sdk";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

export interface ChatState {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  error: Error | null;
}

export function useChat(options: UseChatOptions) {
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

  const state: ChatState = {
    messages: [...initialMessages],
    input: "",
    isLoading: false,
    error: null,
  };

  let abortController: AbortController | null = null;
  const listeners: Array<() => void> = [];

  function notify() {
    for (const fn of listeners) fn();
  }

  function subscribe(fn: () => void) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function stop() {
    abortController?.abort();
    abortController = null;
    state.isLoading = false;
    notify();
  }

  async function handleSubmit(e?: { preventDefault: () => void }) {
    e?.preventDefault();

    const trimmed = state.input.trim();
    if (!trimmed || state.isLoading) return;

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

    state.messages = [...state.messages, userMessage, assistantMessage];
    state.input = "";
    state.isLoading = true;
    state.error = null;
    notify();

    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: state.messages.map((m) => ({
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

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("Response body is null");

      let content = "";
      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "text_delta":
            content += msg.text;
            state.messages = state.messages.map((m) =>
              m.id === assistantMessage.id ? { ...m, content } : m
            );
            notify();
            break;
          case "message_end":
            if (msg.usage) {
              state.messages = state.messages.map((m) =>
                m.id === assistantMessage.id ? { ...m, usage: msg.usage } : m
              );
              notify();
            }
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.({ ...assistantMessage, content });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const errObj = err instanceof Error ? err : new Error(String(err));
      state.error = errObj;
      onError?.(errObj);
    } finally {
      abortController = null;
      state.isLoading = false;
      notify();
    }
  }

  function setMessages(newMessages: UIMessage[]) {
    state.messages = [...newMessages];
    notify();
  }

  function clear() {
    state.messages = [];
    state.input = "";
    state.error = null;
    notify();
  }

  return {
    get messages() { return state.messages; },
    get input() { return state.input; },
    set input(v: string) { state.input = v; notify(); },
    get isLoading() { return state.isLoading; },
    get error() { return state.error; },
    handleSubmit,
    setMessages,
    stop,
    clear,
    subscribe,
  };
}
