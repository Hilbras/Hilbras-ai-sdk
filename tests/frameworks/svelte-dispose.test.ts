/**
 * @hilbras/sdk — Svelte hook stream disposal (E3)
 *
 * The framework hooks kept an in-flight stream running after the component
 * went away, writing into state nothing renders any more. React and Vue now
 * abort from their own unmount lifecycles; the Svelte hook imports nothing
 * from `svelte` (it must stay loadable without the peer dependency), so it
 * exposes `dispose()` for `onDestroy` instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../../src/frameworks/svelte/use-chat.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch whose body rejects with AbortError when its signal fires. */
function stubAbortableFetch() {
  const signals: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    signals.push(signal);
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener("abort", () => {
          try {
            controller.error(new DOMException("The operation was aborted", "AbortError"));
          } catch {
            // Already closed.
          }
        });
      },
    }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, signals };
}

describe("svelte useChat dispose", () => {
  it("aborts the in-flight stream", async () => {
    const { signals } = stubAbortableFetch();
    const chat = useChat({ api: "/api/chat", provider: "openai", model: "gpt-4o" });

    const pending = chat.append({ role: "user", content: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(chat.isLoading).toBe(true);

    chat.dispose();

    expect(signals[0]?.aborted).toBe(true);
    expect(chat.isLoading).toBe(false);

    await pending;
  });

  it("is safe to call with nothing in flight", () => {
    const chat = useChat({ api: "/api/chat", provider: "openai", model: "gpt-4o" });

    expect(() => chat.dispose()).not.toThrow();
    expect(chat.isLoading).toBe(false);
  });
});
