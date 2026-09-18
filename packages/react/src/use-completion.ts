/**
 * @hilbras/react — useCompletion Hook
 *
 * Manages a streaming text completion with an LLM backend.
 * Simpler than useChat — single prompt in, streamed text out.
 */

import { useState, useCallback, useRef } from "react";
import type {
  UseCompletionOptions,
  UseCompletionState,
  UseCompletionActions,
} from "@hilbras/sdk";
import { parseUIStream } from "./stream-parser.js";

export interface UseCompletionReturn extends UseCompletionState, UseCompletionActions {}

export function useCompletion(options: UseCompletionOptions): UseCompletionReturn {
  const {
    api,
    initialPrompt = "",
    provider,
    model,
    onFinish,
    onError,
    headers = {},
    body = {},
  } = options;

  const [completion, setCompletion] = useState("");
  const [input, setInput] = useState(initialPrompt);
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

    setCompletion("");
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          prompt: trimmed,
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

      let text = "";
      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "text_delta":
            text += msg.text;
            setCompletion(text);
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.(text);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [input, isLoading, api, provider, model, headers, body, onFinish, onError]);

  const clear = useCallback(() => {
    setCompletion("");
    setInput(initialPrompt);
    setError(null);
  }, [initialPrompt]);

  return {
    completion,
    input,
    isLoading,
    error,
    setInput,
    handleSubmit,
    stop,
    clear,
  };
}
