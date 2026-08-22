/**
 * @hilbras/sdk — Universal Provider Contract
 *
 * Defines the `AIProvider` interface that all adapters must implement.
 * This is the foundation for provider plugin architecture: any class
 * conforming to this contract can be used with HilbrasClient.
 *
 * Usage:
 *   import { AIProvider } from "@hilbras/sdk/adapter";
 *   class MyProvider implements AIProvider { ... }
 */

import type { ProviderConfig } from "./providers.js";
import type { Message } from "./messages.js";
import type { Tool } from "./tools.js";
import type { StreamChunk } from "./streams.js";
import type { Transport } from "../transport/transport.js";

/** Shared config passed to all adapter constructors */
export interface AdapterConfig {
  provider: ProviderConfig;
  transport: Transport;
}

/** Parameters for stream/complete calls */
export interface GenerateParams {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * The universal provider contract. All adapters implement this.
 *
 * Any class with this shape can be registered via AdapterRegistry
 * and used with HilbrasClient — no SDK modification required.
 */
export interface AIProvider {
  /** Unique identifier for this provider type (e.g. "openai", "anthropic") */
  readonly id: string;

  /** Stream a chat completion */
  stream(params: GenerateParams): AsyncGenerator<StreamChunk>;

  /** Non-streaming chat completion */
  complete(params: GenerateParams): Promise<string>;
}
