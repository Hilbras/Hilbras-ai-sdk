/**
 * @hilbras/sdk — Transport abstraction
 *
 * Decouples HTTP execution from provider adapters.
 * Swap implementations: Node fetch, Bun fetch, Deno fetch, mock for tests.
 */

export interface TransportRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface Transport {
  /** Send an HTTP request and return the raw Response */
  request(url: string, init: TransportRequestInit): Promise<Response>;

  /** Send an HTTP request and return a ReadableStream of bytes (for SSE) */
  stream(url: string, init: TransportRequestInit): Promise<ReadableStream<Uint8Array>>;

  /** Abort any in-flight requests */
  abort(): void;
}
