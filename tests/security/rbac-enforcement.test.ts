/**
 * @hilbras/sdk — checkPermission fails closed on an unevaluable policy (H1)
 *
 * `checkPermission` hardcoded `enforcement: "permissive"`, and permissive mode
 * skips a restriction whose subject the request did not identify. So a role
 * restricting `allowedProviders` returned `allowed: true` when the caller
 * named no provider — the gate answering "yes" to a question it could not
 * evaluate.
 */

import { describe, expect, it } from "vitest";
import { checkPermission } from "../../src/security/rbac.js";
import type { RBACRole } from "../../src/security/rbac.js";

const restricted: RBACRole = {
  name: "viewer",
  allowedProviders: ["openai"],
  allowedModels: ["gpt-4o"],
};

const unrestricted: RBACRole = { name: "admin" };

describe("checkPermission enforcement", () => {
  it("denies a provider-restricted role when no provider was identified", () => {
    const result = checkPermission(restricted, "", "gpt-4o");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("provider");
  });

  it("denies a model-restricted role when no model was identified", () => {
    const result = checkPermission(restricted, "openai", "");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("model");
  });

  it("still allows an unrestricted role with no provider identified", () => {
    expect(checkPermission(unrestricted, "", "").allowed).toBe(true);
  });

  it("still allows a permitted provider/model", () => {
    expect(checkPermission(restricted, "openai", "gpt-4o").allowed).toBe(true);
  });

  it("still denies a provider outside the allow-list", () => {
    expect(checkPermission(restricted, "anthropic", "gpt-4o").allowed).toBe(false);
  });

  it("can be relaxed back to permissive explicitly", () => {
    expect(checkPermission(restricted, "", "gpt-4o", undefined, "permissive").allowed).toBe(true);
  });
});
