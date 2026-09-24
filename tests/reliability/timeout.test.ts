import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedTimeout, createTimeoutSignal } from "../../src/reliability/timeout.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("scoped execution timeout", () => {
  it("marks a timeout separately from caller cancellation", () => {
    vi.useFakeTimers();
    const timeout = createScopedTimeout({ requestTimeoutMs: 10 });

    expect(timeout.signal.aborted).toBe(false);
    vi.advanceTimersByTime(9);
    expect(timeout.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.timedOut).toBe(true);
  });

  it("propagates parent cancellation without marking it as a timeout", () => {
    const parent = new AbortController();
    const timeout = createScopedTimeout({ requestTimeoutMs: 10_000 }, parent.signal);
    parent.abort();

    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.timedOut).toBe(false);
  });

  it("cancels its timer and listener on explicit cleanup", () => {
    vi.useFakeTimers();
    const timeout = createScopedTimeout({ requestTimeoutMs: 10 });
    timeout.cancel();
    vi.advanceTimersByTime(10);

    expect(timeout.signal.aborted).toBe(false);
  });

  it("keeps the existing public timeout signal contract", () => {
    vi.useFakeTimers();
    const signal = createTimeoutSignal({ requestTimeoutMs: 5 });
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(5);
    expect(signal.aborted).toBe(true);
  });
});
