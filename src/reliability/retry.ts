/**
 * @hilbras/sdk — Retry Policy
 *
 * Per-status-code retry rules:
 *   429 → retry (rate limited)
 *   500, 502, 503 → retry (server errors)
 *   400, 401, 403, 404 → don't retry (client errors)
 */

export interface RetryConfig {
  /** Max retry attempts (default: 3) */
  maxRetries: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatuses: Set<number>;
  /** Whether to retry on network/timeout errors */
  retryableNetworkErrors: boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
  retryableNetworkErrors: true,
};

export function createRetryConfig(overrides?: Partial<RetryConfig>): RetryConfig {
  return { ...DEFAULT_RETRY, ...overrides };
}

export function shouldRetry(status: number, attempt: number, config?: RetryConfig): boolean {
  const cfg = config ?? DEFAULT_RETRY;
  if (attempt >= cfg.maxRetries) return false;
  return cfg.retryableStatuses.has(status);
}

export function shouldRetryNetworkError(attempt: number, config?: RetryConfig): boolean {
  const cfg = config ?? DEFAULT_RETRY;
  return attempt < cfg.maxRetries && cfg.retryableNetworkErrors;
}
