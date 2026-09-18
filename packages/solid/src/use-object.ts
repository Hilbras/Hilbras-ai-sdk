/**
 * @hilbras/solid — useObject
 *
 * Signal-based streaming object hook for SolidJS.
 */

import { createSignal } from "./solid-shim.js";

export interface UseObjectOptions {
  api?: string;
  onError?: (error: Error) => void;
}

export interface UseObjectReturn<T> {
  object: () => T | null;
  isLoading: () => boolean;
  error: () => Error | null;
  setObject: (value: T | null | ((prev: T | null) => T | null)) => void;
  submit: (input: unknown) => Promise<void>;
  stop: () => void;
}

export function useObject<T>(options: UseObjectOptions = {}): UseObjectReturn<T> {
  const { api = "/api/object", onError } = options;

  const [object, setObject] = createSignal<T | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  let abortController: AbortController | null = null;

  async function submit(input: unknown) {
    setIsLoading(true);
    setError(null);
    setObject(null);
    abortController = new AbortController();

    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
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
        try {
          setObject(JSON.parse(text));
        } catch {
          // Partial JSON, wait for more
        }
      }
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
    object,
    isLoading,
    error,
    setObject,
    submit,
    stop,
  };
}
