/**
 * @hilbras/sdk — Timeout Policy
 *
 * Wraps requests with a timeout using AbortSignal.
 */

export interface TimeoutConfig {
  /** Request timeout in ms (default: 60_000) */
  requestTimeoutMs: number;
  /** Stream idle timeout in ms — max time without new chunks (default: 120_000) */
  streamIdleTimeoutMs: number;
}

const DEFAULT_TIMEOUT: TimeoutConfig = {
  requestTimeoutMs: 60_000,
  streamIdleTimeoutMs: 120_000,
};

export function createTimeoutSignal(config?: Partial<TimeoutConfig>, parentSignal?: AbortSignal): AbortSignal {
  const cfg = { ...DEFAULT_TIMEOUT, ...config };
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        controller.abort();
      }, { once: true });
    }
  }

  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}
