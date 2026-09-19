/**
 * @hilbras/vue — useChat Composition Function
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Returns Vue reactive refs for state and functions for actions.
 */

import { ref, readonly } from "vue";
import type { UIMessage, UIToolInvocation, UseChatOptions } from "../../index.js";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

/** Extended options with tool calling support */
export interface UseChatToolOptions extends UseChatOptions {
  maxSteps?: number;
  onToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => Promise<unknown> | unknown;
  onStepFinish?: (step: { step: number; text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }> }) => void;
}

export function useChat(options: UseChatToolOptions) {
  const {
    api,
    initialMessages = [],
    provider,
    model,
    onFinish,
    onError,
    headers = {},
    body = {},
    maxSteps = 1,
    onToolCall,
    onStepFinish,
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

  function updateAssistantMessage(id: string, updater: (m: UIMessage) => UIMessage) {
    messages.value = messages.value.map((m) =>
      m.id === id ? updater(m) : m
    );
  }

  async function sendRequest(messageHistory: UIMessage[], assistantMessage: UIMessage) {
    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: messageHistory.map((m) => ({ role: m.role, content: m.content })),
          provider,
          model,
          stream: true,
          maxSteps,
          ...body,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("Response body is null");

      let content = "";
      const toolInvocations: UIToolInvocation[] = [];
      const pendingToolCalls = new Map<string, { name: string; argsBuffer: string }>();

      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "text_delta":
            content += msg.text;
            updateAssistantMessage(assistantMessage.id, (m) => ({ ...m, content }));
            break;

          case "tool_call_start": {
            const invocation: UIToolInvocation = {
              id: msg.id,
              name: msg.name,
              args: {},
              state: "call",
            };
            toolInvocations.push(invocation);
            pendingToolCalls.set(msg.id, { name: msg.name, argsBuffer: "" });
            updateAssistantMessage(assistantMessage.id, (m) => ({
              ...m,
              toolInvocations: [...toolInvocations],
            }));
            break;
          }

          case "tool_call_delta": {
            const pending = pendingToolCalls.get(msg.id);
            if (pending) {
              pending.argsBuffer += msg.args;
              try {
                const partialArgs = JSON.parse(pending.argsBuffer);
                const invocation = toolInvocations.find((t) => t.id === msg.id);
                if (invocation) {
                  invocation.args = partialArgs;
                  updateAssistantMessage(assistantMessage.id, (m) => ({
                    ...m,
                    toolInvocations: [...toolInvocations],
                  }));
                }
              } catch {
                // Partial JSON not parseable yet
              }
            }
            break;
          }

          case "tool_call_end": {
            const pending = pendingToolCalls.get(msg.id);
            const invocation = toolInvocations.find((t) => t.id === msg.id);
            if (invocation && pending) {
              try {
                invocation.args = JSON.parse(pending.argsBuffer || "{}");
              } catch {
                invocation.args = { raw: pending.argsBuffer };
              }
              pendingToolCalls.delete(msg.id);

              if (onToolCall) {
                try {
                  invocation.state = "call";
                  const result = await onToolCall({
                    id: msg.id,
                    name: invocation.name,
                    args: invocation.args,
                  });
                  invocation.result = result;
                  invocation.state = "result";
                } catch (err) {
                  invocation.state = "error";
                  invocation.error = (err as Error).message;
                }
              } else {
                invocation.state = "call";
              }

              updateAssistantMessage(assistantMessage.id, (m) => ({
                ...m,
                toolInvocations: [...toolInvocations],
              }));
            }
            break;
          }

          case "message_end":
            if (msg.usage) {
              updateAssistantMessage(assistantMessage.id, (m) => ({
                ...m,
                usage: msg.usage,
              }));
            }
            break;

          case "error":
            throw new Error(msg.error);
        }
      }

      const finalMessage: UIMessage = {
        ...assistantMessage,
        content,
        toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
      };
      onFinish?.(finalMessage);
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

    await sendRequest([...messages.value.slice(0, -2), userMessage], assistantMessage);
  }

  async function append(message: UIMessage | { role: "user"; content: string }) {
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

    messages.value = [...messages.value, userMessage, assistantMessage];
    isLoading.value = true;
    error.value = null;

    await sendRequest([...messages.value.slice(0, -2), userMessage], assistantMessage);
  }

  async function reload() {
    if (isLoading.value || messages.value.length === 0) return;

    const lastUserIdx = messages.value.findLastIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;

    const messagesUpToLastUser = messages.value.slice(0, lastUserIdx + 1);

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider,
      model,
    };

    messages.value = [...messagesUpToLastUser, assistantMessage];
    isLoading.value = true;
    error.value = null;

    await sendRequest(messagesUpToLastUser, assistantMessage);
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
    append,
    reload,
    setMessages,
    stop,
    clear,
  };
}
