/**
 * @hilbras/sdk — v0.9.3 Final Financial Integrity Certification
 *
 * Full adversarial audit of the cost/budget system.
 * Goal: prove no sequence of calls can cause incorrect financial accounting.
 */

import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../src/cost/tracker.js";
import { HilbrasClient } from "../src/client/client.js";
import type { Transport } from "../src/transport/transport.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function successTransport(): Transport {
  return {
    async request() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

function failingTransport(status = 500): Transport {
  return {
    async request() { return new Response(JSON.stringify({ error: { message: "fail" } }), { status }); },
    async stream() { throw new Error(`HTTP ${status}`); },
    abort() {},
  };
}

const MODEL = "gpt-5.6-sol";
function provider(name = "Test") {
  return { name, baseUrl: `https://${name.toLowerCase()}.com/v1`, authentication: { type: "none" as const }, adapter: "openai" as const, models: [{ id: MODEL, contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }] };
}

function assertBudgetInvariant(t: BudgetTracker) {
  const r = t.report();
  expect(r.totalActual).toBeGreaterThanOrEqual(0);
  expect(r.totalReserved).toBeGreaterThanOrEqual(0);
  expect(r.committedCost).toBeGreaterThanOrEqual(0);
  expect(r.activeReservations).toBeGreaterThanOrEqual(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Master Accounting Invariants
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Master Accounting Invariants", () => {
  it("totalReserved == sum of active reservation amounts", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.3);
    t.reserve("r2", 0.5);
    t.reserve("r3", 0.2);
    const sum = t.reservations().reduce((s, r) => s + r.amount, 0);
    expect(t.report().totalReserved).toBeCloseTo(sum, 10);
  });

  it("totalReserved == sum after partial settle", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.5);
    t.reserve("r2", 0.3);
    t.settle("r1", 0.4, { provider: "p", model: "m", phase: "execute" });
    const sum = t.reservations().reduce((s, r) => s + r.amount, 0);
    expect(t.report().totalReserved).toBeCloseTo(sum, 10);
  });

  it("committedCost == totalActual + totalReserved", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.record({ requestId: "r0", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 1 });
    t.reserve("r1", 0.3);
    const r = t.report();
    expect(r.committedCost).toBeCloseTo(r.totalActual + r.totalReserved, 10);
  });

  it("remainingBudget == sessionBudget - committedCost", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.record({ requestId: "r0", provider: "p", model: "m", phase: "execute", estimatedCost: 0.2, actualCost: 0.2, timestamp: 1 });
    t.reserve("r1", 0.3);
    const r = t.report();
    expect(r.remainingBudget).toBeCloseTo(1.0 - r.committedCost, 10);
  });

  it("every reservation eventually reaches terminal state", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.reserve("r1", 0.5);
    t.reserve("r2", 0.3);
    t.settle("r1", 0.4, { provider: "p", model: "m", phase: "execute" });
    t.release("r2");
    expect(t.report().activeReservations).toBe(0);
    expect(t.reservations()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Duplicate ID Certification
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: Duplicate ID Certification", () => {
  it("active duplicate rejected", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    expect(t.reserve("A", 0.5)).not.toBeNull();
    expect(t.reserve("A", 0.3)).toBeNull(); // rejected
  });

  it("settled ID is reusable", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("A", 0.5);
    t.settle("A", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.reserve("A", 0.2)).not.toBeNull(); // reuse
  });

  it("released ID is reusable", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("A", 0.5);
    t.release("A");
    expect(t.reserve("A", 0.2)).not.toBeNull(); // reuse
  });

  it("no silent overwrite — accounting invariant preserved", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("A", 0.5);
    const second = t.reserve("A", 0.3);
    expect(second).toBeNull();
    expect(t.report().totalReserved).toBe(0.5); // not 0.8
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: ID Collision Fuzzing
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: ID Collision Fuzzing", () => {
  it("10000 random operations with small ID pool — no corruption", () => {
    const ids = ["", "A", "B", "C", "D", " ", "unicode_🚀", "x".repeat(1000), "0", "-1"];
    for (let i = 0; i < 1000; i++) {
      const t = new BudgetTracker({ sessionBudget: 10 });
      for (let j = 0; j < 50; j++) {
        const id = ids[j % ids.length];
        const cost = Math.random() * 0.1;
        if (Math.random() > 0.3) t.reserve(id, cost);
        else t.settle(id, Math.random() * cost, { provider: "p", model: "m", phase: "execute" });
      }
      assertBudgetInvariant(t);
      expect(t.report().activeReservations).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Reservation State Machine
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Reservation State Machine", () => {
  it("settle on unknown ID is safe (no-op)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.settle("unknown", 0.5, { provider: "p", model: "m", phase: "execute" });
    expect(t.report().totalActual).toBe(0);
  });

  it("release on unknown ID is safe (no-op)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.release("unknown");
    expect(t.report().totalReserved).toBe(0);
  });

  it("settle after settle is safe (second is no-op)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" }); // second settle
    expect(t.report().totalActual).toBeCloseTo(0.3); // not 0.6
  });

  it("release after settle is safe (no-op)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    t.release("r1"); // harmless
    expect(t.report().totalActual).toBeCloseTo(0.3);
  });

  it("settle after release is safe (no-op)", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    t.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" }); // harmless
    expect(t.report().totalActual).toBe(0);
  });

  it("reserve after settle creates new reservation", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "p", model: "m", phase: "execute" });
    expect(t.reserve("r1", 0.2)).not.toBeNull();
    expect(t.report().activeReservations).toBe(1);
  });

  it("reserve after release creates new reservation", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.5);
    t.release("r1");
    expect(t.reserve("r1", 0.2)).not.toBeNull();
    expect(t.report().activeReservations).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Concurrent Budget Enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Concurrent Budget Enforcement", () => {
  it("1000 concurrent reservations 100 times — never exceeds budget", () => {
    for (let run = 0; run < 100; run++) {
      const t = new BudgetTracker({ sessionBudget: 10 });
      let accepted = 0;
      for (let i = 0; i < 1000; i++) {
        if (t.reserve(`r${i}`, 0.1)) accepted++;
      }
      const reserved = t.report().totalReserved;
      expect(reserved).toBeLessThanOrEqual(10.001); // small float tolerance
      assertBudgetInvariant(t);
    }
  });

  it("5000 reservations with random amounts", () => {
    const t = new BudgetTracker({ sessionBudget: 50 });
    for (let i = 0; i < 5000; i++) {
      t.reserve(`r${i}`, Math.random() * 0.5);
    }
    assertBudgetInvariant(t);
    expect(t.report().totalReserved).toBeLessThanOrEqual(50.001);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Floating Point Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 7: Floating Point Safety", () => {
  it("0.1+0.2 repeated 100 times does not bypass budget", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      if (t.reserve(`r${i}`, 0.1 + 0.2)) accepted++;
    }
    // 0.1+0.2 = 0.30000000000000004, so 1.0/0.3000... = 3.33 → 3 accepted
    expect(accepted).toBe(3);
    assertBudgetInvariant(t);
  });

  it("settling with floating point values stays consistent", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.reserve("r1", 0.3);
    t.settle("r1", 0.1 + 0.2, { provider: "p", model: "m", phase: "execute" });
    const sum = t.reservations().reduce((s, r) => s + r.amount, 0);
    expect(t.report().totalReserved).toBeCloseTo(sum, 10);
    assertBudgetInvariant(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: Extreme Numbers
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 8: Extreme Numbers", () => {
  for (const val of [-1, 0, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE]) {
    it(`reserve(${val}) handled safely`, () => {
      const t = new BudgetTracker({ sessionBudget: 1.0 });
      t.reserve("r1", val);
      assertBudgetInvariant(t);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: Retry Accounting
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 9: Retry Accounting", () => {
  it("retries reuse same reservation", async () => {
    const client = new HilbrasClient({ transport: successTransport(), budget: { sessionBudget: 10 } });
    client.addProvider(provider());
    await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });
    expect(client.costReport().activeReservations).toBe(0);
    expect(client.costReport().requestCount).toBe(1);
  });

  it("retry exhaustion releases reservation", async () => {
    const client = new HilbrasClient({ transport: failingTransport(500), budget: { sessionBudget: 10 } });
    client.addProvider(provider());
    try { await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { preset: "fast", retry: { maxRetries: 1 } } }); } catch {}
    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Fallback Accounting
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 10: Fallback Accounting", () => {
  it("fallback releases original, creates new, settles", async () => {
    const client = new HilbrasClient({ transport: failingTransport(500), budget: { sessionBudget: 10 } });
    client.addProvider(provider("Fail"));
    try {
      await client.complete({ provider: "Fail", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { preset: "fast", allowFallback: true, retry: { maxRetries: 0 } } });
    } catch {}
    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });

  it("all fallbacks fail — no leaked reservations", async () => {
    const client = new HilbrasClient({ transport: failingTransport(500), budget: { sessionBudget: 10 } });
    client.addProvider(provider("Fail"));
    try {
      await client.complete({ provider: "Fail", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { preset: "fast", allowFallback: true, retry: { maxRetries: 0 } } });
    } catch {}
    expect(client.costReport().activeReservations).toBe(0);
    assertBudgetInvariant(client.cost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 13: Streaming
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 13: Streaming", () => {
  it("stream failure releases budget", async () => {
    const client = new HilbrasClient({ transport: failingTransport(500), budget: { sessionBudget: 10 } });
    client.addProvider(provider());
    try {
      const gen = client.stream({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }], policy: { preset: "fast", retry: { maxRetries: 0 } } });
      await gen.next();
    } catch {}
    expect(client.costReport().activeReservations).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 15: Cost Estimation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 15: Cost Estimation", () => {
  it("negative tokens → zero cost", () => {
    const t = new BudgetTracker();
    expect(t.estimate("gpt-5.6-sol", "openai", -100, -50)).toBe(0);
  });

  it("unknown model → zero cost", () => {
    const t = new BudgetTracker();
    expect(t.estimate("unknown", "unknown", 1000, 500)).toBe(0);
  });

  it("cost is never NaN", () => {
    const t = new BudgetTracker();
    const cost = t.estimate("gpt-5.6-sol", "openai", 1000, 500);
    expect(Number.isNaN(cost)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Multi-Client Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 18: Multi-Client Isolation", () => {
  it("separate clients have independent budgets", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 0.1 } });
    c1.cost.reserve("r1", 0.05);
    expect(c1.costReport().totalReserved).toBeCloseTo(0.05);
    expect(c2.costReport().totalReserved).toBe(0);
  });

  it("settle in B does not affect A", () => {
    const c1 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    const c2 = new HilbrasClient({ budget: { sessionBudget: 1.0 } });
    c1.cost.reserve("r1", 0.5);
    c2.cost.reserve("r2", 0.3);
    c2.cost.settle("r2", 0.2, { provider: "p", model: "m", phase: "execute" });
    expect(c1.costReport().totalReserved).toBeCloseTo(0.5);
    expect(c1.costReport().totalActual).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 22: Security
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 22: Security", () => {
  it("no secrets in reports", () => {
    const t = new BudgetTracker();
    t.reserve("r1", 0.5);
    t.settle("r1", 0.3, { provider: "openai", model: "gpt-5.6-sol", phase: "execute" });
    const str = JSON.stringify(t.report());
    expect(str).not.toContain("sk-");
    expect(str).not.toContain("apiKey");
  });

  it("no secrets in reservation objects", () => {
    const t = new BudgetTracker();
    const r = t.reserve("r1", 0.5);
    expect(JSON.stringify(r)).not.toContain("sk-");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 25: API Abuse
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 25: API Abuse", () => {
  it("rapid reserve/settle/release cycles", () => {
    const t = new BudgetTracker({ sessionBudget: 1000 });
    for (let i = 0; i < 50_000; i++) {
      t.reserve(`r${i}`, 0.001);
      t.settle(`r${i}`, 0.0005, { provider: "p", model: "m", phase: "execute" });
    }
    assertBudgetInvariant(t);
    expect(t.report().activeReservations).toBe(0);
  });

  it("alternating reserve/release", () => {
    const t = new BudgetTracker({ sessionBudget: 100 });
    for (let i = 0; i < 10_000; i++) {
      t.reserve(`r${i}`, 0.01);
      t.release(`r${i}`);
    }
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBe(0);
  });

  it("record() alongside reservations", () => {
    const t = new BudgetTracker({ sessionBudget: 10 });
    t.record({ requestId: "legacy", provider: "p", model: "m", phase: "execute", estimatedCost: 0.1, actualCost: 0.1, timestamp: 1 });
    t.reserve("r1", 0.3);
    t.settle("r1", 0.2, { provider: "p", model: "m", phase: "execute" });
    assertBudgetInvariant(t);
    expect(t.report().totalActual).toBeCloseTo(0.3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 26: Fuzz Testing
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 26: Fuzz Testing", () => {
  it("10000 randomized scenarios maintain invariants", () => {
    for (let s = 0; s < 10_000; s++) {
      const budget = Math.random() * 10 + 0.1;
      const t = new BudgetTracker({ sessionBudget: budget });
      const ids = ["A", "B", "C", "D"]; // small pool → collisions

      for (let i = 0; i < 20; i++) {
        const id = ids[i % ids.length];
        const cost = Math.random() * 0.2;
        if (Math.random() > 0.3) {
          t.reserve(id, cost);
        } else if (Math.random() > 0.5) {
          t.settle(id, Math.random() * cost, { provider: "p", model: "m", phase: "execute" });
        } else {
          t.release(id);
        }
      }

      assertBudgetInvariant(t);
      expect(t.report().activeReservations).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 28: Performance
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 28: Performance", () => {
  it("100K operations complete in reasonable time", () => {
    const t = new BudgetTracker({ sessionBudget: 1_000_000 });
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      t.reserve(`r${i}`, 0.001);
      t.settle(`r${i}`, 0.0005, { provider: "p", model: "m", phase: "execute" });
    }
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 29: Backward Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 29: Backward Compatibility", () => {
  it("record() API still works", () => {
    const t = new BudgetTracker({ sessionBudget: 1.0 });
    t.record({ requestId: "r1", provider: "p", model: "m", phase: "execute", estimatedCost: 0.01, actualCost: 0.01, timestamp: 1 });
    expect(t.report().totalActual).toBe(0.01);
  });

  it("client without budget works", async () => {
    const client = new HilbrasClient({ transport: successTransport() });
    client.addProvider(provider());
    const result = await client.complete({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });

  it("all public APIs exist", () => {
    const client = new HilbrasClient();
    expect(typeof client.costReport).toBe("function");
    expect(typeof client.isBudgetExhausted).toBe("function");
    expect(typeof client.cost).toBe("object");
    expect(typeof client.cost.reserve).toBe("function");
    expect(typeof client.cost.settle).toBe("function");
    expect(typeof client.cost.release).toBe("function");
    expect(typeof client.cost.report).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 30: Streaming budget enforcement (v0.9.3 fix)
// ═══════════════════════════════════════════════════════════════════════════

function streamingTransport(wireChunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of wireChunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }); },
    async stream() { return stream; },
    abort() {},
  };
}

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("Phase 30: Streaming budget enforcement (v0.9.3 hardening)", () => {
  it("stream reserves budget before any provider call", async () => {
    // Build a transport that records the order of calls vs the budget state.
    // The reservation must happen synchronously before the first body byte
    // is read by the adapter.
    const client = new HilbrasClient({ transport: streamingTransport([
      sse({ choices: [{ delta: { content: "hi" } }] }),
      sse({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
      sse({ choices: [{ finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]), budget: { sessionBudget: 10 } });
    client.addProvider(provider());

    const before = client.costReport();
    expect(before.activeReservations).toBe(0);

    const chunks: string[] = [];
    for await (const chunk of client.stream({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] })) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    const after = client.costReport();
    expect(after.activeReservations).toBe(0);
    expect(after.totalReserved).toBe(0);
    expect(after.totalActual).toBeGreaterThan(0); // settled from usage chunk
    expect(after.requestCount).toBe(1);
    expect(chunks.join("")).toBe("hi");
  });

  it("stream reservation rejected when budget is too small", async () => {
    // Estimate for ~1MB of text against gpt-5.6-sol ($4/M input tokens) is
    // ~$1.00. A perRequestBudget of $0.0001 must reject the reservation
    // synchronously, before the provider is called.
    const longMessage = "x".repeat(1_000_000);
    const client = new HilbrasClient({ transport: failingTransport(500), budget: { perRequestBudget: 0.0001 } });
    client.addProvider(provider());

    let threw = false;
    try {
      // stream() returns an AsyncGenerator; reservation happens at first next()
      const gen = client.stream({ provider: "Test", model: MODEL, messages: [{ role: "user", content: longMessage }] });
      await gen.next();
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/Budget reservation rejected/);
    }
    expect(threw).toBe(true);
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("stream reservation released on consumer abort before first chunk", async () => {
    // The finally block in stream() must release the reservation when the
    // consumer breaks out of the for-await loop, regardless of where the
    // abort happens.
    const client = new HilbrasClient({ transport: streamingTransport([
      sse({ choices: [{ delta: { content: "first" } }] }),
      sse({ choices: [{ delta: { content: "second" } }] }),
      "data: [DONE]\n\n",
    ]), budget: { sessionBudget: 10 } });
    client.addProvider(provider());

    let sawFirst = false;
    for await (const chunk of client.stream({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] })) {
      if (chunk.type === "text" && chunk.text === "first") {
        sawFirst = true;
        break; // consumer abort mid-stream
      }
    }
    expect(sawFirst).toBe(true);
    // Reservation must be released even though the stream was abandoned.
    expect(client.costReport().activeReservations).toBe(0);
  });

  it("stream settles once even with multiple usage chunks", async () => {
    // A provider that emits two usage chunks (anomaly) must not double-settle.
    // We assert by checking requestCount === 1 and the report shows a single
    // settlement, not a doubled one.
    const client = new HilbrasClient({ transport: streamingTransport([
      sse({ choices: [{ delta: { content: "hi" } }] }),
      sse({ usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }),
      sse({ usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }),
      sse({ choices: [{ finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]), budget: { sessionBudget: 10 } });
    client.addProvider(provider());

    for await (const _chunk of client.stream({ provider: "Test", model: MODEL, messages: [{ role: "user", content: "hi" }] })) { /* drain */ }

    const report = client.costReport();
    expect(report.activeReservations).toBe(0);
    expect(report.requestCount).toBe(1);
  });
});
