/**
 * @hilbras/react — useChat Hook
 *
 * Manages a streaming chat conversation with an LLM backend.
 * Handles message state, streaming, tool calls, input, error recovery,
 * optimistic updates, reload, and step-level callbacks.
 */

import { useState, useCallback, useRef } from "react";
import type {
  UIMessage,
  UIToolInvocation,
  UseChatOptions,
  UseChatState,
  UseChatActions,
} from "../../index.js";
import { parseUIStream } from "./stream-parser.js";

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

/** Extended options with tool calling support */
export interface UseChatToolOptions extends UseChatOptions {
  /** Maximum number of tool-calling steps (default: 1 = no multi-step) */
  maxSteps?: number;
  /** Callback when a tool call is received; return the tool result */
  onToolCall?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => Promise<unknown> | unknown;
  /** Callback after each step completes */
  onStepFinish?: (step: { step: number; text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }> }) => void;
}

export interface UseChatReturn extends UseChatState, UseChatActions {
  /** Reload the last assistant message */
  reload: () => Promise<void>;
  /** Append a message and get a response */
  append: (message: UIMessage | { role: "user"; content: string }) => Promise<void>;
}

export function useChat(options: UseChatToolOptions): UseChatReturn {
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
          maxSteps,
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
      let step = 0;
      const toolInvocations: UIToolInvocation[] = [];
      // Accumulate tool call args across deltas
      const pendingToolCalls = new Map<string, { name: string; argsBuffer: string }>();

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

          case "reasoning_delta":
            // Reasoning is available but not displayed by default
            // Could be exposed via a callback in the future
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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, toolInvocations: [...toolInvocations] }
                  : m
              )
            );
            break;
          }

          case "tool_call_delta": {
            const pending = pendingToolCalls.get(msg.id);
            if (pending) {
              pending.argsBuffer += msg.args;
              // Try to parse partial args for progressive display
              try {
                const partialArgs = JSON.parse(pending.argsBuffer);
                const invocation = toolInvocations.find((t) => t.id === msg.id);
                if (invocation) {
                  invocation.args = partialArgs;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, toolInvocations: [...toolInvocations] }
                        : m
                    )
                  );
                }
              } catch {
                // Partial JSON not parseable yet, skip progressive update
              }
            }
            break;
          }

          case "tool_call_end": {
            const pending = pendingToolCalls.get(msg.id);
            const invocation = toolInvocations.find((t) => t.id === msg.id);
            if (invocation && pending) {
              // Final parse of complete args
              try {
                invocation.args = JSON.parse(pending.argsBuffer || "{}");
              } catch {
                invocation.args = { raw: pending.argsBuffer };
              }
              pendingToolCalls.delete(msg.id);

              // Execute tool if handler provided
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
                // No handler — mark as call (not executed)
                invocation.state = "call";
              }

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, toolInvocations: [...toolInvocations] }
                    : m
                )
              );
            }
            break;
          }

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

        // Track step boundaries (text_delta after tool results = new step)
        if (msg.type === "text_delta" && toolInvocations.length > 0) {
          // Check if all tool calls are resolved
          const allResolved = toolInvocations.every((t) => t.state !== "call");
          if (allResolved) {
            step++;
            onStepFinish?.({
              step,
              text: content,
              toolCalls: toolInvocations.map((t) => ({
                name: t.name,
                args: t.args,
                result: t.result,
              })),
            });
          }
        }
      }

      const finalMessage: UIMessage = {
        ...assistantMessage,
        content,
        toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
      };
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
  }, [api, provider, model, headers, body, maxSteps, onToolCall, onStepFinish, onFinish, onError]);

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
