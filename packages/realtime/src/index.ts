/**
 * @hilbras/realtime — Realtime WebSocket Transport
 *
 * Low-latency voice and video interactions via WebSocket.
 * Supports OpenAI Realtime API, Google Live, and xAI Realtime.
 *
 * @example
 * ```ts
 * const session = new RealtimeSession({
 *   provider: "openai",
 *   model: "gpt-4o-realtime",
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * session.on("audio", (data) => playAudio(data));
 * session.on("text", (text) => console.log(text));
 *
 * await session.connect();
 * await session.sendAudio(microphoneBuffer);
 * ```
 */

export interface RealtimeSessionConfig {
  provider: "openai" | "google" | "xai";
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Audio format for input/output */
  audioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
  /** Voice to use for audio output */
  voice?: string;
  /** System instructions */
  instructions?: string;
  /** Temperature (0-2) */
  temperature?: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Tools available for function calling */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export type RealtimeEvent =
  | { type: "connected"; sessionId: string }
  | { type: "disconnected"; reason?: string }
  | { type: "text"; text: string; done: boolean }
  | { type: "audio"; data: ArrayBuffer; done: boolean }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; callId: string }
  | { type: "tool_result"; callId: string; result: unknown }
  | { type: "error"; error: Error }
  | { type: "latency"; ttsMs: number; sttMs: number; llmMs: number };

export type RealtimeEventHandler = (event: RealtimeEvent) => void;

export class RealtimeSession {
  private _config: RealtimeSessionConfig;
  private _ws: any = null;
  private _handlers = new Map<string, RealtimeEventHandler[]>();
  private _sessionId: string | null = null;
  private _connected = false;
  private _audioBuffer: ArrayBuffer[] = [];

  constructor(config: RealtimeSessionConfig) {
    this._config = {
      audioFormat: "pcm16",
      voice: "alloy",
      temperature: 0.8,
      ...config,
    };
  }

  /**
   * Connect to the realtime WebSocket endpoint.
   */
  async connect(): Promise<void> {
    const WebSocket = (globalThis as any).WebSocket;
    if (!WebSocket) {
      throw new Error("WebSocket not available in this environment");
    }

    const baseUrl = this._config.baseUrl ?? this._getBaseUrl();
    const url = `${baseUrl}?model=${this._config.model}`;

    this._ws = new WebSocket(url);
    this._ws.onopen = () => {
      this._connected = true;
      this._send({
        type: "session.update",
        session: {
          model: this._config.model,
          modalities: ["text", "audio"],
          instructions: this._config.instructions ?? "You are a helpful assistant.",
          voice: this._config.voice,
          input_audio_format: this._config.audioFormat,
          output_audio_format: this._config.audioFormat,
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: { type: "server_vad" },
          temperature: this._config.temperature,
          max_response_output_tokens: this._config.maxOutputTokens ?? "inf",
          tools: this._config.tools ?? [],
        },
      });
    };

    this._ws.onmessage = (event: any) => {
      const data = JSON.parse(event.data);
      this._handleMessage(data);
    };

    this._ws.onerror = (error: any) => {
      this._emit({ type: "error", error: new Error(error.message ?? "WebSocket error") });
    };

    this._ws.onclose = (event: any) => {
      this._connected = false;
      this._emit({ type: "disconnected", reason: event.reason });
    };

    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this._connected) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }

  /**
   * Send audio data to the session.
   */
  async sendAudio(data: ArrayBuffer): Promise<void> {
    if (!this._connected) throw new Error("Not connected");
    this._send({
      type: "input_audio_buffer.append",
      audio: this._arrayBufferToBase64(data),
    });
  }

  /**
   * Send a text message.
   */
  async sendText(text: string): Promise<void> {
    if (!this._connected) throw new Error("Not connected");
    this._send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this._send({ type: "response.create" });
  }

  /**
   * Send a tool result.
   */
  async sendToolResult(callId: string, result: unknown): Promise<void> {
    if (!this._connected) throw new Error("Not connected");
    this._send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof result === "string" ? result : JSON.stringify(result),
      },
    });
    this._send({ type: "response.create" });
  }

  /**
   * Close the session.
   */
  async close(): Promise<void> {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._connected = false;
  }

  /**
   * Register an event handler.
   */
  on(event: string, handler: RealtimeEventHandler): void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event)!.push(handler);
  }

  /**
   * Remove an event handler.
   */
  off(event: string, handler: RealtimeEventHandler): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }

  /**
   * Whether the session is connected.
   */
  get connected(): boolean {
    return this._connected;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private _getBaseUrl(): string {
    switch (this._config.provider) {
      case "openai":
        return "wss://api.openai.com/v1/realtime";
      case "google":
        return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;
      case "xai":
        return "wss://api.x.ai/v1/realtime";
      default:
        throw new Error(`Unsupported provider: ${this._config.provider}`);
    }
  }

  private _send(data: Record<string, unknown>): void {
    if (this._ws?.readyState === 1) {
      this._ws.send(JSON.stringify(data));
    }
  }

  private _handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case "session.created":
        this._sessionId = (data.session as any)?.id ?? "unknown";
        this._emit({ type: "connected", sessionId: this._sessionId ?? "unknown" });
        break;
      case "session.deleted":
        this._connected = false;
        break;
      case "conversation.item.created":
        break;
      case "response.text.delta":
        this._emit({ type: "text", text: (data.delta as string) ?? "", done: false });
        break;
      case "response.text.done":
        this._emit({ type: "text", text: "", done: true });
        break;
      case "response.audio.delta":
        this._emit({ type: "audio", data: this._base64ToArrayBuffer((data.delta as string) ?? ""), done: false });
        break;
      case "response.audio.done":
        this._emit({ type: "audio", data: new ArrayBuffer(0), done: true });
        break;
      case "response.function_call_arguments.delta":
        break;
      case "response.function_call_arguments.done":
        this._emit({
          type: "tool_call",
          name: (data.name as string) ?? "",
          arguments: JSON.parse((data.arguments as string) ?? "{}"),
          callId: (data.call_id as string) ?? "",
        });
        break;
      case "error":
        this._emit({ type: "error", error: new Error((data.error as any)?.message ?? "Unknown error") });
        break;
    }
  }

  private _emit(event: RealtimeEvent): void {
    const handlers = this._handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      handler(event);
    }
    // Also emit to wildcard handlers
    const wildcards = this._handlers.get("*") ?? [];
    for (const handler of wildcards) {
      handler(event);
    }
  }

  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private _base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
