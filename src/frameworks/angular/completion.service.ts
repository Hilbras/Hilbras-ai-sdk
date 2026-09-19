/**
 * @hilbras/angular — Completion Service
 *
 * Angular service for streaming text completions from an LLM backend.
 * Uses Angular signals for reactive state management.
 *
 * Usage:
 *   @Component({ ... })
 *   export class CompletionComponent {
 *     completion = inject(HilbrasCompletionService);
 *     text = this.completion.text;
 *   }
 */

import { Injectable, signal } from "./angular-shim.js";

export interface CompletionOptions {
  api: string;
  prompt?: string;
  onFinish?: (text: string) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class HilbrasCompletionService {
  private _text = signal("");
  private _isLoading = signal(false);
  private _error = signal<Error | null>(null);
  private _abortController: AbortController | null = null;

  readonly text = this._text.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  stop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._isLoading.set(false);
  }

  clear(): void {
    this._text.set("");
    this._error.set(null);
    this.stop();
  }

  async submit(options: CompletionOptions): Promise<void> {
    if (this._isLoading()) return;

    this._text.set("");
    this._isLoading.set(true);
    this._error.set(null);

    const controller = new AbortController();
    this._abortController = controller;

    try {
      const res = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify({
          prompt: options.prompt ?? "",
          stream: true,
          ...options.body,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("Response body is null");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let rawData = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) rawData = line.slice(6).trim();
          }
          if (!rawData || rawData === "[DONE]") continue;

          let data: Record<string, unknown>;
          try { data = JSON.parse(rawData); } catch { continue; }

          if (data.type === "text" && typeof data.text === "string") {
            fullText += data.text;
            this._text.set(fullText);
          }
        }
      }

      options.onFinish?.(fullText);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      this._error.set(error);
      options.onError?.(error);
    } finally {
      this._abortController = null;
      this._isLoading.set(false);
    }
  }
}
