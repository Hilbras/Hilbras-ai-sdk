/**
 * @hilbras/sdk — Timeout Policy
 *
 * Wraps requests with a timeout using AbortSignal.
 */

export interface TimeoutConfig {
  /** Request timeout in ms (default: 60_000) */
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT: TimeoutConfig = {
  requestTimeoutMs: 60_000,
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
      // Do not hold the process open for the timeout window: a caller that
      // abandons the scope without calling cancel() would otherwise leave a
      // live timer behind. unref() is Node-only and a no-op elsewhere.
      (timer as unknown as { unref?: () => void }).unref?.();
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

/** Backwards-compatible signal-only timeout API.
 *
 * @deprecated The returned signal carries no way to cancel, so the timer and
 * the parent `abort` listener live until the timeout fires. Use
 * {@link createScopedTimeout} and call its `cancel()` when the attempt
 * completes.
 */
export function createTimeoutSignal(config?: Partial<TimeoutConfig>, parentSignal?: AbortSignal): AbortSignal {
  return createScopedTimeout(config, parentSignal).signal;
}
