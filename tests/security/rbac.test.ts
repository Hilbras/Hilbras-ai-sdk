/**
 * @hilbras/sdk — RBAC Tests
 */

import { describe, it, expect } from "vitest";
import { checkPermission } from "../../src/security/rbac.js";
import type { RBACRole } from "../../src/security/rbac.js";

describe("checkPermission", () => {
  const adminRole: RBACRole = { name: "admin" };

  const viewerRole: RBACRole = {
    name: "viewer",
    allowedProviders: ["openai"],
    allowedModels: ["gpt-4o", "gpt-4o-mini"],
    maxTokensPerRequest: 4096,
  };

  const restrictedRole: RBACRole = {
    name: "restricted",
    allowedProviders: ["openai", "anthropic"],
    allowedModels: ["gpt-*"],
  };

  it("allows all when no restrictions defined", () => {
    const result = checkPermission(adminRole, "openai", "gpt-4o");
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("admin");
  });

  it("allows matching provider", () => {
    const result = checkPermission(viewerRole, "openai", "gpt-4o");
    expect(result.allowed).toBe(true);
  });

  it("denies non-matching provider", () => {
    const result = checkPermission(viewerRole, "anthropic", "claude-3");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not allowed");
    expect(result.reason).toContain("anthropic");
  });

  it("denies non-matching model", () => {
    const result = checkPermission(viewerRole, "openai", "gpt-5");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("gpt-5");
  });

  it("allows model matching wildcard pattern", () => {
    const result = checkPermission(restrictedRole, "openai", "gpt-4o");
    expect(result.allowed).toBe(true);
  });

  it("denies model not matching wildcard pattern", () => {
    const result = checkPermission(restrictedRole, "openai", "claude-3");
    expect(result.allowed).toBe(false);
  });

  it("denies when token count exceeds limit", () => {
    const result = checkPermission(viewerRole, "openai", "gpt-4o", 8192);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Token count");
    expect(result.reason).toContain("4096");
  });

  it("allows when token count is within limit", () => {
    const result = checkPermission(viewerRole, "openai", "gpt-4o", 2048);
    expect(result.allowed).toBe(true);
  });

  it("skips token check when no limit defined", () => {
    const result = checkPermission(adminRole, "openai", "gpt-4o", 100000);
    expect(result.allowed).toBe(true);
  });

  it("skips provider/model check when arrays are empty", () => {
    const openRole: RBACRole = { name: "open", allowedProviders: [], allowedModels: [] };
    const result = checkPermission(openRole, "any-provider", "any-model");
    expect(result.allowed).toBe(true);
  });
});
