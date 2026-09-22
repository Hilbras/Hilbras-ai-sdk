/**
 * @hilbras/sdk — SLA Monitor Tests
 */

import { describe, it, expect, vi } from "vitest";
import { SLAMonitor } from "../../src/telemetry/sla.js";
import { HilbrasClient } from "../../src/client/client.js";
import type { Transport } from "../../src/transport/transport.js";
import type { ProviderConfig } from "../../src/types/providers.js";

function successTransport(): Transport {
  return {
    async request() {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
    async stream() {
      throw new Error("unused");
    },
    abort() {},
  };
}

function makeProvider(): ProviderConfig {
  return {
    name: "Test",
    baseUrl: "https://test.com/v1",
    authentication: { type: "none" },
    adapter: "openai",
    models: [{
      id: "gpt-4o",
      contextWindow: 128_000,
      capabilities: {
        streaming: true, tools: true, vision: false, reasoning: false,
        structuredOutput: true, parallelTools: false, systemPrompts: true,
      },
    }],
  };
}

describe("SLAMonitor", () => {
  it("reports compliance when no requests exist", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const monitor = new SLAMonitor(client, [
      { name: "latency", metric: "latency_p95", threshold: 2000, windowMs: 60_000 },
    ]);

    const report = monitor.report();
    expect(report.allCompliant).toBe(true);
    expect(report.slas).toHaveLength(1);
    expect(report.slas[0].name).toBe("latency");
    // No records means latency defaults to 0, which is under threshold
    expect(report.slas[0].compliant).toBe(true);

    monitor.dispose();
    client.dispose();
  });

  it("tracks requests and checks latency SLA", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const breachCb = vi.fn();
    const monitor = new SLAMonitor(client, [
      { name: "p95 latency", metric: "latency_p95", threshold: 10_000, windowMs: 60_000, alertOnBreach: breachCb },
    ]);

    // Make some fast requests
    for (let i = 0; i < 5; i++) {
      await client.complete({
        provider: "Test",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      });
    }

    const report = monitor.report();
    expect(report.slas[0].compliant).toBe(true);
    expect(report.slas[0].currentValue).toBeGreaterThanOrEqual(0);

    monitor.dispose();
    client.dispose();
  });

  it("detects error rate SLA breaches", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const breachCb = vi.fn();
    const monitor = new SLAMonitor(client, [
      { name: "error rate", metric: "error_rate", threshold: 0.1, windowMs: 60_000, alertOnBreach: breachCb },
    ]);

    // Manually record some failures
    monitor.record(100, true);
    monitor.record(100, true);
    monitor.record(100, false); // 1/3 = 33% error rate, above 10% threshold

    const report = monitor.report();
    expect(report.slas[0].compliant).toBe(false);
    expect(report.slas[0].currentValue).toBeCloseTo(0.333, 2);

    monitor.dispose();
    client.dispose();
  });

  it("detects availability SLA breaches", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const breachCb = vi.fn();
    const monitor = new SLAMonitor(client, [
      { name: "availability", metric: "availability", threshold: 0.99, windowMs: 60_000, alertOnBreach: breachCb },
    ]);

    // 99 successes, 2 failures = 98% availability, below 99%
    for (let i = 0; i < 99; i++) monitor.record(10, true);
    for (let i = 0; i < 2; i++) monitor.record(10, false);

    const report = monitor.report();
    expect(report.slas[0].compliant).toBe(false);
    expect(report.allCompliant).toBe(false);

    monitor.dispose();
    client.dispose();
  });

  it("fires breach alert callback", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const breachCb = vi.fn();
    const monitor = new SLAMonitor(client, [
      { name: "error rate", metric: "error_rate", threshold: 0.1, windowMs: 60_000, alertOnBreach: breachCb },
    ]);

    // Record failures to breach SLA
    monitor.record(100, true);
    monitor.record(100, false); // 50% error rate

    // The breach callback should have been called
    expect(breachCb).toHaveBeenCalledOnce();
    expect(breachCb).toHaveBeenCalledWith(
      expect.objectContaining({ sla: "error rate", metric: "error_rate" }),
    );

    monitor.dispose();
    client.dispose();
  });

  it("does not re-breach within the same window", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const breachCb = vi.fn();
    const monitor = new SLAMonitor(client, [
      { name: "error rate", metric: "error_rate", threshold: 0.1, windowMs: 60_000, alertOnBreach: breachCb },
    ]);

    monitor.record(100, true);
    monitor.record(100, false); // Breach
    monitor.record(100, false); // Still breached, but no re-alert

    expect(breachCb).toHaveBeenCalledOnce();

    monitor.dispose();
    client.dispose();
  });

  it("dispose cleans up subscriptions", () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(makeProvider());

    const monitor = new SLAMonitor(client, [
      { name: "latency", metric: "latency_p95", threshold: 2000, windowMs: 60_000 },
    ]);

    monitor.dispose();
    // Should not throw after dispose
    expect(monitor.report()).toBeDefined();

    client.dispose();
  });
});
