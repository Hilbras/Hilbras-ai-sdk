/**
 * @hilbras/angular — Object Service
 *
 * Angular service for streaming structured JSON output from an LLM backend.
 * Uses Angular signals for reactive state management.
 *
 * Usage:
 *   @Component({ ... })
 *   export class ObjectComponent {
 *     obj = inject(HilbrasObjectService);
 *     partial = this.obj.object;
 *   }
 */

import { Injectable, signal } from "./angular-shim.js";

export interface ObjectOptions<T> {
  api: string;
  schemaName: string;
  onFinish?: (object: T) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class HilbrasObjectService {
  private _object = signal<Partial<unknown> | null>(null);
  private _isLoading = signal(false);
  private _error = signal<Error | null>(null);
  private _abortController: AbortController | null = null;

  readonly object = this._object.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  stop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._isLoading.set(false);
  }

  clear(): void {
    this._object.set(null);
    this._error.set(null);
    this.stop();
  }

  async submit<T>(options: ObjectOptions<T>): Promise<void> {
    if (this._isLoading()) return;

    this._object.set(null);
    this._isLoading.set(true);
    this._error.set(null);

    const controller = new AbortController();
    this._abortController = controller;

    try {
      const res = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify({
          schema: options.schemaName,
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
      let partialArgs = "";
      let result: Partial<T> = {};

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

          if (data.type === "tool_call_delta" && data.args) {
            partialArgs += data.args as string;
            try {
              result = JSON.parse(partialArgs) as Partial<T>;
              this._object.set({ ...result });
            } catch { /* partial JSON */ }
          }
        }
      }

      options.onFinish?.(result as T);
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
