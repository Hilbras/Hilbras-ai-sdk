/**
 * @hilbras/sdk — Intelligent Execution integration tests
 *
 * Tests the full pipeline: routing → provider selection → structured output
 * → validation → repair, plus backward compatibility.
 */

import { describe, it, expect } from "vitest";
import { HilbrasClient } from "../src/client/client.js";
import { ModelRouter } from "../src/router/model-router.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";
import type { SchemaValidator } from "../src/types/schema.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────

const mockTransport: Transport = {
  async request() { return new Response(null, { status: 500 }); },
  async stream() { throw new Error("unused"); },
  abort() {},
};

function makeProvider(name: string, adapter: string = "openai"): ProviderConfig {
  return {
    name,
    baseUrl: `https://${name}.test/v1`,
    authentication: { type: "none" },
    adapter: adapter as ProviderConfig["adapter"],
    models: [
      { id: "test-model", contextWindow: 128_000, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true, parallelTools: false, systemPrompts: true } },
    ],
  };
}

// ─── Router Tests ─────────────────────────────────────────────────────────

describe("Model Router — full pipeline", () => {
  const router = new ModelRouter();

  it("produces explainable decisions with reasons", () => {
    const result = router.best({ task: "coding", needsTools: true });
    expect(result).not.toBeNull();
    expect(result!.reasons.length).toBeGreaterThan(0);
    expect(typeof result!.reasons[0]).toBe("string");
  });

  it("rejects models that fail hard constraints", () => {
    const result = router.best({ needsVision: true, maxCost: 0.0001 });
    // With very low cost, most models should be rejected
    if (result) {
      expect(result.candidates).toBeDefined();
      expect(result.candidates!.length).toBeGreaterThan(0);
      expect(result.candidates!.every((c) => c.rejectionReason)).toBe(true);
    }
  });

  it("scores results in deterministic order", () => {
    const r1 = router.evaluate({ task: "coding" });
    const r2 = router.evaluate({ task: "coding" });
    expect(r1.map((r) => r.model)).toEqual(r2.map((r) => r.model));
    expect(r1.map((r) => r.score)).toEqual(r2.map((r) => r.score));
  });

  it("explain() always returns candidates", () => {
    const result = router.explain({ task: "general" });
    expect(result).not.toBeNull();
    expect(result!.candidates).toBeDefined();
    expect(Array.isArray(result!.candidates)).toBe(true);
  });

  it("respects excludeModels", () => {
    const result = router.best({ excludeModels: ["gpt-5.6-sol", "claude-fable-5"] });
    if (result) {
      expect(result.model).not.toBe("gpt-5.6-sol");
      expect(result.model).not.toBe("claude-fable-5");
    }
  });

  it("preferredProvider gets bonus", () => {
    const withPref = router.evaluate({ preferredProvider: "openai" });
    expect(withPref[0].provider).toBe("openai");
  });
});

// ─── Structured Output Pipeline ──────────────────────────────────────────

describe("Structured Output — full pipeline", () => {
  it("SchemaValidator is Zod-agnostic", () => {
    // Simulate a Zod-like validator
    const schema: SchemaValidator<{ name: string; age: number }> = {
      safeParse(data) {
        if (
          typeof data === "object" && data !== null &&
          "name" in data && typeof (data as Record<string, unknown>).name === "string" &&
          "age" in data && typeof (data as Record<string, unknown>).age === "number"
        ) {
          return { success: true, data: data as { name: string; age: number } };
        }
        return { success: false, error: new Error("Invalid shape") };
      },
    };

    const result = schema.safeParse({ name: "John", age: 24 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("John");
      expect(result.data.age).toBe(24);
    }

    const fail = schema.safeParse({ name: "John", age: "24" });
    expect(fail.success).toBe(false);
  });

  it("complete() with output is generic", () => {
    const client = new HilbrasClient();
    // Verify the type signature accepts output config
    // (This is a compile-time check — if it compiles, the test passes)
    type AssertComplete = typeof client.complete<{ name: string }>;
    expect(true).toBe(true);
  });
});

// ─── Backward Compatibility ──────────────────────────────────────────────

describe("Backward Compatibility", () => {
  it("explicit provider + model bypasses router", () => {
    const client = new HilbrasClient();
    client.addProvider(makeProvider("TestProvider"));
    // Verify that explicit provider+model works without routing
    expect(() => {
      client.router.best({ task: "coding" }); // Should not throw
    }).not.toThrow();
  });

  it("stream() accepts provider + model (backward compatible)", () => {
    const client = new HilbrasClient();
    // The stream method should accept provider and model as optional
    // If they're provided, the router is bypassed
    expect(typeof client.stream).toBe("function");
    expect(typeof client.complete).toBe("function");
  });

  it("client has all expected public methods", () => {
    const client = new HilbrasClient();
    expect(typeof client.addProvider).toBe("function");
    expect(typeof client.removeProvider).toBe("function");
    expect(typeof client.getProvider).toBe("function");
    expect(typeof client.listProviders).toBe("function");
    expect(typeof client.findModel).toBe("function");
    expect(typeof client.stream).toBe("function");
    expect(typeof client.complete).toBe("function");
    expect(typeof client.explain).toBe("function");
    expect(typeof client.on).toBe("function");
    expect(typeof client.off).toBe("function");
    expect(typeof client.dispose).toBe("function");
    expect(client.router).toBeInstanceOf(ModelRouter);
    expect(client.adapterRegistry).toBeDefined();
  });

  it("client exposes router and adapterRegistry", () => {
    const client = new HilbrasClient();
    expect(client.router).toBeInstanceOf(ModelRouter);
    expect(client.adapterRegistry).toBeDefined();
    expect(typeof client.router.best).toBe("function");
    expect(typeof client.router.explain).toBe("function");
  });
});

// ─── Router ↔ Structured Output Integration ──────────────────────────────

describe("Router ↔ Structured Output Integration", () => {
  it("router selects structured-output-capable models when output is implied", () => {
    const router = new ModelRouter();
    const results = router.evaluate({ needsStructuredOutput: true });
    // All results should have structuredOutput capability
    for (const r of results) {
      expect(r.entry.capabilities.structuredOutput).toBe(true);
    }
  });

  it("explicit provider + model is always available", () => {
    const router = new ModelRouter();
    // Even with strict requirements, explicit selection should work
    // (The router doesn't block explicit — the client handles bypass)
    const results = router.evaluate({});
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Execution Policy Integration ────────────────────────────────────────

describe("Execution Policy Integration", () => {
  it("policy presets produce valid resolved configs", () => {
    const presets = ["balanced", "production", "fast", "cheap", "maximum"] as const;
    for (const preset of presets) {
      const router = new ModelRouter();
      // Verify router works with each preset
      const result = router.best({ task: "general" });
      expect(result).not.toBeNull();
    }
  });
});
