import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep } from "../../src/reliability/backoff.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("abort-aware backoff", () => {
  it("rejects promptly when the caller cancels during backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = sleep(1_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the existing timer behavior without a signal", async () => {
    vi.useFakeTimers();
    const pending = sleep(10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeUndefined();
  });
});
