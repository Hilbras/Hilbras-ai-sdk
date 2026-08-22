/**
 * @hilbras/sdk — Observability Hooks tests
 *
 * Tests the ClientHooks emitter and verify events are emitted
 * during the client request lifecycle.
 */

import { describe, it, expect, vi } from "vitest";
import { ClientHooks } from "../src/client/hooks.js";
import type { HookEvent, RequestCompletedEvent, RetryEvent } from "../src/types/observability.js";

describe("ClientHooks", () => {
  it("emits events to listeners", () => {
    const hooks = new ClientHooks();
    const events: HookEvent[] = [];
    hooks.on("request.completed", (e) => events.push(e));

    hooks.emit({ type: "request.completed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("request.completed");
  });

  it("returns unsubscribe function from on()", () => {
    const hooks = new ClientHooks();
    const events: HookEvent[] = [];
    const unsub = hooks.on("request.completed", (e) => events.push(e));

    hooks.emit({ type: "request.completed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
    expect(events).toHaveLength(1);

    unsub();
    hooks.emit({ type: "request.completed", requestId: "req_2", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
    expect(events).toHaveLength(1); // Not called after unsub
  });

  it("off() removes specific listener", () => {
    const hooks = new ClientHooks();
    const listener = vi.fn();
    hooks.on("request.failed", listener);
    hooks.off("request.failed", listener);

    hooks.emit({ type: "request.failed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, error: "test" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("removeAll() clears all listeners for an event", () => {
    const hooks = new ClientHooks();
    hooks.on("request.completed", vi.fn());
    hooks.on("request.completed", vi.fn());
    hooks.on("request.failed", vi.fn());

    hooks.removeAll("request.completed");
    expect(hooks.listenerCount("request.completed")).toBe(0);
    expect(hooks.listenerCount("request.failed")).toBe(1);
  });

  it("removeAll() without event clears everything", () => {
    const hooks = new ClientHooks();
    hooks.on("request.completed", vi.fn());
    hooks.on("request.failed", vi.fn());
    hooks.removeAll();
    expect(hooks.totalListeners).toBe(0);
  });

  it("swallows listener errors", () => {
    const hooks = new ClientHooks();
    hooks.on("request.completed", () => { throw new Error("listener error"); });
    // Should not throw
    hooks.emit({ type: "request.completed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
  });

  it("listenerCount returns correct count", () => {
    const hooks = new ClientHooks();
    expect(hooks.listenerCount("request.completed")).toBe(0);
    hooks.on("request.completed", vi.fn());
    hooks.on("request.completed", vi.fn());
    expect(hooks.listenerCount("request.completed")).toBe(2);
    expect(hooks.listenerCount("request.failed")).toBe(0);
  });

  it("totalListeners counts all listeners", () => {
    const hooks = new ClientHooks();
    hooks.on("request.completed", vi.fn());
    hooks.on("request.failed", vi.fn());
    hooks.on("request.completed", vi.fn());
    expect(hooks.totalListeners).toBe(3);
  });

  it("supports multiple listeners on same event", () => {
    const hooks = new ClientHooks();
    const calls: string[] = [];
    hooks.on("request.completed", () => calls.push("a"));
    hooks.on("request.completed", () => calls.push("b"));

    hooks.emit({ type: "request.completed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
    expect(calls).toEqual(["a", "b"]);
  });

  it("different event types don't cross-emit", () => {
    const hooks = new ClientHooks();
    const completedEvents: HookEvent[] = [];
    const failedEvents: HookEvent[] = [];
    hooks.on("request.completed", (e) => completedEvents.push(e));
    hooks.on("request.failed", (e) => failedEvents.push(e));

    hooks.emit({ type: "request.completed", requestId: "req_1", timestamp: 0, provider: "openai", model: "gpt-5.6", durationMs: 100, attempts: 1, structuredOutput: false });
    expect(completedEvents).toHaveLength(1);
    expect(failedEvents).toHaveLength(0);
  });
});
