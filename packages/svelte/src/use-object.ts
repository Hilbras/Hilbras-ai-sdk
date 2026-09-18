/**
 * @hilbras/svelte — useObject
 *
 * Streams structured JSON output from an LLM into a partial object state.
 */

import { parseUIStream } from "./stream-parser.js";

export interface UseObjectOptions<T> {
  api: string;
  schemaName: string;
  onFinish?: (object: T) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ObjectState<T> {
  object: Partial<T> | null;
  isLoading: boolean;
  error: Error | null;
}

export function useObject<T>(options: UseObjectOptions<T>) {
  const { api, schemaName, onFinish, onError, headers = {}, body = {} } = options;

  const state: ObjectState<T> = {
    object: null,
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

  async function submit(input?: Record<string, unknown>) {
    if (state.isLoading) return;

    state.object = null;
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
                state.object = { ...result };
                notify();
              } catch {}
            }
            break;
          case "tool_call_end":
            if (partialArgs) {
              try {
                result = JSON.parse(partialArgs) as Partial<T>;
                state.object = { ...result };
                notify();
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
      state.error = errObj;
      onError?.(errObj);
    } finally {
      abortController = null;
      state.isLoading = false;
      notify();
    }
  }

  function clear() {
    state.object = null;
    state.error = null;
    notify();
  }

  return {
    get object() { return state.object; },
    get isLoading() { return state.isLoading; },
    get error() { return state.error; },
    submit,
    stop,
    clear,
    subscribe,
  };
}
