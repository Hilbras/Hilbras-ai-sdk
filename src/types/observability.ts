/**
 * @hilbras/sdk — Observability Hook Types
 *
 * Typed events emitted by HilbrasClient during request lifecycle.
 * Developers subscribe via client.on() to observe routing, retries,
 * circuit breaker, validation, and streaming events.
 *
 * Usage:
 *   client.on("request.completed", (event) => {
 *     console.log(`${event.provider}/${event.model} took ${event.durationMs}ms`);
 *   });
 */

/** Base fields present on every event */
interface BaseEvent {
  /** Unique request ID for correlation */
  requestId: string;
  /** Timestamp (performance.now()) */
  timestamp: number;
}

/** Request initiated */
export interface RequestStartEvent extends BaseEvent {
  type: "request.start";
  /** Provider name (if explicit) */
  provider?: string;
  /** Model ID (if explicit) */
  model?: string;
  /** Task type (if using router) */
  task?: string;
}

/** Router resolved a model */
export interface RoutingResolvedEvent extends BaseEvent {
  type: "routing.resolved";
  provider: string;
  model: string;
  score: number;
  reasons: string[];
}

/** Request completed successfully */
export interface RequestCompletedEvent extends BaseEvent {
  type: "request.completed";
  provider: string;
  model: string;
  /** Total duration in ms */
  durationMs: number;
  /** Number of attempts (including retries) */
  attempts: number;
  /** Input tokens (if available from usage chunk) */
  inputTokens?: number;
  /** Output tokens (if available from usage chunk) */
  outputTokens?: number;
  /** Whether structured output was used */
  structuredOutput: boolean;
}

/** Request failed after all retries exhausted */
export interface RequestFailedEvent extends BaseEvent {
  type: "request.failed";
  provider: string;
  model: string;
  /** Total duration in ms */
  durationMs: number;
  /** Number of attempts tried */
  attempts: number;
  /** The final error */
  error: string;
}

/** A retry is about to happen */
export interface RetryEvent extends BaseEvent {
  type: "request.retrying";
  provider: string;
  /** Current attempt number (0-based) */
  attempt: number;
  /** Delay before next attempt in ms */
  delayMs: number;
  /** Why we're retrying */
  reason: string;
}

/** Circuit breaker blocked the request */
export interface CircuitBreakerOpenEvent extends BaseEvent {
  type: "circuit_breaker.open";
  provider: string;
}

/** Schema validation passed */
export interface ValidationPassEvent extends BaseEvent {
  type: "structured.validate.pass";
}

/** Schema validation failed */
export interface ValidationFailEvent extends BaseEvent {
  type: "structured.validate.fail";
  /** Current attempt (including repair attempts) */
  attempt: number;
  /** Validation error message */
  error: string;
}

/** First chunk yielded in a stream */
export interface StreamFirstChunkEvent extends BaseEvent {
  type: "stream.first_chunk";
  /** Time from adapter call start to first chunk in ms */
  latencyMs: number;
}

/** Fallback attempted */
export interface FallbackEvent extends BaseEvent {
  type: "fallback.started";
  /** Original provider that failed */
  originalProvider: string;
  /** Original model that failed */
  originalModel: string;
  /** Fallback provider being tried */
  fallbackProvider: string;
  /** Fallback model being tried */
  fallbackModel: string;
}

/** All hook events */
export type HookEvent =
  | RequestStartEvent
  | RoutingResolvedEvent
  | RequestCompletedEvent
  | RequestFailedEvent
  | RetryEvent
  | CircuitBreakerOpenEvent
  | ValidationPassEvent
  | ValidationFailEvent
  | StreamFirstChunkEvent
  | FallbackEvent;

/** Event type name — used as the key for on()/off() */
export type HookEventType = HookEvent["type"];

/** Listener function type */
export type HookListener<T extends HookEvent = HookEvent> = (event: T) => void;
