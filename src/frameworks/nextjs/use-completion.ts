/**
 * @hilbras/nextjs — useCompletion
 */

import { useSignal } from "./signal-shim.js";

export interface UseCompletionOptions {
  api?: string;
  onFinish?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface UseCompletionReturn {
  completion: () => string;
  isLoading: () => boolean;
  error: () => Error | null;
  setCompletion: (value: string) => void;
  complete: (prompt: string) => Promise<void>;
  stop: () => void;
}

export function useCompletion(options: UseCompletionOptions = {}): UseCompletionReturn {
  const { api = "/api/completion", onFinish, onError } = options;

  const completion = useSignal("");
  const isLoading = useSignal(false);
  const error = useSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function complete(prompt: string) {
    isLoading.value = true;
    error.value = null;
    completion.value = "";
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
        completion.value = text;
      }

      onFinish?.(text);
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

  function stop() {
    abortController?.abort();
    isLoading.value = false;
  }

  function setCompletion(value: string) {
    completion.value = value;
  }

  return {
    completion: () => completion.value,
    isLoading: () => isLoading.value,
    error: () => error.value,
    setCompletion,
    complete,
    stop,
  };
}
