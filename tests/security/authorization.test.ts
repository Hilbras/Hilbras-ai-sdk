/**
 * @hilbras/sdk — Authorization contracts, validation, and resolution
 */

import { describe, it, expect } from "vitest";
import {
  evaluateAuthorization,
  evaluateRoleRequest,
  isStringArray,
  resolveRequestFromContext,
  validateRbacConfig,
  type AuthorizationDiagnostic,
  type RBACConfig,
} from "../../src/security/authorization.js";
import { resolveConfig } from "../../src/config/config-resolver.js";
import { createRuntimeSource } from "../../src/config/sources/runtime.js";
import { ConfigurationError } from "../../src/errors/index.js";
import type { MiddlewareContext } from "../../src/middleware/middleware.js";

const ctx = (url: string, body?: unknown): MiddlewareContext => ({
  url,
  init: {
    method: "POST",
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
  },
  next: async () => new Response("ok", { status: 200 }),
});

const codes = (issues: AuthorizationDiagnostic[]): string[] => issues.map((i) => i.code);

describe("isStringArray", () => {
  it("accepts an empty array and an array of non-empty strings", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["a", "b"])).toBe(true);
  });

  it("rejects non-arrays and arrays with empty or non-string entries", () => {
    expect(isStringArray("gpt-4o")).toBe(false);
    expect(isStringArray({})).toBe(false);
    expect(isStringArray(42)).toBe(false);
    expect(isStringArray([""])).toBe(false);
    expect(isStringArray(["a", 1])).toBe(false);
  });
});

describe("validateRbacConfig", () => {
  it("accepts a well-formed policy", () => {
    expect(validateRbacConfig({
      roles: {
        viewer: {
          name: "viewer",
          allowedProviders: ["openai"],
          allowedModels: ["gpt-*"],
          maxTokensPerRequest: 4096,
          allowedTools: ["search"],
          deniedTools: ["shell"],
          rateLimit: { maxRequests: 10, windowMs: 60_000 },
        },
      },
      defaultRole: "viewer",
      enforcement: "strict",
    })).toEqual([]);
  });

  it("rejects a non-object policy and a missing roles map", () => {
    expect(codes(validateRbacConfig("nope"))).toContain("RBAC_INVALID_ROLES");
    expect(codes(validateRbacConfig({}))).toContain("RBAC_INVALID_ROLES");
    expect(codes(validateRbacConfig({ roles: {} }))).toContain("RBAC_INVALID_ROLES");
  });

  it("requires the role name to match its key", () => {
    const issues = validateRbacConfig({ roles: { viewer: { name: "guest" } } });
    expect(codes(issues)).toContain("RBAC_INVALID_ROLE");
    expect(issues[0].path).toBe("rbac.roles.viewer.name");
  });

  it("rejects restriction lists that are not arrays of non-empty strings", () => {
    for (const field of ["allowedProviders", "allowedModels", "allowedTools", "deniedTools"]) {
      const issues = validateRbacConfig({ roles: { v: { name: "v", [field]: "gpt-4o" } } });
      expect(codes(issues), field).toContain("RBAC_INVALID_RESTRICTION_LIST");
    }
  });

  it("rejects non-numeric or negative limits", () => {
    expect(codes(validateRbacConfig({ roles: { v: { name: "v", maxTokensPerRequest: "4096" } } })))
      .toContain("RBAC_INVALID_NUMERIC_LIMIT");
    expect(codes(validateRbacConfig({ roles: { v: { name: "v", maxBudgetPerSession: -1 } } })))
      .toContain("RBAC_INVALID_NUMERIC_LIMIT");
  });

  it("rejects an invalid rate limit", () => {
    expect(codes(validateRbacConfig({ roles: { v: { name: "v", rateLimit: { maxRequests: 0, windowMs: 1000 } } } })))
      .toContain("RBAC_INVALID_RATE_LIMIT");
    expect(codes(validateRbacConfig({ roles: { v: { name: "v", rateLimit: { maxRequests: 5 } } } })))
      .toContain("RBAC_INVALID_RATE_LIMIT");
  });

  it("rejects overlapping tool lists within a role", () => {
    const issues = validateRbacConfig({
      roles: { v: { name: "v", allowedTools: ["search"], deniedTools: ["search"] } },
    });
    expect(codes(issues)).toContain("RBAC_TOOL_POLICY_CONFLICT");
  });

  it("rejects an unknown enforcement mode", () => {
    expect(codes(validateRbacConfig({ roles: { v: { name: "v" } }, enforcement: "locked" })))
      .toContain("RBAC_INVALID_ENFORCEMENT");
  });

  it("rejects a defaultRole that is not defined (the silent-bypass typo)", () => {
    const issues = validateRbacConfig({ roles: { viewer: { name: "viewer" } }, defaultRole: "viewr" });
    expect(codes(issues)).toContain("RBAC_UNKNOWN_DEFAULT_ROLE");
    expect(issues[0].message).toContain("viewr");
  });
});

describe("config resolver integration", () => {
  it("rejects a malformed rbac block in strict mode", () => {
    expect(() =>
      resolveConfig({
        sources: [createRuntimeSource({ rbac: { roles: { v: { name: "v", allowedModels: "gpt-4o" } } } })],
        strict: true,
      }),
    ).toThrow(ConfigurationError);
  });

  it("reports a redacted diagnostic path for the offending field", () => {
    const resolved = resolveConfig({
      sources: [createRuntimeSource({
        rbac: { roles: { v: { name: "v", rateLimit: { maxRequests: 0, windowMs: 0 } } } },
      })],
      strict: false,
    });
    const issue = resolved.diagnostics.find((d) => d.code === "RBAC_INVALID_RATE_LIMIT");
    expect(issue?.path).toBe("rbac.roles.v.rateLimit");
    expect(issue?.severity).toBe("error");
  });

  it("accepts a valid rbac block without diagnostics", () => {
    const resolved = resolveConfig({
      sources: [createRuntimeSource({
        rbac: { roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } }, defaultRole: "viewer" },
      })],
      strict: true,
    });
    expect(resolved.values.rbac?.defaultRole).toBe("viewer");
    expect(resolved.diagnostics).toEqual([]);
  });
});

describe("resolveRequestFromContext", () => {
  it("derives the provider from the URL and the model from the body", () => {
    const resolved = resolveRequestFromContext(
      ctx("https://api.openai.com/v1/chat/completions", { model: "gpt-4o", max_tokens: 128 }),
      (url) => (url.includes("openai.com") ? "openai" : null),
    );
    expect(resolved).toEqual({ provider: "openai", model: "gpt-4o", tokenCount: 128, toolName: undefined });
  });

  it("lets an explicit provider in the body win over the URL", () => {
    const resolved = resolveRequestFromContext(
      ctx("https://api.openai.com/v1/chat/completions", { provider: "custom", model: "m" }),
      () => "openai",
    );
    expect(resolved?.provider).toBe("custom");
  });

  it("returns null when nothing identifying is available", () => {
    expect(resolveRequestFromContext(ctx("https://api.openai.com/v1/chat/completions"), () => null)).toBeNull();
    expect(resolveRequestFromContext(ctx("https://api.openai.com/v1/chat/completions"))).toBeNull();
  });

  it("survives a throwing URL resolver and a non-JSON body", () => {
    const throwing = resolveRequestFromContext(
      { ...ctx("https://x.test"), init: { method: "POST", headers: {}, body: "not-json" } },
      () => { throw new Error("boom"); },
    );
    expect(throwing).toBeNull();
  });

  it("extracts a tool name from a tool-invocation body", () => {
    const resolved = resolveRequestFromContext(
      ctx("https://api.openai.com/v1/chat/completions", { tool: "search", model: "gpt-4o" }),
      () => "openai",
    );
    expect(resolved?.toolName).toBe("search");
  });
});

describe("evaluateRoleRequest", () => {
  const report = (): void => {};

  it("denies a disallowed provider and model", () => {
    const denied = evaluateRoleRequest({
      role: { name: "v", allowedProviders: ["openai"], allowedModels: ["gpt-*"] },
      roleName: "v",
      request: { provider: "anthropic", model: "claude-3" },
      enforcement: "permissive",
      report,
    });
    expect(denied.allow).toBe(false);
    expect(denied.status).toBe(403);
    expect(denied.reason).toContain("anthropic");
  });

  it("denies a denied tool and an out-of-allowlist tool", () => {
    const deniedTool = evaluateRoleRequest({
      role: { name: "v", deniedTools: ["shell"] },
      roleName: "v",
      request: { provider: "openai", model: "gpt-4o", toolName: "shell" },
      enforcement: "permissive",
      report,
    });
    expect(deniedTool.allow).toBe(false);

    const outsideAllow = evaluateRoleRequest({
      role: { name: "v", allowedTools: ["search"] },
      roleName: "v",
      request: { provider: "openai", model: "gpt-4o", toolName: "delete" },
      enforcement: "permissive",
      report,
    });
    expect(outsideAllow.allow).toBe(false);
  });

  it("treats an empty restriction list as unrestricted", () => {
    const verdict = evaluateRoleRequest({
      role: { name: "v", allowedProviders: [], allowedModels: [], allowedTools: [] },
      roleName: "v",
      request: { provider: "anything", model: "anything", toolName: "anything" },
      enforcement: "permissive",
      report,
    });
    expect(verdict.allow).toBe(true);
  });

  it("denies a malformed restriction list instead of allowing", () => {
    const verdict = evaluateRoleRequest({
      role: { name: "v", allowedModels: "gpt-4o" as never },
      roleName: "v",
      request: { provider: "openai", model: "gpt-4o" },
      enforcement: "permissive",
      report,
    });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain("invalid");
  });

  it("skips a provider check it cannot evaluate in permissive mode and denies in strict mode", () => {
    const request = { provider: "", model: "gpt-4o" };
    const permissive = evaluateRoleRequest({
      role: { name: "v", allowedProviders: ["openai"] },
      roleName: "v",
      request,
      enforcement: "permissive",
      report,
    });
    expect(permissive.allow).toBe(true);
    expect(permissive.unresolved).toBe(false);

    const strict = evaluateRoleRequest({
      role: { name: "v", allowedProviders: ["openai"] },
      roleName: "v",
      request,
      enforcement: "strict",
      report,
    });
    expect(strict.allow).toBe(false);
    expect(strict.status).toBe(403);
  });

  it("enforces the token limit only when the request carried a token count", () => {
    const role = { name: "v", maxTokensPerRequest: 100 };
    expect(evaluateRoleRequest({
      role, roleName: "v", request: { provider: "openai", model: "gpt-4o" }, enforcement: "permissive", report,
    }).allow).toBe(true);
    expect(evaluateRoleRequest({
      role, roleName: "v", request: { provider: "openai", model: "gpt-4o", tokenCount: 101 }, enforcement: "permissive", report,
    }).allow).toBe(false);
  });
});

describe("evaluateAuthorization", () => {
  const report = (): void => {};
  const role = { name: "v", allowedProviders: ["openai"] };

  it("allows a resolved request that satisfies the policy", () => {
    const verdict = evaluateAuthorization({
      role,
      roleName: "v",
      request: { provider: "openai", model: "gpt-4o" },
      enforcement: "permissive",
      userId: "u1",
      report,
    });
    expect(verdict).toMatchObject({ allow: true, unresolved: false, role: "v" });
  });

  it("allows an unresolved context in permissive mode and denies it in strict mode", () => {
    const permissive = evaluateAuthorization({
      role, roleName: "v", request: null, enforcement: "permissive", userId: "u1", report,
    });
    expect(permissive.allow).toBe(true);
    expect(permissive.unresolved).toBe(true);

    const strict = evaluateAuthorization({
      role, roleName: "v", request: null, enforcement: "strict", userId: "u1", report,
    });
    expect(strict.allow).toBe(false);
    expect(strict.status).toBe(403);
  });

  it("allows a missing role in permissive mode and denies it in strict mode", () => {
    expect(evaluateAuthorization({
      role: null, roleName: null, request: { provider: "openai", model: "m" },
      enforcement: "permissive", userId: null, report,
    }).allow).toBe(true);

    expect(evaluateAuthorization({
      role: null, roleName: null, request: { provider: "openai", model: "m" },
      enforcement: "strict", userId: null, report,
    }).status).toBe(403);
  });

  it("reports rather than claims a budget it cannot enforce", () => {
    const diagnostics: AuthorizationDiagnostic[] = [];
    const withBudget: RBACConfig["roles"][string] = { name: "v", maxBudgetPerSession: 1 };
    const permissive = evaluateAuthorization({
      role: withBudget, roleName: "v", request: { provider: "openai", model: "m" },
      enforcement: "permissive", userId: "u1", budget: null, report: (d) => diagnostics.push(d),
    });
    expect(permissive.allow).toBe(true);
    expect(diagnostics.map((d) => d.code)).toContain("RBAC_BUDGET_NOT_ENFORCED");

    const strict = evaluateAuthorization({
      role: withBudget, roleName: "v", request: { provider: "openai", model: "m" },
      enforcement: "strict", userId: "u1", budget: null, report: () => {},
    });
    expect(strict.status).toBe(403);
  });

  it("denies once the reported spend reaches the declared session budget", () => {
    const verdict = evaluateAuthorization({
      role: { name: "v", maxBudgetPerSession: 10 }, roleName: "v",
      request: { provider: "openai", model: "m" },
      enforcement: "permissive", userId: "u1", budget: { spent: 10 }, report,
    });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain("session budget");
  });
});
