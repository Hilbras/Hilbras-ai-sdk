/**
 * @hilbras/solid — useCompletion
 *
 * Signal-based completion hook for SolidJS.
 */

import { createSignal } from "./solid-shim.js";

export interface UseCompletionOptions {
  api?: string;
  onFinish?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface UseCompletionReturn {
  completion: () => string;
  isLoading: () => boolean;
  error: () => Error | null;
  setCompletion: (value: string | ((prev: string) => string)) => void;
  complete: (prompt: string) => Promise<void>;
  stop: () => void;
}

export function useCompletion(options: UseCompletionOptions = {}): UseCompletionReturn {
  const { api = "/api/completion", onFinish, onError } = options;

  const [completion, setCompletion] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function complete(prompt: string) {
    setIsLoading(true);
    setError(null);
    setCompletion("");
    abortController = new AbortController();

    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setCompletion(text);
      }

      onFinish?.(text);
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

  function stop() {
    abortController?.abort();
    setIsLoading(false);
  }

  return {
    completion,
    isLoading,
    error,
    setCompletion,
    complete,
    stop,
  };
}
