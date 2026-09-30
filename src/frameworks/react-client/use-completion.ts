"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useHilbrasClient } from "./provider.js";

export interface UseCompletionOptions {
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** Called on each text chunk during streaming */
  onChunk?: (chunk: { text: string; accumulated: string }) => void;
  /** Called when completion finishes */
  onComplete?: (text: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface UseCompletionReturn {
  /** Current completion text */
  completion: string;
  /** The full prompt sent */
  prompt: string;
  /** Set the prompt */
  setPrompt: (value: string) => void;
  /** Generate completion from current prompt */
  complete: (promptOverride?: string) => Promise<string>;
  /** Whether generating */
  isLoading: boolean;
  /** Whether streaming */
  isStreaming: boolean;
  /** Current error */
  error: Error | null;
  /** Abort current generation */
  stop: () => void;
  /** Clear completion */
  clear: () => void;
  /** Token count */
  tokens: { input: number; output: number; total: number };
}

/**
 * useCompletion — text completion hook for React.
 *
 * @example
 * ```tsx
 * function AutoComplete() {
 *   const { completion, prompt, setPrompt, complete, isLoading } = useCompletion({
 *     provider: "openai",
 *     model: "gpt-4o",
 *     systemPrompt: "Complete the following text:",
 *   });
 *
 *   return (
 *     <div>
 *       <textarea value={prompt} onChange={e => setPrompt(e.target.value)} />
 *       <button onClick={() => complete()} disabled={isLoading}>Complete</button>
 *       {completion && <div>{completion}</div>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCompletion(options: UseCompletionOptions): UseCompletionReturn {
  const { provider, model, systemPrompt, onChunk, onComplete, onError } = options;

  const client = useHilbrasClient();
  const [completion, setCompletion] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tokens, setTokens] = useState({ input: 0, output: 0, total: 0 });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    stop();
    setCompletion("");
    setError(null);
    setTokens({ input: 0, output: 0, total: 0 });
  }, [stop]);

  const complete = useCallback(async (promptOverride?: string): Promise<string> => {
    const promptText = promptOverride ?? prompt;
    if (!promptText.trim() || isLoading) return "";

    setIsLoading(true);
    setIsStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiMessages = [];
      if (systemPrompt) {
        apiMessages.push({ role: "system" as const, content: systemPrompt });
      }
      apiMessages.push({ role: "user" as const, content: promptText });

      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of client.stream({
        messages: apiMessages,
        model,
        provider,
        signal: controller.signal,
      })) {
        if (chunk.type === "text") {
          text += chunk.text;
          setCompletion(text);
          onChunk?.({ text: chunk.text, accumulated: text });
        }
        if (chunk.type === "usage") {
          inputTokens = chunk.inputTokens ?? 0;
          outputTokens = chunk.outputTokens ?? 0;
        }
      }

      setTokens({ input: inputTokens, output: outputTokens, total: inputTokens + outputTokens });
      onComplete?.(text);
      return text;

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return completion;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      return completion;
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [client, prompt, provider, model, systemPrompt, isLoading, completion, onChunk, onComplete, onError]);

  return {
    completion,
    prompt,
    setPrompt,
    complete,
    isLoading,
    isStreaming,
    error,
    stop,
    clear,
    tokens,
  };
}
