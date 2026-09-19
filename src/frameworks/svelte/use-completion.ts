/**
 * @hilbras/svelte — useCompletion
 *
 * Manages a streaming text completion with an LLM backend.
 */

import type { UseCompletionOptions } from "../../index.js";
import { parseUIStream } from "./stream-parser.js";

export interface CompletionState {
  completion: string;
  input: string;
  isLoading: boolean;
  error: Error | null;
}

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

  const state: CompletionState = {
    completion: "",
    input: initialPrompt,
    isLoading: false,
    error: null,
  };

  let abortController: AbortController | null = null;
  const listeners: Array<() => void> = [];

  function notify() {
    for (const fn of listeners) fn();
  }

  function subscribe(fn: () => void) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function stop() {
    abortController?.abort();
    abortController = null;
    state.isLoading = false;
    notify();
  }

  async function handleSubmit(e?: { preventDefault: () => void }) {
    e?.preventDefault();

    const trimmed = state.input.trim();
    if (!trimmed || state.isLoading) return;

    state.completion = "";
    state.isLoading = true;
    state.error = null;
    notify();

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
            state.completion = text;
            notify();
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.(text);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const errObj = err instanceof Error ? err : new Error(String(err));
      state.error = errObj;
      onError?.(errObj);
    } finally {
      abortController = null;
      state.isLoading = false;
      notify();
    }
  }

  function clear() {
    state.completion = "";
    state.input = initialPrompt;
    state.error = null;
    notify();
  }

  return {
    get completion() { return state.completion; },
    get input() { return state.input; },
    set input(v: string) { state.input = v; notify(); },
    get isLoading() { return state.isLoading; },
    get error() { return state.error; },
    handleSubmit,
    stop,
    clear,
    subscribe,
  };
}
