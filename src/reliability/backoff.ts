/**
 * @hilbras/sdk — Backoff Policy
 *
 * Exponential backoff with jitter for retry delays.
 */

export interface BackoffConfig {
  /** Initial delay in ms (default: 500) */
  baseDelayMs: number;
  /** Maximum delay in ms (default: 30_000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 (default: 0.3) */
  jitter: number;
}

const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.3,
};

export function calculateBackoff(attempt: number, config?: Partial<BackoffConfig>): number {
  const cfg = { ...DEFAULT_BACKOFF, ...config };
  const exponential = cfg.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, cfg.maxDelayMs);
  const jitterRange = capped * cfg.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, capped + jitter);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}
