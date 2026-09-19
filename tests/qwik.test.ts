import { describe, it, expect } from "vitest";
import { useSignal } from "../src/frameworks/qwik/signal-shim.js";
import { useChat } from "../src/frameworks/qwik/use-chat.js";
import { useCompletion } from "../src/frameworks/qwik/use-completion.js";

// ─── useSignal ─────────────────────────────────────────────────────────────

describe("useSignal", () => {
  it("returns initial value", () => {
    const signal = useSignal(42);
    expect(signal()).toBe(42);
  });

  it("updates via value property", () => {
    const signal = useSignal("hello");
    signal.value = "world";
    expect(signal()).toBe("world");
  });

  it("handles objects", () => {
    const signal = useSignal({ count: 0 });
    signal.value = { count: 1 };
    expect(signal().count).toBe(1);
  });
});

// ─── useChat ───────────────────────────────────────────────────────────────

describe("useChat", () => {
  it("initializes with empty messages", () => {
    const chat = useChat();
    expect(chat.messages()).toEqual([]);
    expect(chat.isLoading()).toBe(false);
    expect(chat.error()).toBeNull();
  });

  it("initializes with provided messages", () => {
    const initial = [{ role: "user" as const, content: "Hi" }];
    const chat = useChat({ initialMessages: initial });
    expect(chat.messages()).toHaveLength(1);
    expect(chat.messages()[0].content).toBe("Hi");
  });

  it("clears messages", () => {
    const chat = useChat({ initialMessages: [{ role: "user", content: "Hi" }] });
    chat.clear();
    expect(chat.messages()).toEqual([]);
  });

  it("setMessages updates messages", () => {
    const chat = useChat();
    chat.setMessages([{ role: "assistant", content: "Hello" }]);
    expect(chat.messages()).toHaveLength(1);
  });
});

// ─── useCompletion ─────────────────────────────────────────────────────────

describe("useCompletion", () => {
  it("initializes with empty state", () => {
    const comp = useCompletion();
    expect(comp.completion()).toBe("");
    expect(comp.isLoading()).toBe(false);
    expect(comp.error()).toBeNull();
  });

  it("setCompletion updates value", () => {
    const comp = useCompletion();
    comp.setCompletion("hello");
    expect(comp.completion()).toBe("hello");
  });
});
