import { describe, it, expect } from "vitest";
import { DevTools } from "../src/index.js";

describe("DevTools", () => {
  it("can be instantiated with defaults", () => {
    const devtools = new DevTools();
    expect(devtools).toBeDefined();
    expect(devtools.getHistory()).toEqual([]);
  });

  it("can be instantiated with custom config", () => {
    const devtools = new DevTools({
      logLevel: "verbose",
      maxHistory: 50,
      console: false,
    });
    expect(devtools).toBeDefined();
  });

  it("getMetrics returns empty metrics initially", () => {
    const devtools = new DevTools();
    const metrics = devtools.getMetrics();
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.totalCost).toBe(0);
  });

  it("clear resets history", () => {
    const devtools = new DevTools();
    devtools.onRequestStart({ requestId: "1", provider: "openai", model: "gpt-4o" });
    devtools.onRequestComplete({ requestId: "1", output: "hello", usage: { input: 10, output: 5, total: 15 } });
    expect(devtools.getHistory()).toHaveLength(1);
    devtools.clear();
    expect(devtools.getHistory()).toHaveLength(0);
  });

  it("export returns valid JSON", () => {
    const devtools = new DevTools();
    devtools.onRequestStart({ requestId: "1", provider: "openai", model: "gpt-4o" });
    devtools.onRequestComplete({ requestId: "1", output: "hello", usage: { input: 10, output: 5, total: 15 } });
    const json = devtools.export();
    const parsed = JSON.parse(json);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.metrics.totalRequests).toBe(1);
  });

  it("tracks metrics correctly", () => {
    const devtools = new DevTools({ console: false });

    devtools.onRequestStart({ requestId: "1", provider: "openai", model: "gpt-4o" });
    devtools.onRequestComplete({
      requestId: "1",
      provider: "openai",
      model: "gpt-4o",
      output: "hello",
      usage: { input: 10, output: 5, total: 15 },
      cost: 0.001,
    });

    devtools.onRequestStart({ requestId: "2", provider: "anthropic", model: "claude-sonnet-5" });
    devtools.onRequestComplete({
      requestId: "2",
      provider: "anthropic",
      model: "claude-sonnet-5",
      output: "world",
      usage: { input: 20, output: 10, total: 30 },
      cost: 0.002,
    });

    const metrics = devtools.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.totalTokens).toBe(45);
    expect(metrics.totalCost).toBeCloseTo(0.003);
    expect(metrics.byProvider["openai"].requests).toBe(1);
    expect(metrics.byProvider["anthropic"].requests).toBe(1);
  });

  it("tracks errors correctly", () => {
    const devtools = new DevTools({ console: false });

    devtools.onRequestStart({ requestId: "1", provider: "openai", model: "gpt-4o" });
    devtools.onRequestComplete({ requestId: "1", error: "Rate limited" });

    const metrics = devtools.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.failedRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(0);
  });
});
