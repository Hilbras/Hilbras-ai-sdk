/**
 * @hilbras/sdk — Policy Presets
 *
 * Named presets that map to fully-resolved execution policies.
 * Each preset represents a common usage pattern.
 */

import type { ExecutionPolicy, ResolvedPolicy, PolicyPreset } from "../types/policy.js";

// ─── Preset Definitions ─────────────────────────────────────────────────────

const PRESETS: Record<PolicyPreset, ResolvedPolicy> = {
  /**
   * Balanced defaults — same as the SDK's current behavior.
   * Good for most applications.
   */
  balanced: {
    retry: { maxRetries: 3, retryableStatuses: new Set([429, 500, 502, 503, 504]), retryableNetworkErrors: true },
    backoff: { baseDelayMs: 500, maxDelayMs: 30_000, jitter: 0.3 },
    timeout: { requestTimeoutMs: 60_000 },
    circuitBreaker: { enabled: true, failureThreshold: 5, successThreshold: 2, timeoutMs: 30_000, halfOpenMaxCalls: 3 },
  },

  /**
   * Production — conservative, reliable, safe defaults.
   * More retries, longer timeout, circuit breaker on.
   */
  production: {
    retry: { maxRetries: 5, retryableStatuses: new Set([429, 500, 502, 503, 504]), retryableNetworkErrors: true },
    backoff: { baseDelayMs: 1_000, maxDelayMs: 60_000, jitter: 0.3 },
    timeout: { requestTimeoutMs: 120_000 },
    circuitBreaker: { enabled: true, failureThreshold: 5, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 3 },
  },

  /**
   * Fast — fewer retries, lower timeout, fail fast.
   * Good for latency-sensitive applications.
   */
  fast: {
    retry: { maxRetries: 1, retryableStatuses: new Set([429, 502, 503]), retryableNetworkErrors: false },
    backoff: { baseDelayMs: 200, maxDelayMs: 2_000, jitter: 0.1 },
    timeout: { requestTimeoutMs: 15_000 },
    circuitBreaker: { enabled: true, failureThreshold: 3, successThreshold: 1, timeoutMs: 15_000, halfOpenMaxCalls: 2 },
  },

  /**
   * Cheap — maximize retries, longer timeout, no circuit breaker.
   * Good when cost matters more than latency.
   */
  cheap: {
    retry: { maxRetries: 10, retryableStatuses: new Set([429, 500, 502, 503, 504, 408, 429]), retryableNetworkErrors: true },
    backoff: { baseDelayMs: 2_000, maxDelayMs: 120_000, jitter: 0.5 },
    timeout: { requestTimeoutMs: 300_000 },
    circuitBreaker: { enabled: false, failureThreshold: 10, successThreshold: 2, timeoutMs: 60_000, halfOpenMaxCalls: 5 },
  },

  /**
   * Maximum — aggressive retries, long timeout, strict circuit breaker.
   * Good for critical operations that must succeed.
   */
  maximum: {
    retry: { maxRetries: 10, retryableStatuses: new Set([429, 500, 502, 503, 504, 408, 413, 429, 507]), retryableNetworkErrors: true },
    backoff: { baseDelayMs: 1_000, maxDelayMs: 60_000, jitter: 0.3 },
    timeout: { requestTimeoutMs: 300_000 },
    circuitBreaker: { enabled: true, failureThreshold: 10, successThreshold: 3, timeoutMs: 120_000, halfOpenMaxCalls: 5 },
  },
};

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve an ExecutionPolicy into a fully-filled ResolvedPolicy.
 *
 * Priority: individual field overrides > preset > balanced defaults.
 */
export function resolvePolicy(policy?: ExecutionPolicy): ResolvedPolicy {
  if (!policy) return { ...PRESETS.balanced };

  // Start with a deep copy of the named preset (or balanced)
  const src = policy.preset ? PRESETS[policy.preset] : PRESETS.balanced;
  const base: ResolvedPolicy = {
    retry: { ...src.retry, retryableStatuses: new Set(src.retry.retryableStatuses) },
    backoff: { ...src.backoff },
    timeout: { ...src.timeout },
    circuitBreaker: { ...src.circuitBreaker },
  };

  // Apply retry overrides
  if (policy.retry) {
    if (policy.retry.maxRetries !== undefined) base.retry.maxRetries = policy.retry.maxRetries;
    if (policy.retry.retryableStatuses !== undefined) base.retry.retryableStatuses = new Set(policy.retry.retryableStatuses);
    if (policy.retry.retryableNetworkErrors !== undefined) base.retry.retryableNetworkErrors = policy.retry.retryableNetworkErrors;
  }

  // Apply backoff overrides
  if (policy.backoff) {
    if (policy.backoff.baseDelayMs !== undefined) base.backoff.baseDelayMs = policy.backoff.baseDelayMs;
    if (policy.backoff.maxDelayMs !== undefined) base.backoff.maxDelayMs = policy.backoff.maxDelayMs;
    if (policy.backoff.jitter !== undefined) base.backoff.jitter = policy.backoff.jitter;
  }

  // Apply timeout overrides
  if (policy.timeout) {
    if (policy.timeout.requestTimeoutMs !== undefined) base.timeout.requestTimeoutMs = policy.timeout.requestTimeoutMs;
  }

  // Apply circuit breaker overrides
  if (policy.circuitBreaker) {
    if (policy.circuitBreaker.enabled !== undefined) base.circuitBreaker.enabled = policy.circuitBreaker.enabled;
    if (policy.circuitBreaker.failureThreshold !== undefined) base.circuitBreaker.failureThreshold = policy.circuitBreaker.failureThreshold;
    if (policy.circuitBreaker.successThreshold !== undefined) base.circuitBreaker.successThreshold = policy.circuitBreaker.successThreshold;
    if (policy.circuitBreaker.timeoutMs !== undefined) base.circuitBreaker.timeoutMs = policy.circuitBreaker.timeoutMs;
    if (policy.circuitBreaker.halfOpenMaxCalls !== undefined) base.circuitBreaker.halfOpenMaxCalls = policy.circuitBreaker.halfOpenMaxCalls;
  }

  return base;
}

/**
 * Get a preset by name without resolution (useful for inspection).
 * Returns a deep copy to prevent mutation of the internal preset.
 */
export function getPreset(name: PolicyPreset): ResolvedPolicy {
  const src = PRESETS[name];
  return {
    retry: { ...src.retry, retryableStatuses: new Set(src.retry.retryableStatuses) },
    backoff: { ...src.backoff },
    timeout: { ...src.timeout },
    circuitBreaker: { ...src.circuitBreaker },
  };
}
