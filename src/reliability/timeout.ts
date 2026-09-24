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

export interface ScopedTimeout {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  /** Clear the timer and parent listener without aborting the signal. */
  cancel(): void;
}

/**
 * Create an internal timeout scope that can distinguish an internal timeout
 * from caller cancellation and can be cleaned up when an attempt completes.
 */
export function createScopedTimeout(
  config?: Partial<TimeoutConfig>,
  parentSignal?: AbortSignal,
): ScopedTimeout {
  const cfg = { ...DEFAULT_TIMEOUT, ...config };
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let parentListener: (() => void) | undefined;
  let cleaned = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== undefined) clearTimeout(timer);
    if (parentSignal && parentListener) parentSignal.removeEventListener("abort", parentListener);
  };

  const onParentAbort = (): void => {
    cleanup();
    if (!controller.signal.aborted) controller.abort();
  };

  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    if (parentSignal) {
      parentListener = onParentAbort;
      parentSignal.addEventListener("abort", parentListener, { once: true });
      // Close the race where cancellation happens between the check and listener registration.
      if (parentSignal.aborted) onParentAbort();
    }
    if (!controller.signal.aborted) {
      timer = setTimeout(() => {
        if (!controller.signal.aborted) {
          timedOut = true;
          controller.abort();
        }
        cleanup();
      }, cfg.requestTimeoutMs);
    }
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cancel: cleanup,
  };
}

/** Backwards-compatible signal-only timeout API. */
export function createTimeoutSignal(config?: Partial<TimeoutConfig>, parentSignal?: AbortSignal): AbortSignal {
  return createScopedTimeout(config, parentSignal).signal;
}
