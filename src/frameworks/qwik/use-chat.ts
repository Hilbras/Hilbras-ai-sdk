/**
 * @hilbras/qwik — useChat
 *
 * Qwik-compatible chat hook with tool call support.
 */

import { useSignal } from "./signal-shim.js";
import { parseUIStream } from "./stream-parser.js";
import type { UIMessage, UIToolInvocation } from "../../index.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

export interface UseChatOptions {
  api?: string;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
  initialMessages?: UIMessage[];
  provider?: string;
  model?: string;
  maxSteps?: number;
  onToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => Promise<unknown> | unknown;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface UseChatReturn {
  messages: () => UIMessage[];
  isLoading: () => boolean;
  error: () => Error | null;
  setMessages: (msgs: UIMessage[]) => void;
  append: (message: UIMessage | { role: "user"; content: string }) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    api = "/api/chat",
    onFinish,
    onError,
    initialMessages = [],
    provider,
    model,
    maxSteps = 1,
    onToolCall,
    headers = {},
    body = {},
  } = options;

  const messages = useSignal<UIMessage[]>(initialMessages);
  const isLoading = useSignal(false);
  const error = useSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function sendRequest(messageHistory: UIMessage[], assistantMessage: UIMessage) {
    isLoading.value = true;
    error.value = null;
    abortController = new AbortController();

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
        signal: abortController.signal,
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
            messages.value = messages.value.map((m) =>
              m.id === assistantMessage.id ? { ...m, content } : m
            );
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
            messages.value = messages.value.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, toolInvocations: [...toolInvocations] }
                : m
            );
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
                  messages.value = messages.value.map((m) =>
                    m.id === assistantMessage.id
                      ? { ...m, toolInvocations: [...toolInvocations] }
                      : m
                  );
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

              messages.value = messages.value.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, toolInvocations: [...toolInvocations] }
                  : m
              );
            }
            break;
          }

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

      const finalMessage: UIMessage = {
        ...assistantMessage,
        content,
        toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
      };
      onFinish?.(finalMessage);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const e = err instanceof Error ? err : new Error(String(err));
        error.value = e;
        onError?.(e);
      }
    } finally {
      isLoading.value = false;
    }
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
    await sendRequest([...messages.value.slice(0, -2), userMessage], assistantMessage);
  }

  async function reload() {
    const msgs = messages.value;
    if (msgs.length === 0 || isLoading.value) return;

    const lastUserIdx = msgs.findLastIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;

    const messagesUpToLastUser = msgs.slice(0, lastUserIdx + 1);

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider,
      model,
    };

    messages.value = [...messagesUpToLastUser, assistantMessage];
    await sendRequest(messagesUpToLastUser, assistantMessage);
  }

  function stop() {
    abortController?.abort();
    isLoading.value = false;
  }

  function clear() {
    messages.value = [];
    error.value = null;
  }

  function setMessages(msgs: UIMessage[]) {
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
