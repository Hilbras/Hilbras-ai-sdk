// @vitest-environment jsdom
/**
 * @hilbras/sdk — React hook unmount abort (E3)
 *
 * The one piece of the 3.8.0 work that could not be verified: the hooks aborted
 * in-flight streams on unmount, but `useEffect` cleanup needs a component
 * lifecycle and a DOM. jsdom is a devDependency now, so this asserts it for
 * real rather than by inspection.
 *
 * No JSX: vitest's `include` covers `tests/**\/*.test.ts`, not `.tsx`, so the
 * element is built with `createElement`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "../../src/frameworks/react/use-chat.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch whose body never completes, so the request stays in flight. */
function stubHangingFetch(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return Promise.resolve(
      new Response(new ReadableStream<Uint8Array>({ start() { /* never closes */ } }), { status: 200 }),
    );
  }));
  return signals;
}

describe("react useChat unmount abort", () => {
  it("aborts the in-flight stream when the component unmounts", async () => {
    const signals = stubHangingFetch();
    let chat: ReturnType<typeof useChat> | undefined;

    function Probe() {
      chat = useChat({ api: "/api/chat", provider: "openai", model: "gpt-4o" });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });

    await act(async () => {
      void chat!.append({ role: "user", content: "hi" });
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    await act(async () => {
      root.unmount();
    });

    expect(signals[0].aborted).toBe(true);
  });

  it("leaves a completed stream alone", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: {\"type\":\"message_start\"}\n\n"));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        }), { status: 200 }),
      );
    }));

    let chat: ReturnType<typeof useChat> | undefined;
    function Probe() {
      chat = useChat({ api: "/api/chat", provider: "openai", model: "gpt-4o" });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await chat!.append({ role: "user", content: "hi" });
    });

    const before = signals[0].aborted;
    await act(async () => {
      root.unmount();
    });

    // Unmounting after completion must not retroactively abort anything new.
    expect(before).toBe(false);
    expect(signals).toHaveLength(1);
  });
});
