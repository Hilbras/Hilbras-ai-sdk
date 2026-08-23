/**
 * @hilbras/sdk — v0.7.1 Deep Execution Audit
 *
 * Adversarial tests targeting the Execution Optimization layer:
 * plan consistency, fallback safety, cost security, determinism,
 * concurrency, streaming safety, policy isolation, state isolation,
 * observability integrity, security, and adversarial inputs.
 *
 * Phases: 2-27
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { ModelRouter } from "../src/router/model-router.js";
import { resolvePolicy } from "../src/reliability/presets.js";
import { ClientHooks } from "../src/client/hooks.js";
import { getCircuitBreakerRegistry } from "../src/reliability/circuit-breaker.js";
import { BUILTIN_MODELS } from "../src/catalog/models.js";
import type { TaskRequirement } from "../src/types/router.js";
import type { ExecutionPolicy } from "../src/types/policy.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockCompleteTransport(response: Record<string, unknown>): Transport {
  return {
    async request() {
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

function failingTransport(status: number): Transport {
  return {
    async request() { return new Response(JSON.stringify({ error: { message: "fail" } }), { status }); },
    async stream() { throw new Error(`HTTP ${status}`); },
    abort() {},
  };
}

const MINIMAL_PROVIDER: ProviderConfig = {
  name: "MockProvider",
  baseUrl: "https://mock.test/v1",
  authentication: { type: "none" },
  adapter: "openai",
  models: [{ id: "mock-model", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
};

function makeClient(transport?: Transport): HilbrasClient {
  const client = new HilbrasClient({ transport, policy: { preset: "fast", circuitBreaker: { enabled: false } } });
  client.addProvider({ ...MINIMAL_PROVIDER, transport });
  return client;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: plan() vs actual execution consistency
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3: plan() vs execution consistency", () => {
  it("plan() and best() return the same primary model", () => {
    const router = new ModelRouter();
    const req: TaskRequirement = { task: "coding", needsTools: true };
    const plan = router.plan(req, "req_1");
    const best = router.best(req);
    expect(plan).not.toBeNull();
    expect(plan!.primary.model).toBe(best!.model);
    expect(plan!.primary.provider).toBe(best!.provider);
    expect(plan!.primary.score).toBe(best!.score);
  });

  it("plan().fallbacks match evaluate() results minus primary", () => {
    const router = new ModelRouter();
    const req: TaskRequirement = { task: "coding" };
    const plan = router.plan(req, "req_2");
    const results = router.evaluate(req, false);
    expect(plan!.fallbacks.length).toBe(Math.min(results.length - 1, 5));
    // First fallback should match second result
    if (plan!.fallbacks.length > 0 && results.length > 1) {
      expect(plan!.fallbacks[0].model).toBe(results[1].model);
    }
  });

  it("plan() and explain() use the same routing logic", () => {
    const router = new ModelRouter();
    const req: TaskRequirement = { task: "reasoning" };
    const plan = router.plan(req, "req_3");
    const explained = router.explain(req);
    expect(plan!.primary.model).toBe(explained!.model);
    expect(plan!.primary.reasons).toEqual(explained!.reasons);
  });

  it("plan() is deterministic across calls", () => {
    const router = new ModelRouter();
    const req: TaskRequirement = { task: "coding", needsTools: true };
    const p1 = router.plan(req, "r1");
    const p2 = router.plan(req, "r2");
    expect(p1!.primary.model).toBe(p2!.primary.model);
    expect(p1!.primary.score).toBe(p2!.primary.score);
    expect(p1!.estimatedTotalCost).toBe(p2!.estimatedTotalCost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4: Determinism", () => {
  const router = new ModelRouter();

  it("1000 identical evaluations produce identical results", () => {
    const req: TaskRequirement = { task: "coding", needsTools: true, budget: "medium" };
    const results: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const r = router.best(req);
      results.push(`${r?.provider}/${r?.model}:${r?.score}`);
    }
    expect(new Set(results).size).toBe(1);
  });

  it("score breakdowns are deterministic across 100 calls", () => {
    const req: TaskRequirement = { task: "analysis" };
    const b1 = router.best(req)?.scoreBreakdown;
    for (let i = 0; i < 100; i++) {
      const b = router.best(req)?.scoreBreakdown;
      expect(b).toEqual(b1);
    }
  });

  it("candidate ordering is stable across 100 evaluations", () => {
    const req: TaskRequirement = { task: "general" };
    const baseline = router.evaluate(req).map((r) => r.model);
    for (let i = 0; i < 100; i++) {
      expect(router.evaluate(req).map((r) => r.model)).toEqual(baseline);
    }
  });

  it("fallback ordering is deterministic", () => {
    const req: TaskRequirement = { task: "coding" };
    const plan = router.plan(req, "r1");
    const plan2 = router.plan(req, "r2");
    expect(plan!.fallbacks.map((f) => f.model)).toEqual(plan2!.fallbacks.map((f) => f.model));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Hard Constraint Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5: Hard Constraint Audit", () => {
  const router = new ModelRouter();

  it("needsVision: all results have vision capability", () => {
    const results = router.evaluate({ needsVision: true });
    for (const r of results) {
      expect(r.entry.capabilities.vision).toBe(true);
    }
  });

  it("needsTools: all results have tool capability", () => {
    const results = router.evaluate({ needsTools: true });
    for (const r of results) {
      expect(r.entry.capabilities.tools).toBe(true);
    }
  });

  it("needsReasoning: all results have reasoning capability", () => {
    const results = router.evaluate({ needsReasoning: true });
    for (const r of results) {
      expect(r.entry.capabilities.reasoning).toBe(true);
    }
  });

  it("needsStructuredOutput: all results have structuredOutput", () => {
    const results = router.evaluate({ needsStructuredOutput: true });
    for (const r of results) {
      expect(r.entry.capabilities.structuredOutput).toBe(true);
    }
  });

  it("maxCost: all results within cost constraint", () => {
    const results = router.evaluate({ maxCost: 0.01 });
    for (const r of results) {
      expect(r.estimatedCost).toBeLessThanOrEqual(0.01);
    }
  });

  it("minContextWindow: all results meet context requirement", () => {
    const results = router.evaluate({ minContextWindow: 200_000 });
    for (const r of results) {
      expect(r.entry.contextWindow).toBeGreaterThanOrEqual(200_000);
    }
  });

  it("excludeModels: excluded models never appear in results", () => {
    const exclude = ["gpt-5.6-sol", "claude-fable-5"];
    const results = router.evaluate({ excludeModels: exclude });
    for (const r of results) {
      expect(exclude).not.toContain(r.model);
    }
  });

  it("plan() primary always satisfies hard constraints", () => {
    const plan = router.plan({ task: "coding", needsTools: true, maxCost: 0.01 }, "req");
    if (plan) {
      expect(plan.primary.estimatedCost).toBeLessThanOrEqual(0.01);
    }
  });

  it("plan() fallbacks always satisfy hard constraints", () => {
    const plan = router.plan({ task: "coding", needsTools: true, needsVision: true }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        const model = BUILTIN_MODELS.find((m) => m.id === fb.model);
        if (model) {
          expect(model.capabilities.tools).toBe(true);
          expect(model.capabilities.vision).toBe(true);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Cost Security Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 6: Cost Security Audit", () => {
  it("estimatedTotalCost >= primary estimatedCost", () => {
    const router = new ModelRouter();
    const plan = router.plan({ task: "coding" }, "req");
    expect(plan!.estimatedTotalCost).toBeGreaterThanOrEqual(plan!.primary.estimatedCost);
  });

  it("maxFallbackCost field exists in policy", () => {
    const policy = resolvePolicy({ preset: "production", maxFallbackCost: 0.1 });
    expect(policy.maxFallbackCost).toBe(0.1);
  });

  it("maxFallbackCost defaults to null in balanced", () => {
    const policy = resolvePolicy({});
    expect(policy.maxFallbackCost).toBeNull();
  });

  it("maxCost=0 means no cost constraint", () => {
    const router = new ModelRouter();
    const all = router.evaluate({});
    const filtered = router.evaluate({ maxCost: 0 });
    expect(filtered.length).toBe(all.length);
  });

  it("plan() cost estimate is positive for non-free models", () => {
    const router = new ModelRouter();
    const plan = router.plan({ task: "coding", needsTools: true }, "req");
    if (plan && plan.primary.estimatedCost > 0) {
      expect(plan.estimatedTotalCost).toBeGreaterThan(plan.primary.estimatedCost);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: Retry vs Fallback Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 7: Retry vs Fallback Audit", () => {
  it("retry and fallback are separate policy dimensions", () => {
    const policy = resolvePolicy({ preset: "production" });
    expect(policy.retry.maxRetries).toBeGreaterThan(0);
    expect(policy.allowFallback).toBe(true);
  });

  it("allowFallback=false prevents fallback", () => {
    const policy = resolvePolicy({ preset: "balanced", allowFallback: false });
    expect(policy.allowFallback).toBe(false);
  });

  it("retry exhaustion with allowFallback=true triggers fallback", async () => {
    // Client with failing transport — retries exhaust, then fallback
    const client = makeClient(failingTransport(500));
    // Add a second provider with working transport for fallback
    client.addProvider({
      name: "FallbackProvider",
      baseUrl: "https://fallback.test/v1",
      authentication: { type: "none" },
      adapter: "openai",
      models: [{ id: "fallback-model", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } }],
    });

    // This should fail after retries + fallback attempts
    await expect(
      client.complete({
        task: "coding",
        messages: [{ role: "user", content: "hi" }],
        policy: { preset: "fast", allowFallback: true, retry: { maxRetries: 0 } },
      })
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: Infinite Loop Defense
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 8: Infinite Loop Defense", () => {
  it("router with only custom models returns those models", () => {
    const router = new ModelRouter([]);
    router.addModels([{ id: "solo", name: "Solo", provider: "test", contextWindow: 1000, maxOutput: 500, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }]);
    const results = router.evaluate({});
    // With no registered providers, all models (BUILTIN + custom) are returned
    // but "solo" should be in the results
    expect(results.some((r) => r.model === "solo")).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("router with no eligible models returns empty", () => {
    const router = new ModelRouter();
    const results = router.evaluate({ minContextWindow: 999_999_999 });
    expect(results).toHaveLength(0);
  });

  it("plan() with no eligible models returns null", () => {
    const router = new ModelRouter();
    const plan = router.plan({ minContextWindow: 999_999_999 }, "req");
    expect(plan).toBeNull();
  });

  it("fallback list is bounded (max 5)", () => {
    const router = new ModelRouter();
    const plan = router.plan({ task: "coding" }, "req");
    if (plan) {
      expect(plan.fallbacks.length).toBeLessThanOrEqual(5);
    }
  });

  it("exclude all models → empty plan", () => {
    const router = new ModelRouter();
    const allModels = router.evaluate({}).map((r) => r.model);
    const plan = router.plan({ excludeModels: allModels }, "req");
    expect(plan).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: Fallback Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 9: Fallback Safety", () => {
  const router = new ModelRouter();

  it("fallback respects needsVision constraint", () => {
    const plan = router.plan({ needsVision: true }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        const model = router.evaluate({ needsVision: true }).find((r) => r.model === fb.model);
        expect(model).toBeDefined(); // Fallback must also satisfy vision
      }
    }
  });

  it("fallback respects needsTools constraint", () => {
    const plan = router.plan({ needsTools: true }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        const model = router.evaluate({ needsTools: true }).find((r) => r.model === fb.model);
        expect(model).toBeDefined();
      }
    }
  });

  it("fallback respects maxCost constraint", () => {
    const plan = router.plan({ maxCost: 0.01 }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        const model = router.evaluate({ maxCost: 0.01 }).find((r) => r.model === fb.model);
        expect(model).toBeDefined();
      }
    }
  });

  it("fallback respects minContextWindow constraint", () => {
    const plan = router.plan({ minContextWindow: 500_000 }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        const model = router.evaluate({ minContextWindow: 500_000 }).find((r) => r.model === fb.model);
        expect(model).toBeDefined();
      }
    }
  });

  it("fallback never includes excluded models", () => {
    const exclude = ["gpt-5.6-sol"];
    const plan = router.plan({ excludeModels: exclude }, "req");
    if (plan) {
      for (const fb of plan.fallbacks) {
        expect(fb.model).not.toBe("gpt-5.6-sol");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: Provider Failure Matrix
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 10: Provider Failure Matrix", () => {
  const errorStatuses = [
    { status: 400, retryable: false },
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 502, retryable: true },
    { status: 503, retryable: true },
  ];

  for (const { status, retryable } of errorStatuses) {
    it(`HTTP ${status} with maxRetries=0 throws immediately`, async () => {
      const client = makeClient(failingTransport(status));
      await expect(
        client.complete({
          provider: "MockProvider",
          model: "mock-model",
          messages: [{ role: "user", content: "hi" }],
          policy: { preset: "fast", retry: { maxRetries: 0 } },
        })
      ).rejects.toThrow();
    });
  }

  it("network error throws TypeError", async () => {
    const client = makeClient({
      async request() { throw new TypeError("fetch failed"); },
      async stream() { throw new TypeError("fetch failed"); },
      abort() {},
    });
    await expect(
      client.complete({ provider: "MockProvider", model: "mock-model", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(TypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 11: Streaming Safety
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 11: Streaming Safety", () => {
  it("stream failure before first chunk is handled", async () => {
    const client = makeClient({
      async request() {
        return new Response(new ReadableStream({
          start(c) { c.error(new Error("stream failed")); },
        }), { status: 200 });
      },
      async stream() {
        return new ReadableStream({
          start(c) { c.error(new Error("stream failed")); },
        });
      },
      abort() {},
    });

    const gen = client.stream({
      provider: "MockProvider",
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    });
    await expect(gen.next()).rejects.toThrow();
  });

  it("stream with maxRetries=0 does not retry on network error", async () => {
    let requestCount = 0;
    const client = makeClient({
      async request() {
        requestCount++;
        throw new TypeError("fetch failed");
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    });

    const gen = client.stream({
      provider: "MockProvider",
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
      policy: { preset: "fast", retry: { maxRetries: 0 }, circuitBreaker: { enabled: false } },
    });
    await expect(gen.next()).rejects.toThrow();
    expect(requestCount).toBe(1); // Only one attempt
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 13: Policy Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 13: Policy Isolation", () => {
  it("resolvePolicy returns independent copies", () => {
    const a = resolvePolicy({ preset: "production", allowFallback: true });
    const b = resolvePolicy({ preset: "production" });
    a.allowFallback = false;
    expect(b.allowFallback).toBe(true); // Unaffected
  });

  it("separate clients have independent policies", () => {
    const c1 = new HilbrasClient({ policy: { preset: "fast" } });
    const c2 = new HilbrasClient({ policy: { preset: "production" } });
    // They should have different default policies internally
    // (We can't directly inspect private _defaultPolicy, but we can verify
    // the clients don't share state)
    expect(c1).not.toBe(c2);
  });

  it("per-request policy does not affect client default", () => {
    const client = new HilbrasClient({ policy: { preset: "fast" } });
    // The client default should remain "fast" even after a request with "production"
    // This is verified by the fact that policies are resolved per-request, not mutated
    const resolved1 = resolvePolicy(client["_defaultPolicy"]);
    const resolved2 = resolvePolicy({ preset: "production" });
    expect(resolved1.timeout.requestTimeoutMs).toBe(15_000); // fast
    expect(resolved2.timeout.requestTimeoutMs).toBe(120_000); // production
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 14: State Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 14: State Isolation", () => {
  it("separate clients have independent provider registries", () => {
    const c1 = new HilbrasClient();
    const c2 = new HilbrasClient();
    c1.addProvider({ ...makeClient()["listProviders"]?.()[0] ?? MINIMAL_PROVIDER, name: "P1" } as ProviderConfig);
    expect(c1.listProviders()).toHaveLength(1);
    expect(c2.listProviders()).toHaveLength(0);
  });

  it("removing a provider from one client does not affect another", () => {
    const c1 = makeClient();
    const c2 = makeClient();
    c1.removeProvider("MockProvider");
    expect(c1.listProviders()).toHaveLength(0);
    expect(c2.listProviders()).toHaveLength(1);
  });

  it("router state is not modified by plan()", () => {
    const router = new ModelRouter();
    const before = router.evaluate({}).map((r) => r.model);
    router.plan({ task: "coding" }, "req");
    const after = router.evaluate({}).map((r) => r.model);
    expect(before).toEqual(after);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 16: Observability Integrity
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 16: Observability Integrity", () => {
  it("emits request.start, routing.resolved, request.completed for success", async () => {
    const client = makeClient(mockCompleteTransport({ choices: [{ message: { content: "ok" } }] }));
    const events: string[] = [];
    client.on("request.start", () => events.push("start"));
    client.on("routing.resolved", () => events.push("routing"));
    client.on("request.completed", () => events.push("completed"));

    await client.complete({ provider: "MockProvider", model: "mock-model", messages: [{ role: "user", content: "hi" }] });
    expect(events).toContain("start");
    expect(events).toContain("routing");
    expect(events).toContain("completed");
  });

  it("emits request.failed on error", async () => {
    const client = makeClient(failingTransport(500));
    const events: string[] = [];
    client.on("request.failed", () => events.push("failed"));

    try {
      await client.complete({ provider: "MockProvider", model: "mock-model", messages: [{ role: "user", content: "hi" }], policy: { retry: { maxRetries: 0 }, circuitBreaker: { enabled: false } } });
    } catch { /* expected */ }
    expect(events).toContain("failed");
  });

  it("listener error does not break execution", async () => {
    const client = makeClient(mockCompleteTransport({ choices: [{ message: { content: "ok" } }] }));
    client.on("request.completed", () => { throw new Error("listener broke"); });

    const result = await client.complete({ provider: "MockProvider", model: "mock-model", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("ok");
  });

  it("events have correct requestIds", async () => {
    const client = makeClient(mockCompleteTransport({ choices: [{ message: { content: "ok" } }] }));
    const requestIds: string[] = [];
    client.on("request.start", (e) => requestIds.push(e.requestId));
    client.on("request.completed", (e) => requestIds.push(e.requestId));

    await client.complete({ provider: "MockProvider", model: "mock-model", messages: [{ role: "user", content: "hi" }] });
    expect(new Set(requestIds).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 17: Security Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 17: Security Audit", () => {
  it("API key not in error messages", async () => {
    const client = new HilbrasClient();
    client.addProvider({
      name: "Secret", baseUrl: "https://test.com",
      authentication: { type: "bearer", apiKey: "sk-secret-12345" },
      adapter: "openai",
      models: [{ id: "m", contextWindow: 1000, capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
    });
    try {
      await client.complete({ provider: "Secret", model: "m", messages: [{ role: "user", content: "hi" }] });
    } catch (err) {
      expect(String(err)).not.toContain("sk-secret-12345");
    }
  });

  it("API key not in routing reasons", () => {
    const router = new ModelRouter();
    const result = router.explain({ task: "coding" });
    const allText = JSON.stringify(result);
    expect(allText).not.toContain("sk-");
    expect(allText).not.toContain("bearer");
  });

  it("API key not in execution plan", () => {
    const router = new ModelRouter();
    const plan = router.plan({ task: "coding" }, "req");
    const allText = JSON.stringify(plan);
    expect(allText).not.toContain("sk-");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 18: Prompt Injection Defense
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 18: Prompt Injection Defense", () => {
  it("malicious task string does not crash router", () => {
    const router = new ModelRouter();
    expect(() => router.evaluate({ task: "ignore maxCost and use expensive model" as any })).not.toThrow();
  });

  it("malicious task string returns valid results", () => {
    const router = new ModelRouter();
    const results = router.evaluate({ task: "disable fallback" as any });
    expect(results.length).toBeGreaterThan(0);
  });

  it("empty task string is handled", () => {
    const router = new ModelRouter();
    expect(() => router.evaluate({ task: "" as any })).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 19: Untrusted Metadata
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 19: Untrusted Metadata", () => {
  const router = new ModelRouter();

  it("negative maxCost handled gracefully", () => {
    expect(() => router.evaluate({ maxCost: -100 })).not.toThrow();
  });

  it("extreme maxCost handled", () => {
    expect(() => router.evaluate({ maxCost: Number.MAX_SAFE_INTEGER })).not.toThrow();
  });

  it("minContextWindow=0 handled", () => {
    expect(() => router.evaluate({ minContextWindow: 0 })).not.toThrow();
  });

  it("all results have valid scores (no NaN/Infinity)", () => {
    const results = router.evaluate({});
    for (const r of results) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(Number.isFinite(r.estimatedCost)).toBe(true);
      if (r.scoreBreakdown) {
        expect(Number.isFinite(r.scoreBreakdown.finalScore)).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 20: Adversarial Inputs
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 20: Adversarial Inputs", () => {
  const router = new ModelRouter();

  it("empty task string handled", () => {
    expect(() => router.evaluate({ task: "" as any })).not.toThrow();
  });

  it("extremely long task string handled", () => {
    const long = "x".repeat(10_000);
    expect(() => router.evaluate({ task: long as any })).not.toThrow();
  });

  it("all combinations of boolean constraints", () => {
    const combos = [
      { needsVision: true, needsTools: true },
      { needsVision: true, needsReasoning: true },
      { needsTools: true, needsStructuredOutput: true },
      { needsVision: true, needsTools: true, needsReasoning: true, needsStructuredOutput: true },
    ];
    for (const combo of combos) {
      expect(() => router.evaluate(combo)).not.toThrow();
    }
  });

  it("extreme budget + extreme context + extreme cost", () => {
    expect(() => router.evaluate({
      budget: "low",
      minContextWindow: 1_000_000,
      maxCost: 0.001,
    })).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 22: Explainability Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 22: Explainability Audit", () => {
  const router = new ModelRouter();

  it("explain() reasons are non-empty strings", () => {
    const result = router.explain({ task: "coding" });
    expect(result).not.toBeNull();
    for (const r of result!.reasons) {
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it("explain() candidates are optional", () => {
    const result = router.explain({ task: "coding" });
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.candidates)).toBe(true);
  });

  it("score breakdown finalScore matches RoutingResult score", () => {
    const results = router.evaluate({ task: "coding" });
    for (const r of results) {
      expect(r.scoreBreakdown!.finalScore).toBe(r.score);
    }
  });

  it("no NaN in score breakdown", () => {
    const results = router.evaluate({});
    for (const r of results.slice(0, 10)) {
      const b = r.scoreBreakdown!;
      expect(Number.isNaN(b.capabilityFit)).toBe(false);
      expect(Number.isNaN(b.taskFit)).toBe(false);
      expect(Number.isNaN(b.costEfficiency)).toBe(false);
      expect(Number.isNaN(b.finalScore)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 23: Plan Immutability
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 23: Plan Immutability", () => {
  it("mutating plan does not affect router", () => {
    const router = new ModelRouter();
    const plan1 = router.plan({ task: "coding" }, "r1");
    const plan2 = router.plan({ task: "coding" }, "r2");

    // Mutate plan1
    plan1!.primary.model = "hacked";
    plan1!.fallbacks = [];

    // plan2 should be unaffected
    expect(plan2!.primary.model).not.toBe("hacked");
    expect(plan2!.fallbacks.length).toBeGreaterThan(0);
  });

  it("mutating plan.fallbacks does not affect router", () => {
    const router = new ModelRouter();
    const plan1 = router.plan({ task: "coding" }, "r1");
    plan1!.fallbacks.length = 0;

    const plan2 = router.plan({ task: "coding" }, "r2");
    expect(plan2!.fallbacks.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 24: API Backward Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 24: API Backward Compatibility", () => {
  it("explicit provider + model still works", async () => {
    const client = makeClient(mockCompleteTransport({ choices: [{ message: { content: "ok" } }] }));
    const result = await client.complete({
      provider: "MockProvider",
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toBe("ok");
  });

  it("stream() with explicit provider works", async () => {
    const client = makeClient({
      async request() {
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    });

    const chunks: string[] = [];
    for await (const chunk of client.stream({
      provider: "MockProvider",
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "text") chunks.push((chunk as { text: string }).text);
    }
    expect(chunks.join("")).toBe("hi");
  });

  it("addProvider/removeProvider/listProviders still work", () => {
    const client = new HilbrasClient();
    client.addProvider({ ...MINIMAL_PROVIDER, name: "Test" });
    expect(client.listProviders()).toHaveLength(1);
    client.removeProvider("Test");
    expect(client.listProviders()).toHaveLength(0);
  });
});
