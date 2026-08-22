/**
 * @hilbras/sdk — Execution Policy
 *
 * Controls reliability, cost, and execution behavior for AI requests.
 * Policies can be applied globally (via client config) or per-request.
 *
 * Usage:
 *   // Named preset
 *   client.stream({ ..., policy: { preset: "production" } });
 *
 *   // Custom policy
 *   client.stream({ ..., policy: { retry: { maxRetries: 5 }, timeout: { requestTimeoutMs: 10_000 } } });
 *
 *   // Preset with overrides
 *   client.stream({ ..., policy: { preset: "maximum", timeout: { requestTimeoutMs: 30_000 } } });
 */

/** Named presets that map to full resolved configs */
export type PolicyPreset = "production" | "fast" | "cheap" | "maximum" | "balanced";

/** Execution policy — controls reliability, cost, and execution behavior */
export interface ExecutionPolicy {
  /** Named preset (resolved to full config). Individual fields override preset values. */
  preset?: PolicyPreset;

  /** Retry configuration */
  retry?: {
    /** Max retry attempts */
    maxRetries?: number;
    /** HTTP status codes that trigger a retry */
    retryableStatuses?: number[];
    /** Whether to retry on network/timeout errors */
    retryableNetworkErrors?: boolean;
  };

  /** Backoff configuration */
  backoff?: {
    /** Initial delay in ms */
    baseDelayMs?: number;
    /** Maximum delay in ms */
    maxDelayMs?: number;
    /** Jitter factor 0-1 */
    jitter?: number;
  };

  /** Timeout configuration */
  timeout?: {
    /** Request timeout in ms (0 = no timeout) */
    requestTimeoutMs?: number;
  };

  /** Circuit breaker configuration */
  circuitBreaker?: {
    /** Whether circuit breaker is enabled */
    enabled?: boolean;
    /** Failures before opening */
    failureThreshold?: number;
    /** Successes before closing from half-open */
    successThreshold?: number;
    /** Time in open state before half-open (ms) */
    timeoutMs?: number;
    /** Max calls in half-open state */
    halfOpenMaxCalls?: number;
  };
}

/** Resolved policy — all fields filled in after preset resolution */
export interface ResolvedPolicy {
  retry: {
    maxRetries: number;
    retryableStatuses: Set<number>;
    retryableNetworkErrors: boolean;
  };
  backoff: {
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: number;
  };
  timeout: {
    requestTimeoutMs: number;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    successThreshold: number;
    timeoutMs: number;
    halfOpenMaxCalls: number;
  };
}
