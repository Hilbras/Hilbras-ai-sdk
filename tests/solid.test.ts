import { describe, it, expect } from "vitest";
import { createSignal } from "../src/frameworks/solid/solid-shim.js";
import { useChat } from "../src/frameworks/solid/use-chat.js";
import { useCompletion } from "../src/frameworks/solid/use-completion.js";
import { useObject } from "../src/frameworks/solid/use-object.js";

// ─── Solid Signal Shim ─────────────────────────────────────────────────────

describe("createSignal", () => {
  it("returns initial value", () => {
    const [value] = createSignal(42);
    expect(value()).toBe(42);
  });

  it("sets value", () => {
    const [value, setValue] = createSignal("hello");
    setValue("world");
    expect(value()).toBe("world");
  });

  it("sets with function updater", () => {
    const [count, setCount] = createSignal(0);
    setCount((prev) => prev + 1);
    setCount((prev) => prev + 1);
    expect(count()).toBe(2);
  });

  it("handles object values", () => {
    const [state, setState] = createSignal({ x: 1 });
    setState({ x: 2 });
    expect(state().x).toBe(2);
  });

  it("sets with function updater on objects", () => {
    const [state, setState] = createSignal({ count: 0 });
    setState((prev) => ({ count: prev.count + 1 }));
    expect(state().count).toBe(1);
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

  it("setMessages with function updater", () => {
    const chat = useChat({ initialMessages: [{ role: "user", content: "Hi" }] });
    chat.setMessages((prev) => [...prev, { role: "assistant", content: "Hello" }]);
    expect(chat.messages()).toHaveLength(2);
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

  it("setCompletion with function updater", () => {
    const comp = useCompletion();
    comp.setCompletion("hello");
    comp.setCompletion((prev) => prev + " world");
    expect(comp.completion()).toBe("hello world");
  });
});

// ─── useObject ─────────────────────────────────────────────────────────────

describe("useObject", () => {
  it("initializes with null", () => {
    const obj = useObject<{ name: string }>();
    expect(obj.object()).toBeNull();
    expect(obj.isLoading()).toBe(false);
    expect(obj.error()).toBeNull();
  });

  it("setObject updates value", () => {
    const obj = useObject<{ name: string }>();
    obj.setObject({ name: "test" });
    expect(obj.object()).toEqual({ name: "test" });
  });

  it("setObject with function updater", () => {
    const obj = useObject<{ count: number }>();
    obj.setObject({ count: 0 });
    obj.setObject((prev) => ({ count: (prev?.count ?? 0) + 1 }));
    expect(obj.object()?.count).toBe(1);
  });
});
