// @vitest-environment jsdom
/**
 * @hilbras/sdk — Vue composable unmount abort (E3)
 *
 * The Vue half of the unmount wiring. `onUnmounted` needs a component instance
 * and a DOM, which is why this was previously only checked by inspection.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { useChat } from "../../src/frameworks/vue/use-chat.js";

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

describe("vue useChat unmount abort", () => {
  it("aborts the in-flight stream when the component unmounts", async () => {
    const signals = stubHangingFetch();
    let chat: ReturnType<typeof useChat> | undefined;

    const app = createApp(defineComponent({
      setup() {
        chat = useChat({ api: "/api/chat", provider: "openai", model: "gpt-4o" });
        return () => h("div");
      },
    }));
    app.mount(document.createElement("div"));

    void chat!.append({ role: "user", content: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    app.unmount();

    expect(signals[0].aborted).toBe(true);
  });
});
