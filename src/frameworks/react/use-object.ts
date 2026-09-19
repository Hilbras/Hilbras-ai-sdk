/**
 * @hilbras/react — useObject Hook
 *
 * Streams structured JSON output from an LLM into a partial object state.
 * Uses the UIMessage protocol with tool_call deltas for incremental parsing.
 */

import { useState, useCallback, useRef } from "react";
import { parseUIStream } from "./stream-parser.js";

/** Options for useObject */
export interface UseObjectOptions<T> {
  /** API endpoint URL */
  api: string;
  /** Schema name / tool name the LLM should produce */
  schemaName: string;
  /** Callback when the full object is received */
  onFinish?: (object: T) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Extra body params */
  body?: Record<string, unknown>;
}

/** State returned by useObject */
export interface UseObjectState<T> {
  /** The partially streamed object (null until first delta) */
  object: Partial<T> | null;
  /** Whether streaming is in progress */
  isLoading: boolean;
  /** Last error */
  error: Error | null;
}

/** Actions returned by useObject */
export interface UseObjectActions<T> {
  /** Start streaming a new object */
  submit: (input?: Record<string, unknown>) => Promise<void>;
  /** Stop the current stream */
  stop: () => void;
  /** Reset state */
  clear: () => void;
  /** Replace the partial object manually */
  setObject: (obj: Partial<T> | null) => void;
}

export interface UseObjectReturn<T> extends UseObjectState<T>, UseObjectActions<T> {}

export function useObject<T>(options: UseObjectOptions<T>): UseObjectReturn<T> {
  const { api, schemaName, onFinish, onError, headers = {}, body = {} } = options;

  const [object, setObject] = useState<Partial<T> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const submit = useCallback(async (input?: Record<string, unknown>) => {
    if (isLoading) return;

    setObject(null);
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

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
            if (msg.name === schemaName) {
              partialArgs = "";
            }
            break;
          case "tool_call_delta":
            if (msg.id) {
              partialArgs += msg.args;
              try {
                result = JSON.parse(partialArgs) as Partial<T>;
                setObject({ ...result });
              } catch {
                // partial JSON — not parseable yet
              }
            }
            break;
          case "tool_call_end":
            if (partialArgs) {
              try {
                result = JSON.parse(partialArgs) as Partial<T>;
                setObject({ ...result });
              } catch {
                // final parse failed
              }
            }
            break;
          case "error":
            throw new Error(msg.error);
        }
      }

      onFinish?.(result as T);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [isLoading, api, schemaName, headers, body, onFinish, onError]);

  const clear = useCallback(() => {
    setObject(null);
    setError(null);
  }, []);

  return { object, isLoading, error, submit, stop, clear, setObject };
}
