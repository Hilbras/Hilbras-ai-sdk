/**
 * @hilbras/vue — useCompletion Composition Function
 *
 * Manages a streaming text completion with an LLM backend.
 */

import { ref, readonly } from "vue";
import type { UseCompletionOptions } from "../../index.js";
import { parseUIStream } from "./stream-parser.js";

export function useCompletion(options: UseCompletionOptions) {
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

  const completion = ref("");
  const input = ref(initialPrompt);
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

    completion.value = "";
    isLoading.value = true;
    error.value = null;

    const controller = new AbortController();
    abortController = controller;

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

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("Response body is null");

      let text = "";
      for await (const msg of parseUIStream(res.body)) {
        switch (msg.type) {
          case "text_delta":
            text += msg.text;
            completion.value = text;
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.(text);
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
    completion.value = "";
    input.value = initialPrompt;
    error.value = null;
  }

  return {
    completion: readonly(completion),
    input,
    isLoading: readonly(isLoading),
    error: readonly(error),
    handleSubmit,
    stop,
    clear,
  };
}
