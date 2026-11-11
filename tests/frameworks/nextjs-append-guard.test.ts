/**
 * @hilbras/sdk — Next.js useChat append guard (E4)
 *
 * `append()` had no in-flight check, unlike the other framework hooks. Two
 * overlapping calls each appended an assistant placeholder, both wrote into
 * the last array slot (interleaving the two responses), and `abortController`
 * was overwritten so only the second request was abortable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../../src/frameworks/nextjs/use-chat.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch whose response body stays open until the test closes it. */
function stubHangingFetch() {
  const pending: Array<() => void> = [];
  const fetchMock = vi.fn(async () =>
    new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        pending.push(() => controller.close());
      },
    }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  /** Close every body opened so far; safe to call more than once. */
  const closeAll = () => {
    for (const close of pending.splice(0)) close();
  };
  return { fetchMock, closeAll };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("nextjs useChat append", () => {
  it("ignores a second append while a request is in flight", async () => {
    const { fetchMock, closeAll } = stubHangingFetch();
    const chat = useChat({ api: "/api/chat" });

    const first = chat.append({ role: "user", content: "one", id: "m1" });
    await tick(10);
    expect(chat.isLoading()).toBe(true);

    await chat.append({ role: "user", content: "two", id: "m2" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chat.messages().filter((message) => message.role === "user")).toHaveLength(1);
    // Exactly one assistant placeholder, not two.
    expect(chat.messages().filter((message) => message.role === "assistant")).toHaveLength(1);

    closeAll();
    await first;
  });

  it("still accepts an append once the previous request finished", async () => {
    const { fetchMock, closeAll } = stubHangingFetch();
    const chat = useChat({ api: "/api/chat" });

    const first = chat.append({ role: "user", content: "one", id: "m1" });
    await tick(10);
    closeAll();
    await first;
    expect(chat.isLoading()).toBe(false);

    const second = chat.append({ role: "user", content: "two", id: "m2" });
    await tick(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    closeAll();
    await second;
  });
});
