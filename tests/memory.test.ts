import { describe, it, expect, vi } from "vitest";
import { Memory } from "../src/features/memory/index.js";

describe("Memory", () => {
  it("adds entries", () => {
    const mem = new Memory({ maxTokens: 1000 });
    mem.add("Hello world");
    expect(mem.getEntries()).toHaveLength(1);
  });

  it("builds context with system prompt", () => {
    const mem = new Memory({ maxTokens: 1000, systemPrompt: "Be helpful." });
    mem.add("User prefers dark mode");
    const ctx = mem.buildContext([{ role: "user", content: "Hi" }]);
    expect(ctx[0]).toEqual({ role: "system", content: "Be helpful." });
    expect(ctx).toContainEqual({ role: "user", content: "User prefers dark mode" });
    expect(ctx).toContainEqual({ role: "user", content: "Hi" });
  });

  it("evicts oldest entries when budget exceeded (sliding)", () => {
    const mem = new Memory({ maxTokens: 50, tokenEstimator: (t) => t.length });
    mem.add("short");       // 5 tokens
    mem.add("another msg"); // 11 tokens
    mem.add("yet another"); // 11 tokens
    mem.add("and one more"); // 12 tokens
    mem.add("final message"); // 13 tokens — should trigger eviction
    const entries = mem.getEntries();
    const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(50);
  });

  it("reports stats", () => {
    const mem = new Memory({ maxTokens: 100 });
    mem.add("test");
    const stats = mem.getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.maxTokens).toBe(100);
    expect(stats.utilization).toBeGreaterThan(0);
  });

  it("removes entry by id", () => {
    const mem = new Memory({ maxTokens: 1000 });
    const entry = mem.add("test");
    expect(mem.remove(entry.id)).toBe(true);
    expect(mem.getEntries()).toHaveLength(0);
  });

  it("searches entries", () => {
    const mem = new Memory({ maxTokens: 1000 });
    mem.add("dark mode preference");
    mem.add("building a SaaS");
    const results = mem.search("dark");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("dark mode preference");
  });

  it("clears all entries", () => {
    const mem = new Memory({ maxTokens: 1000 });
    mem.add("a");
    mem.add("b");
    mem.clear();
    expect(mem.getEntries()).toHaveLength(0);
  });

  it("calls onEvict callback", () => {
    const onEvict = vi.fn();
    const mem = new Memory({ maxTokens: 10, tokenEstimator: (t) => t.length, onEvict });
    mem.add("first message");
    mem.add("second message");
    mem.add("third message which is longer");
    expect(onEvict).toHaveBeenCalled();
  });

  it("priority strategy evicts lowest priority first", () => {
    const mem = new Memory({
      maxTokens: 20,
      strategy: "priority",
      tokenEstimator: (t) => t.length,
      priorityFn: (e) => (e.content.includes("KEEP") ? 10 : 1),
    });
    mem.add("KEEP this one");
    mem.add("discard this");
    mem.add("discard that also here longer");
    const entries = mem.getEntries();
    const hasImportant = entries.some((e) => e.content.includes("KEEP"));
    expect(hasImportant).toBe(true);
  });

  it("builds context with additional messages", () => {
    const mem = new Memory({ maxTokens: 1000 });
    mem.add("past context");
    const ctx = mem.buildContext([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);
    expect(ctx).toContainEqual({ role: "user", content: "Hello" });
    expect(ctx).toContainEqual({ role: "assistant", content: "Hi!" });
  });
});
// trigger CI
