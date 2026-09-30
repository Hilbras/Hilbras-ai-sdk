/**
 * @hilbras/sdk — Client authorization integration
 *
 * Covers the findings closed in v3.4.0 Phase 4: `config.rbac` is live (R5),
 * tool lists are enforced (R6), and the tool policy is enforceable at the
 * layer where tools actually run.
 */

import { describe, it, expect, vi } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { ToolPolicy, createToolPolicy } from "../../src/security/tool-policy.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { ToolLoopAgent } from "../../src/features/agent/tool-loop.js";
import { ConfigurationError } from "../../src/errors/index.js";
import type { AgentTool } from "../../src/features/agent/types.js";
import type { Transport } from "../../src/transport/transport.js";

const provider = (name: string, baseUrl: string) => ({
  name,
  baseUrl,
  adapter: "openai",
  authentication: { type: "none" as const },
  models: [{
    id: "m1",
    contextWindow: 4096,
    capabilities: {
      streaming: true, tools: true, vision: false, reasoning: false,
      structuredOutput: false, parallelTools: false, systemPrompts: true,
      embeddings: false, imageGeneration: false, speech: false,
      transcription: false, reranking: false,
    },
  }],
});

describe("ProviderRegistry.findByUrl", () => {
  const registry = new ProviderRegistry();
  registry.add(provider("openai", "https://api.openai.com/v1"));
  registry.add(provider("local", "http://localhost:11434/v1/"));
  registry.add(provider("azureish", "https://x.test/openai/deployments/gpt4"));

  it("resolves a provider from a request URL", () => {
    expect(registry.findByUrl("https://api.openai.com/v1/chat/completions")).toBe("openai");
  });

  it("tolerates a base path with or without a trailing slash", () => {
    expect(registry.findByUrl("https://api.openai.com/v1")).toBe("openai");
    expect(registry.findByUrl("http://localhost:11434/v1/chat")).toBe("local");
  });

  it("requires the base path prefix to match", () => {
    expect(registry.findByUrl("https://api.openai.com/v2/chat")).toBeNull();
    expect(registry.findByUrl("https://x.test/openai/deployments/gpt4/chat")).toBe("azureish");
    expect(registry.findByUrl("https://x.test/other")).toBeNull();
  });

  it("returns null for an unknown origin or an unparseable URL", () => {
    expect(registry.findByUrl("https://evil.test/v1/chat")).toBeNull();
    expect(registry.findByUrl("not-a-url")).toBeNull();
  });

  it("sees providers registered after construction", () => {
    const fresh = new ProviderRegistry();
    expect(fresh.findByUrl("https://late.test/v1/chat")).toBeNull();
    fresh.add(provider("late", "https://late.test/v1"));
    expect(fresh.findByUrl("https://late.test/v1/chat")).toBe("late");
  });
});

describe("ToolPolicy", () => {
  it("permits everything when empty", () => {
    expect(new ToolPolicy().isEmpty()).toBe(true);
    expect(new ToolPolicy({ allowedTools: [], deniedTools: [] }).isEmpty()).toBe(true);
    expect(new ToolPolicy().isAllowed("anything")).toBe(true);
  });

  it("denies a denied tool even when it is also allowed", () => {
    const policy = createToolPolicy({ allowedTools: ["a", "b"], deniedTools: ["b"] });
    expect(policy.isAllowed("a")).toBe(true);
    const decision = policy.check("b");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("denied");
  });

  it("denies a tool outside a non-empty allow-list", () => {
    const policy = createToolPolicy({ allowedTools: ["a"] });
    expect(policy.isAllowed("z")).toBe(false);
    expect(policy.check("z").reason).toContain("not in the allowed tool list");
  });

  it("narrows but never widens", () => {
    const client = createToolPolicy({ allowedTools: ["a", "b", "c"] });
    const user = createToolPolicy({ allowedTools: ["b", "c", "d"] });
    const narrowed = client.narrow(user);
    expect(narrowed.isAllowed("a")).toBe(false);
    expect(narrowed.isAllowed("b")).toBe(true);
    expect(narrowed.isAllowed("d")).toBe(false);
  });

  it("propagates deny lists when narrowing", () => {
    const narrowed = createToolPolicy({ allowedTools: ["a"] }).narrow({ deniedTools: ["a"] });
    expect(narrowed.isAllowed("a")).toBe(false);
  });

  it("permits nothing when narrowing yields an empty intersection", () => {
    // Regression: an empty intersection must mean "nothing is permitted", not
    // "no restriction". Collapsing it to unrestricted made narrow() wider.
    const narrowed = createToolPolicy({ allowedTools: ["a"] }).narrow({ allowedTools: ["b"] });
    expect(narrowed.allowedTools).toEqual([]);
    expect(narrowed.isAllowed("a")).toBe(false);
    expect(narrowed.isAllowed("b")).toBe(false);
    expect(narrowed.isAllowed("anything")).toBe(false);
    expect(narrowed.isEmpty()).toBe(false);
  });

  it("keeps an empty allow-list restrictive across a second narrowing", () => {
    const narrowed = createToolPolicy({ allowedTools: ["a"] })
      .narrow({ allowedTools: ["b"] })
      .narrow({ allowedTools: ["a", "b"] });
    expect(narrowed.isAllowed("a")).toBe(false);
  });

  it("treats an empty allow-list as unrestricted in ordinary construction", () => {
    // Configuration semantics: `allowedTools: []` means "no restriction".
    const policy = createToolPolicy({ allowedTools: [] });
    expect(policy.allowedTools).toBeUndefined();
    expect(policy.isAllowed("anything")).toBe(true);
    expect(policy.isEmpty()).toBe(true);
  });

  it("reports the first violation in a set and throws on assert", () => {
    const policy = createToolPolicy({ allowedTools: ["a"] });
    expect(policy.checkAll(["a", "b"])).toMatchObject({ allowed: false });
    expect(policy.checkAll(["a"])).toBeNull();
    expect(() => policy.assertAllowed("b")).toThrow(/not in the allowed tool list/);
    expect(() => policy.assertAllowed("a")).not.toThrow();
  });

  it("freezes its lists", () => {
    const input = { allowedTools: ["a"] };
    const policy = createToolPolicy(input);
    input.allowedTools.push("b");
    expect(policy.isAllowed("b")).toBe(false);
  });
});

describe("client tool policy", () => {
  it("derives an enforced policy from allowedTools and deniedTools", () => {
    const client = new HilbrasClient({ config: { allowedTools: ["a"], deniedTools: ["b"] } });
    const policy = client.getToolPolicy();
    expect(policy.isAllowed("a")).toBe(true);
    expect(policy.isAllowed("b")).toBe(false);
    expect(policy.isAllowed("z")).toBe(false);
  });

  it("is unrestricted when both lists are empty", () => {
    expect(new HilbrasClient().getToolPolicy().isEmpty()).toBe(true);
  });

  it("rejects a complete() request that uses a denied tool before any provider call", async () => {
    const client = new HilbrasClient({
      config: { providers: [provider("p", "https://p.test/v1")], allowedTools: ["allowed"] },
    });
    const complete = vi.fn();
    client._adapters.set("p", { id: "openai", complete } as never);

    await expect(client.complete({
      provider: "p",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "forbidden", description: "", parameters: {} } }],
    } as never)).rejects.toThrow(/not in the allowed tool list/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects a streamText() request that uses a denied tool", async () => {
    const client = new HilbrasClient({ config: { deniedTools: ["shell"] } });
    const iterator = client.streamText({
      provider: "p",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "shell", description: "", parameters: {} } }],
    } as never);
    await expect(iterator.next()).rejects.toThrow(/denied by policy/);
  });
});

describe("ToolLoopAgent tool policy", () => {
  const makeTool = (name: string, execute: () => Promise<string> = async () => "ok"): AgentTool =>
    ({ name, description: name, parameters: { type: "object" }, execute }) as unknown as AgentTool;

  const llmReturningToolCall = (toolName: string) => {
    let call = 0;
    return async () => {
      call += 1;
      if (call === 1) {
        return { content: "", toolCalls: [{ name: toolName, arguments: {} }] };
      }
      return { content: "done", usage: { promptTokens: 1, completionTokens: 1 } };
    };
  };

  it("does not execute a denied tool and records the policy error", async () => {
    const execute = vi.fn(async () => "should not run");
    const agent = new ToolLoopAgent({
      provider: "p",
      model: "m1",
      tools: [makeTool("shell", execute)],
      toolPolicy: { deniedTools: ["shell"] },
      llm: llmReturningToolCall("shell"),
      maxSteps: 2,
    });

    const result = await agent.run("go");

    expect(execute).not.toHaveBeenCalled();
    const call = result.steps[0]?.toolCalls[0];
    expect(call?.result).toBeNull();
    expect(call?.error).toContain("denied by policy");
  });

  it("does not execute a tool outside a non-empty allow-list", async () => {
    const execute = vi.fn(async () => "should not run");
    const agent = new ToolLoopAgent({
      provider: "p",
      model: "m1",
      tools: [makeTool("search", execute)],
      toolPolicy: { allowedTools: ["other"] },
      llm: llmReturningToolCall("search"),
      maxSteps: 2,
    });

    await agent.run("go");
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a permitted tool", async () => {
    const execute = vi.fn(async () => "found it");
    const agent = new ToolLoopAgent({
      provider: "p",
      model: "m1",
      tools: [makeTool("search", execute)],
      toolPolicy: { deniedTools: ["shell"] },
      llm: llmReturningToolCall("search"),
      maxSteps: 2,
    });

    const result = await agent.run("go");
    expect(execute).toHaveBeenCalled();
    expect(result.steps[0]?.toolCalls[0]?.result).toBe("found it");
  });

  it("leaves execution unchanged when no policy is configured", async () => {
    const execute = vi.fn(async () => "found it");
    const agent = new ToolLoopAgent({
      provider: "p",
      model: "m1",
      tools: [makeTool("shell", execute)],
      llm: llmReturningToolCall("shell"),
      maxSteps: 2,
    });

    const result = await agent.run("go");
    expect(execute).toHaveBeenCalled();
    expect(result.steps[0]?.toolCalls[0]?.result).toBe("found it");
  });

  it("accepts a ToolPolicy instance and narrows it against the client's policy", async () => {
    const client = new HilbrasClient({ config: { allowedTools: ["a", "b"] } });
    const execute = vi.fn(async () => "ok");
    const agent = new ToolLoopAgent({
      provider: "p",
      model: "m1",
      tools: [makeTool("a", execute), makeTool("b", execute)],
      toolPolicy: client.getToolPolicy().narrow({ allowedTools: ["a"] }),
      llm: llmReturningToolCall("b"),
      maxSteps: 2,
    });

    await agent.run("go");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("client rbac wiring", () => {
  const rbac = {
    roles: { viewer: { name: "viewer", allowedProviders: ["allowed-provider"] } },
    defaultRole: "viewer",
  };

  /**
   * Authorization runs at the transport layer, so these tests drive a real
   * adapter over a mock transport rather than stubbing the adapter.
   */
  const completionBody = JSON.stringify({
    id: "cmpl-1",
    object: "chat.completion",
    created: 0,
    model: "m1",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  const mockTransport = (seen: string[] = []): Transport => ({
    request: async (url) => {
      seen.push(url);
      return new Response(completionBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    stream: async () => new ReadableStream<Uint8Array>(),
    abort: () => {},
  });

  it("rejects a malformed rbac block at construction", () => {
    expect(() => new HilbrasClient({
      config: { rbac: { roles: { v: { name: "v", allowedModels: "gpt-4o" } } } },
    })).toThrow(ConfigurationError);
  });

  it("rejects a defaultRole that names a missing role", () => {
    expect(() => new HilbrasClient({
      config: { rbac: { roles: { viewer: { name: "viewer" } }, defaultRole: "viewr" } },
    })).toThrow(ConfigurationError);
  });

  it("denies a request to a provider outside the role's allow-list", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: { rbac, providers: [provider("blocked-provider", "https://blocked.test/v1")] },
    });

    await expect(client.complete({
      provider: "blocked-provider",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow();
    // The provider was never contacted.
    expect(reached).toEqual([]);
  });

  it("allows a request inside the role's allow-list", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: { rbac, providers: [provider("allowed-provider", "https://allowed.test/v1")] },
    });

    await expect(client.complete({
      provider: "allowed-provider",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    })).resolves.toBe("ok");
    expect(reached).toHaveLength(1);
  });

  it("enforces a provider registered after construction", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({ transport: mockTransport(reached), config: { rbac } });
    client.addProvider(provider("late-blocked", "https://late-blocked.test/v1") as never);

    await expect(client.complete({
      provider: "late-blocked",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow();
    expect(reached).toEqual([]);
  });

  it("records a diagnostic for a rate limit it cannot key without an identity", async () => {
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { viewer: { name: "viewer", rateLimit: { maxRequests: 5, windowMs: 60_000 } } },
          defaultRole: "viewer",
        },
        providers: [provider("any", "https://any.test/v1")],
      },
    });
    expect(client.getAuthorizationDiagnostics()).toEqual([]);

    // The client has no ambient identity, so the limit is reported rather than
    // silently claimed to be enforced.
    await client.complete({
      provider: "any",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    });

    const diagnostic = client.getAuthorizationDiagnostics()[0];
    expect(diagnostic.code).toBe("RBAC_RATE_LIMIT_UNKEYED");
    expect(diagnostic.severity).toBe("warning");
  });

  it("keys a per-role rate limit once an identity resolver is supplied", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: {
        rbac: {
          roles: { limited: { name: "limited", rateLimit: { maxRequests: 2, windowMs: 60_000 } } },
          defaultRole: "limited",
        },
        providers: [provider("p", "https://p.test/v1")],
      },
      authorization: { resolveUserId: () => "user-1" },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(await client
        .complete({ provider: "p", model: "m1", messages: [{ role: "user", content: "hi" }] })
        .then(() => 200)
        .catch(() => 429));
    }

    expect(statuses).toEqual([200, 200, 429, 429]);
    // Only the permitted attempts reached the provider.
    expect(reached).toHaveLength(2);
    expect(client.getAuthorizationDiagnostics().map((d) => d.code))
      .not.toContain("RBAC_RATE_LIMIT_UNKEYED");
  });

  it("keeps separate rate-limit buckets per identity", async () => {
    let current = "user-1";
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { limited: { name: "limited", rateLimit: { maxRequests: 1, windowMs: 60_000 } } },
          defaultRole: "limited",
        },
        providers: [provider("p", "https://p.test/v1")],
      },
      authorization: { resolveUserId: () => current },
    });

    const call = () => client
      .complete({ provider: "p", model: "m1", messages: [{ role: "user", content: "hi" }] })
      .then(() => 200)
      .catch(() => 429);

    expect(await call()).toBe(200);
    expect(await call()).toBe(429);
    current = "user-2";
    expect(await call()).toBe(200);
  });

  it("selects a per-user role through resolveRole", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: {
        rbac: {
          roles: {
            viewer: { name: "viewer", allowedProviders: ["openai-provider"] },
            admin: { name: "admin" },
          },
          defaultRole: "viewer",
        },
        providers: [
          provider("openai-provider", "https://openai-provider.test/v1"),
          provider("other-provider", "https://other-provider.test/v1"),
        ],
      },
      authorization: {
        resolveUserId: () => "root",
        resolveRole: (userId) => (userId === "root" ? "admin" : "viewer"),
      },
    });

    // The admin role is unrestricted, so both providers are reachable.
    expect(await client
      .complete({ provider: "other-provider", model: "m1", messages: [{ role: "user", content: "hi" }] })
    ).toBe("ok");
    expect(reached).toHaveLength(1);
  });

  it("reports an unresolvable rate limit when no identity is available", async () => {
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { limited: { name: "limited", rateLimit: { maxRequests: 1, windowMs: 60_000 } } },
          defaultRole: "limited",
        },
        providers: [provider("p", "https://p.test/v1")],
      },
    });

    for (let i = 0; i < 3; i += 1) {
      await client.complete({ provider: "p", model: "m1", messages: [{ role: "user", content: "hi" }] });
    }
    // Unkeyed means unapplied, and the SDK says so rather than implying a limit.
    expect(client.getAuthorizationDiagnostics().map((d) => d.code))
      .toContain("RBAC_RATE_LIMIT_UNKEYED");
  });

  it("resolves the identity once per request", async () => {
    let calls = 0;
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { viewer: { name: "viewer" }, admin: { name: "admin" } },
          defaultRole: "viewer",
        },
        providers: [provider("p", "https://p.test/v1")],
      },
      authorization: {
        resolveUserId: () => { calls += 1; return "user-1"; },
        resolveRole: (userId) => (userId === "root" ? "admin" : "viewer"),
      },
    });

    await client.complete({ provider: "p", model: "m1", messages: [{ role: "user", content: "hi" }] });
    expect(calls).toBe(1);
  });

  it("uses a supplied resolveBudget instead of the session tracker", async () => {
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { capped: { name: "capped", maxBudgetPerSession: 10 } },
          defaultRole: "capped",
        },
        providers: [provider("p", "https://p.test/v1")],
      },
      authorization: {
        resolveUserId: () => "user-1",
        resolveBudget: () => ({ spent: 25 }),
      },
    });

    await expect(client
      .complete({ provider: "p", model: "m1", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow();
  });

  it("bounds the authorization diagnostic log", async () => {
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: {
        rbac: {
          roles: { viewer: { name: "viewer", rateLimit: { maxRequests: 5, windowMs: 60_000 } } },
          defaultRole: "viewer",
        },
        providers: [provider("any", "https://any.test/v1")],
      },
    });
    for (let i = 0; i < 260; i += 1) {
      await client.complete({ provider: "any", model: "m1", messages: [{ role: "user", content: "hi" }] });
    }
    expect(client.getAuthorizationDiagnostics().length).toBeLessThanOrEqual(200);
  });

  it("accepts a strict policy and denies a disallowed model", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: {
        rbac: {
          roles: { viewer: { name: "viewer", allowedModels: ["allowed-*"] } },
          defaultRole: "viewer",
          enforcement: "strict",
        },
        providers: [provider("any", "https://any.test/v1")],
      },
    });

    await expect(client.complete({
      provider: "any",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow();
    expect(reached).toEqual([]);
  });

  it("behaves exactly as before when no rbac is configured", async () => {
    const reached: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(reached),
      config: { providers: [provider("any", "https://any.test/v1")] },
    });
    expect(client.getAuthorizationDiagnostics()).toEqual([]);
    await expect(client.complete({
      provider: "any",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    })).resolves.toBe("ok");
    expect(reached).toHaveLength(1);
  });

  it("keeps a caller-supplied middleware working alongside rbac", async () => {
    const seen: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: { rbac, providers: [provider("allowed-provider", "https://allowed.test/v1")] },
      middleware: async (ctx) => {
        seen.push(ctx.url);
        return ctx.next();
      },
    });

    await client.complete({
      provider: "allowed-provider",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(seen).toHaveLength(1);
  });

  it("does not run a user middleware for a request denied by rbac", async () => {
    const seen: string[] = [];
    const client = new HilbrasClient({
      transport: mockTransport(),
      config: { rbac, providers: [provider("blocked-provider", "https://blocked.test/v1")] },
      middleware: async (ctx) => {
        seen.push(ctx.url);
        return ctx.next();
      },
    });

    await client.complete({
      provider: "blocked-provider",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    }).catch(() => undefined);
    expect(seen).toEqual([]);
  });
});
