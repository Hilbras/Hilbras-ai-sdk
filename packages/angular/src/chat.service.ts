/**
 * @hilbras/angular — Chat Service
 *
 * Angular service for streaming chat conversations with an LLM backend.
 * Uses Angular signals for reactive state management.
 *
 * Usage:
 *   @Component({ ... })
 *   export class ChatComponent {
 *     chat = inject(HilbrasChatService);
 *     messages = this.chat.messages;
 *     isLoading = this.chat.isLoading;
 *
 *     send() {
 *       this.chat.submit({ api: '/api/chat', body: { model: 'gpt-4o' } });
 *     }
 *   }
 */

import { Injectable, signal, computed } from "./angular-shim.js";

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt?: number;
  provider?: string;
  model?: string;
}

let _idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${_idCounter++}`;
}

export interface ChatOptions {
  api: string;
  initialMessages?: UIMessage[];
  provider?: string;
  model?: string;
  onFinish?: (messages: UIMessage[]) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class HilbrasChatService {
  private _messages = signal<UIMessage[]>([]);
  private _input = signal("");
  private _isLoading = signal(false);
  private _error = signal<Error | null>(null);
  private _abortController: AbortController | null = null;

  readonly messages = this._messages.asReadonly();
  readonly input = this._input.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMessages = computed(() => this._messages().length > 0);

  setInput(value: string): void {
    this._input.set(value);
  }

  stop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._isLoading.set(false);
  }

  clear(): void {
    this._messages.set([]);
    this._input.set("");
    this._error.set(null);
    this.stop();
  }

  async submit(options: ChatOptions): Promise<void> {
    const trimmed = this._input().trim();
    if (!trimmed || this._isLoading()) return;

    const userMessage: UIMessage = {
      id: generateId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    const assistantMessage: UIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      provider: options.provider,
      model: options.model,
    };

    this._messages.update((msgs) => [...msgs, userMessage, assistantMessage]);
    this._input.set("");
    this._isLoading.set(true);
    this._error.set(null);

    const controller = new AbortController();
    this._abortController = controller;

    try {
      const res = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify({
          messages: this._messages().slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content,
          })),
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
            this._messages.update((msgs) => {
              const updated = [...msgs];
              const last = updated[updated.length - 1];
              if (last) updated[updated.length - 1] = { ...last, content: last.content + data.text };
              return updated;
            });
          }
        }
      }

      const finalMessages = this._messages();
      options.onFinish?.(finalMessages);
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
