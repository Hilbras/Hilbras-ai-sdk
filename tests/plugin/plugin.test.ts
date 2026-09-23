/**
 * @hilbras/sdk — Plugin System Tests
 */

import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "../../src/plugin/registry.js";
import { HilbrasClient } from "../../src/client/client.js";
import type { Plugin } from "../../src/plugin/types.js";

function makePlugin(name: string, overrides?: Partial<Plugin>): Plugin {
  return {
    name,
    version: "1.0.0",
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  it("registers a plugin", async () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin("test-plugin");
    await registry.add(plugin);
    expect(registry.has("test-plugin")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("lists registered plugins", async () => {
    const registry = new PluginRegistry();
    await registry.add(makePlugin("a"), makePlugin("b"), makePlugin("c"));
    expect(registry.list()).toEqual(["a", "b", "c"]);
  });

  it("deduplicates plugins by name (last wins)", async () => {
    const registry = new PluginRegistry();
    const destroy1 = vi.fn();
    const destroy2 = vi.fn();
    await registry.add(makePlugin("dup", { destroy: destroy1 }));
    await registry.add(makePlugin("dup", { destroy: destroy2 }));
    expect(registry.size).toBe(1);
    expect(registry.list()).toEqual(["dup"]);
    // First plugin's destroy was called during replacement
    expect(destroy1).toHaveBeenCalled();
  });

  it("removes a plugin and calls destroy", async () => {
    const registry = new PluginRegistry();
    const destroy = vi.fn();
    await registry.add(makePlugin("removable", { destroy }));
    const removed = await registry.remove("removable");
    expect(removed).toBe(true);
    expect(destroy).toHaveBeenCalled();
    expect(registry.has("removable")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("returns false when removing non-existent plugin", async () => {
    const registry = new PluginRegistry();
    const removed = await registry.remove("ghost");
    expect(removed).toBe(false);
  });

  it("calls setup on all plugins", async () => {
    const registry = new PluginRegistry();
    const setup1 = vi.fn();
    const setup2 = vi.fn();
    await registry.add(makePlugin("p1", { setup: setup1 }), makePlugin("p2", { setup: setup2 }));
    const fakeClient = { use: () => {} } as never;
    await registry.setupAll(fakeClient);
    expect(setup1).toHaveBeenCalledWith(fakeClient);
    expect(setup2).toHaveBeenCalledWith(fakeClient);
  });

  it("swallows setup errors", async () => {
    const registry = new PluginRegistry();
    const badSetup = vi.fn(() => { throw new Error("setup failed"); });
    const goodSetup = vi.fn();
    await registry.add(makePlugin("bad", { setup: badSetup }), makePlugin("good", { setup: goodSetup }));
    // Should not throw
    await registry.setupAll({ use: () => {} } as never);
    expect(goodSetup).toHaveBeenCalled();
  });

  it("client.use sets up only newly registered plugins", async () => {
    const client = new HilbrasClient();
    const setupA = vi.fn();
    const setupB = vi.fn();
    await client.use(makePlugin("a", { setup: setupA }));
    await client.use(makePlugin("b", { setup: setupB }));

    expect(setupA).toHaveBeenCalledTimes(1);
    expect(setupB).toHaveBeenCalledTimes(1);
  });

  it("fires onRequest on all plugins in order", async () => {
    const registry = new PluginRegistry();
    const order: string[] = [];
    await registry.add(
      makePlugin("p1", { onRequest: () => { order.push("p1"); } }),
      makePlugin("p2", { onRequest: () => { order.push("p2"); } }),
    );
    await registry.fireRequest({ requestId: "r1", provider: "test", model: "m", messages: [], timestamp: 0 });
    expect(order).toEqual(["p1", "p2"]);
  });

  it("onRequest throwing aborts the request", async () => {
    const registry = new PluginRegistry();
    await registry.add(makePlugin("blocker", {
      onRequest: () => { throw new Error("blocked"); },
    }));
    await expect(
      registry.fireRequest({ requestId: "r1", provider: "test", model: "m", messages: [], timestamp: 0 }),
    ).rejects.toThrow("blocked");
  });

  it("fires onResponse on all plugins", async () => {
    const registry = new PluginRegistry();
    const cb = vi.fn();
    await registry.add(makePlugin("obs", { onResponse: cb }));
    await registry.fireResponse({ requestId: "r1", provider: "test", model: "m", durationMs: 100, streaming: false });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", durationMs: 100 }));
  });

  it("fires onError on all plugins", async () => {
    const registry = new PluginRegistry();
    const cb = vi.fn();
    await registry.add(makePlugin("err-handler", { onError: cb }));
    const error = new Error("boom");
    await registry.fireError({ requestId: "r1", provider: "test", model: "m", error, durationMs: 50, attempts: 1 });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ error, attempts: 1 }));
  });

  it("swallows onResponse errors", async () => {
    const registry = new PluginRegistry();
    await registry.add(makePlugin("bad-resp", {
      onResponse: () => { throw new Error("oops"); },
    }));
    // Should not throw
    await registry.fireResponse({ requestId: "r1", provider: "test", model: "m", durationMs: 100, streaming: false });
  });

  it("swallows onError errors", async () => {
    const registry = new PluginRegistry();
    await registry.add(makePlugin("bad-err", {
      onError: () => { throw new Error("double fault"); },
    }));
    // Should not throw
    await registry.fireError({ requestId: "r1", provider: "test", model: "m", error: new Error("x"), durationMs: 0, attempts: 1 });
  });

  it("destroyAll clears all plugins", async () => {
    const registry = new PluginRegistry();
    const d1 = vi.fn();
    const d2 = vi.fn();
    await registry.add(makePlugin("a", { destroy: d1 }), makePlugin("b", { destroy: d2 }));
    await registry.destroyAll();
    expect(d1).toHaveBeenCalled();
    expect(d2).toHaveBeenCalled();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});
