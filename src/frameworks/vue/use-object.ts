/**
 * @hilbras/vue — useObject Composition Function
 *
 * Streams structured JSON output from an LLM into a partial object state.
 */

import { ref, readonly } from "vue";
import { parseUIStream } from "./stream-parser.js";

export interface UseObjectOptions<T> {
  api: string;
  schemaName: string;
  onFinish?: (object: T) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export function useObject<T>(options: UseObjectOptions<T>) {
  const { api, schemaName, onFinish, onError, headers = {}, body = {} } = options;

  const object = ref<Partial<T> | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  let abortController: AbortController | null = null;

  function stop() {
    abortController?.abort();
    abortController = null;
    isLoading.value = false;
  }

  async function submit(input?: Record<string, unknown>) {
    if (isLoading.value) return;

    object.value = null;
    isLoading.value = true;
    error.value = null;

    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          schema: schemaName,
          input: input ?? {},
          stream: true,
          ...body,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("Response body is null");

      let partialArgs = "";
      let result: Partial<T> = {};

      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "tool_call_start":
            if (msg.name === schemaName) partialArgs = "";
            break;
          case "tool_call_delta":
            if (msg.id) {
              partialArgs += msg.args;
              try {
                result = JSON.parse(partialArgs) as Partial<T>;
                object.value = { ...result };
              } catch {}
            }
            break;
          case "tool_call_end":
            if (partialArgs) {
              try {
                result = JSON.parse(partialArgs) as Partial<T>;
                object.value = { ...result };
              } catch {}
            }
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.(result as T);
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

  function clear() {
    object.value = null;
    error.value = null;
  }

  return {
    object: readonly(object),
    isLoading: readonly(isLoading),
    error: readonly(error),
    submit,
    stop,
    clear,
  };
}
