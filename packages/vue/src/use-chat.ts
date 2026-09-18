/**
 * @hilbras/vue — useChat Composition Function
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Returns Vue reactive refs for state and functions for actions.
 */

import { ref, readonly } from "vue";
import type { UIMessage, UseChatOptions } from "@hilbras/sdk";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
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

  const messages = ref<UIMessage[]>([...initialMessages]);
  const input = ref("");
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  let abortController: AbortController | null = null;

  function stop() {
    abortController?.abort();
    abortController = null;
    isLoading.value = false;
  }

  async function handleSubmit(e?: { preventDefault: () => void }) {
    e?.preventDefault();

    const trimmed = input.value.trim();
    if (!trimmed || isLoading.value) return;

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

    messages.value = [...messages.value, userMessage, assistantMessage];
    input.value = "";
    isLoading.value = true;
    error.value = null;

    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: messages.value.map((m) => ({
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
            messages.value = messages.value.map((m) =>
              m.id === assistantMessage.id ? { ...m, content } : m
            );
            break;
          case "message_end":
            if (msg.usage) {
              messages.value = messages.value.map((m) =>
                m.id === assistantMessage.id ? { ...m, usage: msg.usage } : m
              );
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
      error.value = errObj;
      onError?.(errObj);
    } finally {
      abortController = null;
      isLoading.value = false;
    }
  }

  function setMessages(newMessages: UIMessage[]) {
    messages.value = [...newMessages];
  }

  function clear() {
    messages.value = [];
    input.value = "";
    error.value = null;
  }

  return {
    messages: readonly(messages),
    input,
    isLoading: readonly(isLoading),
    error: readonly(error),
    handleSubmit,
    setMessages,
    stop,
    clear,
  };
}
