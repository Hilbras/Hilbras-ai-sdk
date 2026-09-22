/**
 * @hilbras/sdk — Plugin System Types
 *
 * Plugins extend the HilbrasClient with lifecycle hooks that fire
 * around every LLM request. Plugins can modify requests, observe
 * responses, handle errors, and clean up resources.
 */

import type { HilbrasClient } from "../client/client.js";
import type { Message } from "../types/messages.js";

/**
 * Context passed to `onRequest` hooks. Plugins can inspect and
 * mutate the request before it is sent to the provider.
 */
export interface PluginRequestContext {
  /** The request ID assigned by the client */
  requestId: string;
  /** The resolved provider name */
  provider: string;
  /** The resolved model ID */
  model: string;
  /** The normalized messages being sent */
  messages: Message[];
  /** Additional provider-specific parameters */
  extra?: Record<string, unknown>;
  /** Abort signal for this request */
  signal?: AbortSignal;
  /** Timestamp when the request started */
  timestamp: number;
}

/**
 * Context passed to `onResponse` hooks. Fired after a successful
 * LLM response (stream complete or non-stream completion).
 */
export interface PluginResponseContext {
  /** The request ID */
  requestId: string;
  /** The provider that handled the request */
  provider: string;
  /** The model that was used */
  model: string;
  /** Duration of the request in milliseconds */
  durationMs: number;
  /** Input token count (if available) */
  inputTokens?: number;
  /** Output token count (if available) */
  outputTokens?: number;
  /** Whether this was a streaming request */
  streaming: boolean;
}

/**
 * Context passed to `onError` hooks. Fired when a request fails
 * after all retries and fallbacks are exhausted.
 */
export interface PluginErrorContext {
  /** The request ID */
  requestId: string;
  /** The provider that failed */
  provider: string;
  /** The model that failed */
  model: string;
  /** The error that caused the failure */
  error: Error;
  /** Duration of the request in milliseconds */
  durationMs: number;
  /** Number of attempts made */
  attempts: number;
}

/**
 * A plugin that extends the HilbrasClient with lifecycle hooks.
 *
 * @example
 * ```ts
 * const loggingPlugin: Plugin = {
 *   name: "request-logger",
 *   version: "1.0.0",
 *   onRequest(ctx) {
 *     console.log(`[${ctx.requestId}] ${ctx.provider}/${ctx.model}`);
 *   },
 *   onResponse(ctx) {
 *     console.log(`[${ctx.requestId}] completed in ${ctx.durationMs}ms`);
 *   },
 *   onError(ctx) {
 *     console.error(`[${ctx.requestId}] failed: ${ctx.error.message}`);
 *   },
 * };
 *
 * client.use(loggingPlugin);
 * ```
 */
export interface Plugin {
  /** Unique plugin name (used for deduplication) */
  name: string;
  /** Semantic version string */
  version?: string;

  /**
   * Called once when the plugin is registered via `client.use()`.
   * Use this to set up resources, subscribe to events, or
   * configure the client.
   */
  setup?(client: HilbrasClient): void | Promise<void>;

  /**
   * Called before every LLM request. Can inspect and modify the
   * request context. Throw an error to abort the request.
   */
  onRequest?(ctx: PluginRequestContext): void | Promise<void>;

  /**
   * Called after a successful LLM response.
   */
  onResponse?(ctx: PluginResponseContext): void | Promise<void>;

  /**
   * Called when a request fails after all retries.
   */
  onError?(ctx: PluginErrorContext): void | Promise<void>;

  /**
   * Called when the plugin is removed or the client is disposed.
   * Use this to clean up resources.
   */
  destroy?(): void | Promise<void>;
}
