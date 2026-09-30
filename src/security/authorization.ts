/**
 * @hilbras/sdk — Authorization contracts and evaluation
 *
 * This module owns the authorization vocabulary for the SDK: role and policy
 * shapes, the request context a decision is made against, the enforcement
 * modes, diagnostics, and pure policy evaluation.
 *
 * Enforcement modes:
 *
 * - `"permissive"` (default) allows a request whose context cannot be fully
 *   resolved and records a diagnostic. Explicit denials (disallowed provider,
 *   model, or tool) and rate-limit rejections still return 403/429.
 * - `"strict"` denies with 403 any request whose context cannot be resolved,
 *   including a missing role, an unknown role, an unidentifiable provider, or
 *   a resolver that throws.
 *
 * The pure evaluators here never perform I/O and never construct a `Response`;
 * {@link createRBACMiddleware} composes them with transport concerns.
 */

import type { MiddlewareContext } from "../middleware/middleware.js";
import type { AuditLogger } from "./audit-logger.js";
import type { RateLimiterRegistry } from "./rate-limiter.js";

// ─── Policy vocabulary ──────────────────────────────────────────────────────

/** How the middleware treats a request context it cannot fully resolve. */
export type AuthorizationEnforcement = "permissive" | "strict";

/** A role definition with access constraints. */
export interface RBACRole {
  /** Role name. Must match the key it is registered under. */
  name: string;
  /** Allowed provider names (empty or absent = all providers allowed) */
  allowedProviders?: string[];
  /** Allowed model patterns; a trailing `*` is a prefix match (absent = all) */
  allowedModels?: string[];
  /** Maximum tokens per request (undefined = no limit) */
  maxTokensPerRequest?: number;
  /** Maximum budget per session in dollars (undefined = no limit) */
  maxBudgetPerSession?: number;
  /** Per-role request rate limit */
  rateLimit?: {
    /** Maximum requests within the window */
    maxRequests: number;
    /** Window duration in milliseconds */
    windowMs: number;
  };
  /** Allowed tool names (empty or absent = all tools allowed) */
  allowedTools?: string[];
  /** Tool names that are always denied for this role */
  deniedTools?: string[];
}

/** Authorization configuration. */
export interface RBACConfig {
  /** Map of role name to role definition */
  roles: Record<string, RBACRole>;
  /** Role applied when no explicit role is resolved (default: `"default"`) */
  defaultRole?: string;
  /** How to treat an unresolvable request context (default: `"permissive"`) */
  enforcement?: AuthorizationEnforcement;
}

/** The facts an authorization decision is made against. */
export interface RBACRequestContext {
  /** Provider name, or `""` when it could not be identified */
  provider: string;
  /** Model name, or `""` when the request did not carry one */
  model: string;
  /** Requested token count, when the body carried a numeric `max_tokens` */
  tokenCount?: number;
  /** Tool name, when the request is a tool invocation */
  toolName?: string;
}

/** Spend attributed to a role, used to enforce `maxBudgetPerSession`. */
export interface AuthorizationBudgetView {
  /** Dollars already spent for this role and user */
  spent: number;
  /** Dollar ceiling; when absent the role's own limit is used */
  limit?: number;
}

/** Supplies a budget view so a declared `maxBudgetPerSession` can be enforced. */
export type ResolveAuthorizationBudget = (input: {
  ctx: MiddlewareContext;
  role: RBACRole;
  roleName: string;
  userId: string | null;
}) => AuthorizationBudgetView | null | undefined;

/** Resolves the provider name implied by a request URL. */
export type ResolveProviderByUrl = (url: string) => string | null | undefined;

/** Options accepted by the authorization middleware. */
export interface AuthorizationOptions {
  /** Enforcement mode override; defaults to `config.enforcement`. */
  enforcement?: AuthorizationEnforcement;
  /**
   * Resolve the caller's role name from the request. When omitted, the
   * middleware falls back to `config.defaultRole ?? "default"`, which is the
   * behavior of every release before v3.4.0.
   */
  resolveRole?: (ctx: MiddlewareContext) => string | null | undefined;
  /**
   * Resolve the request context. When omitted, the provider is resolved from
   * the request URL and `model` / `max_tokens` are read from a JSON body.
   */
  resolveRequest?: (ctx: MiddlewareContext) => RBACRequestContext | null | undefined;
  /** Resolves a provider name from a request URL. */
  resolveProviderByUrl?: ResolveProviderByUrl;
  /** Supplies a budget view for `maxBudgetPerSession` enforcement. */
  resolveBudget?: ResolveAuthorizationBudget;
  /** Audit logger for denial and rate-limit events. */
  auditLogger?: AuditLogger;
  /** Rate limiter registry (created automatically if not provided). */
  rateLimiters?: RateLimiterRegistry;
  /** Clock injection for deterministic tests. */
  now?: () => number;
  /** Receives every diagnostic in decision order. */
  onDiagnostic?: (diagnostic: AuthorizationDiagnostic) => void;
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

export type AuthorizationDiagnosticSeverity = "info" | "warning" | "error";

/**
 * A redacted note about an authorization decision or policy problem. Messages
 * never contain credential material.
 */
export interface AuthorizationDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: AuthorizationDiagnosticSeverity;
  role?: string;
  userId?: string;
}

/** Result of evaluating a single request against a single role. */
export interface AuthorizationVerdict {
  allow: boolean;
  status?: 403 | 429;
  reason?: string;
  retryAfterMs?: number;
  role?: string;
  /**
   * True when the verdict came from a context the middleware could not fully
   * resolve rather than from an explicit policy violation.
   */
  unresolved: boolean;
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** An array whose every element is a non-empty string. Empty arrays are valid. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ─── Configuration validation ───────────────────────────────────────────────

/**
 * Validate an `rbac` configuration block. Returns one error diagnostic per
 * problem so the configuration resolver can reject a malformed policy at
 * construction time instead of letting it degrade to "no restrictions" at
 * request time.
 */
export function validateRbacConfig(value: unknown, basePath = "rbac"): AuthorizationDiagnostic[] {
  const issues: AuthorizationDiagnostic[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message, severity: "error" });
  };

  if (!isPlainObject(value)) {
    add("RBAC_INVALID_ROLES", basePath, `${basePath} must be an object`);
    return issues;
  }

  const roles = value.roles;
  if (!isPlainObject(roles)) {
    add("RBAC_INVALID_ROLES", `${basePath}.roles`, `${basePath}.roles must be an object`);
    return issues;
  }
  if (Object.keys(roles).length === 0) {
    add("RBAC_INVALID_ROLES", `${basePath}.roles`, `${basePath}.roles must define at least one role`);
  }

  for (const [key, raw] of Object.entries(roles)) {
    const path = `${basePath}.roles.${key}`;
    if (!isPlainObject(raw)) {
      add("RBAC_INVALID_ROLE", path, `role "${key}" must be an object`);
      continue;
    }
    const role = raw;

    if (typeof role.name !== "string" || role.name.length === 0) {
      add("RBAC_INVALID_ROLE", `${path}.name`, `role "${key}" must declare a non-empty name`);
    } else if (role.name !== key) {
      add("RBAC_INVALID_ROLE", `${path}.name`, `role name "${role.name}" must match its key "${key}"`);
    }

    for (const field of ["allowedProviders", "allowedModels", "allowedTools", "deniedTools"] as const) {
      const list = role[field];
      if (list === undefined) continue;
      if (!isStringArray(list)) {
        add(
          "RBAC_INVALID_RESTRICTION_LIST",
          `${path}.${field}`,
          `${field} must be an array of non-empty strings`,
        );
      }
    }

    for (const field of ["maxTokensPerRequest", "maxBudgetPerSession"] as const) {
      const limit = role[field];
      if (limit === undefined) continue;
      if (!isFiniteNonNegative(limit)) {
        add(
          "RBAC_INVALID_NUMERIC_LIMIT",
          `${path}.${field}`,
          `${field} must be a finite non-negative number`,
        );
      }
    }

    const rateLimit = role.rateLimit;
    if (rateLimit !== undefined) {
      const valid =
        isPlainObject(rateLimit) &&
        typeof rateLimit.maxRequests === "number" &&
        Number.isFinite(rateLimit.maxRequests) &&
        rateLimit.maxRequests >= 1 &&
        typeof rateLimit.windowMs === "number" &&
        Number.isFinite(rateLimit.windowMs) &&
        rateLimit.windowMs >= 1;
      if (!valid) {
        add(
          "RBAC_INVALID_RATE_LIMIT",
          `${path}.rateLimit`,
          "rateLimit requires maxRequests >= 1 and windowMs >= 1",
        );
      }
    }

    if (isStringArray(role.allowedTools) && isStringArray(role.deniedTools)) {
      const denied = new Set(role.deniedTools);
      if (role.allowedTools.some((tool) => denied.has(tool))) {
        add(
          "RBAC_TOOL_POLICY_CONFLICT",
          `${path}.allowedTools`,
          "allowedTools and deniedTools must not overlap",
        );
      }
    }
  }

  const enforcement = value.enforcement;
  if (enforcement !== undefined && enforcement !== "permissive" && enforcement !== "strict") {
    add(
      "RBAC_INVALID_ENFORCEMENT",
      `${basePath}.enforcement`,
      'enforcement must be "permissive" or "strict"',
    );
  }

  const defaultRole = value.defaultRole;
  if (defaultRole !== undefined) {
    if (typeof defaultRole !== "string" || defaultRole.length === 0) {
      add("RBAC_UNKNOWN_DEFAULT_ROLE", `${basePath}.defaultRole`, "defaultRole must be a non-empty string");
    } else if (!(defaultRole in roles)) {
      add(
        "RBAC_UNKNOWN_DEFAULT_ROLE",
        `${basePath}.defaultRole`,
        `defaultRole "${defaultRole}" is not defined in ${basePath}.roles`,
      );
    }
  }

  return issues;
}

// ─── Request context resolution ─────────────────────────────────────────────

/**
 * Default request-context resolution.
 *
 * Provider identity comes from the request URL, because no SDK adapter puts
 * `provider` in the request body. `model`, `max_tokens`, and an optional tool
 * name are read from a JSON body when one is present. Returns `null` when
 * nothing identifying could be determined.
 */
export function resolveRequestFromContext(
  ctx: MiddlewareContext,
  resolveProviderByUrl?: ResolveProviderByUrl,
): RBACRequestContext | null {
  let provider = "";
  if (resolveProviderByUrl) {
    try {
      provider = resolveProviderByUrl(ctx.url) ?? "";
    } catch {
      provider = "";
    }
  }

  let model = "";
  let tokenCount: number | undefined;
  let toolName: string | undefined;

  const body = ctx.init.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.provider === "string" && parsed.provider.length > 0) {
        provider = parsed.provider;
      }
      if (typeof parsed.model === "string") model = parsed.model;
      if (typeof parsed.max_tokens === "number" && Number.isFinite(parsed.max_tokens)) {
        tokenCount = parsed.max_tokens;
      }
      const tool = parsed.tool ?? parsed.tool_name ?? parsed.name;
      if (typeof tool === "string" && tool.length > 0) toolName = tool;
    } catch {
      // Body is not JSON; the URL-derived provider is still usable.
    }
  }

  if (provider.length === 0 && model.length === 0) return null;
  return { provider, model, tokenCount, toolName };
}

// ─── Policy evaluation ──────────────────────────────────────────────────────

function deny(reason: string, role: string): AuthorizationVerdict {
  return { allow: false, status: 403, reason, role, unresolved: false };
}

function matchesModel(model: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? model.startsWith(pattern.slice(0, -1)) : model === pattern,
  );
}

/**
 * Evaluate a resolved request against one role. Pure: performs no I/O and
 * reports policy problems through `report` rather than throwing.
 */
export function evaluateRoleRequest(input: {
  role: RBACRole;
  roleName: string;
  request: RBACRequestContext;
  enforcement: AuthorizationEnforcement;
  report: (diagnostic: AuthorizationDiagnostic) => void;
}): AuthorizationVerdict {
  const { role, roleName, request, enforcement, report } = input;
  const unresolvedCode = "RBAC_UNRESOLVED_CONTEXT";

  // A declared restriction whose subject could not be identified cannot be
  // evaluated. Permissive mode skips the check and says so; strict mode denies.
  const handleUnresolved = (field: string, subject: string): AuthorizationVerdict | null => {
    report({
      code: unresolvedCode,
      message: `cannot evaluate ${field} for role "${roleName}" because the request did not identify a ${subject}`,
      path: field,
      severity: "warning",
      role: roleName,
    });
    return enforcement === "strict"
      ? deny(`request did not identify a ${subject} required by role "${roleName}"`, roleName)
      : null;
  };

  if (role.allowedProviders !== undefined) {
    if (!isStringArray(role.allowedProviders)) {
      report({
        code: "RBAC_INVALID_POLICY",
        message: `allowedProviders for role "${roleName}" must be an array of strings`,
        path: "allowedProviders",
        severity: "error",
        role: roleName,
      });
      return deny(`policy for role "${roleName}" is invalid`, roleName);
    }
    if (role.allowedProviders.length > 0) {
      if (request.provider.length === 0) {
        const handled = handleUnresolved("allowedProviders", "provider");
        if (handled) return handled;
      } else if (!role.allowedProviders.includes(request.provider)) {
        return deny(
          `Provider "${request.provider}" is not allowed for role "${roleName}". Allowed: ${role.allowedProviders.join(", ")}`,
          roleName,
        );
      }
    }
  }

  if (role.allowedModels !== undefined) {
    if (!isStringArray(role.allowedModels)) {
      report({
        code: "RBAC_INVALID_POLICY",
        message: `allowedModels for role "${roleName}" must be an array of strings`,
        path: "allowedModels",
        severity: "error",
        role: roleName,
      });
      return deny(`policy for role "${roleName}" is invalid`, roleName);
    }
    if (role.allowedModels.length > 0) {
      if (request.model.length === 0) {
        const handled = handleUnresolved("allowedModels", "model");
        if (handled) return handled;
      } else if (!matchesModel(request.model, role.allowedModels)) {
        return deny(
          `Model "${request.model}" is not allowed for role "${roleName}". Allowed: ${role.allowedModels.join(", ")}`,
          roleName,
        );
      }
    }
  }

  if (role.allowedTools !== undefined && !isStringArray(role.allowedTools)) {
    report({
      code: "RBAC_INVALID_POLICY",
      message: `allowedTools for role "${roleName}" must be an array of strings`,
      path: "allowedTools",
      severity: "error",
      role: roleName,
    });
    return deny(`policy for role "${roleName}" is invalid`, roleName);
  }
  if (role.deniedTools !== undefined && !isStringArray(role.deniedTools)) {
    report({
      code: "RBAC_INVALID_POLICY",
      message: `deniedTools for role "${roleName}" must be an array of strings`,
      path: "deniedTools",
      severity: "error",
      role: roleName,
    });
    return deny(`policy for role "${roleName}" is invalid`, roleName);
  }

  if (request.toolName !== undefined && request.toolName.length > 0) {
    if (role.deniedTools?.includes(request.toolName)) {
      return deny(`Tool "${request.toolName}" is denied for role "${roleName}"`, roleName);
    }
    if (
      role.allowedTools !== undefined &&
      role.allowedTools.length > 0 &&
      !role.allowedTools.includes(request.toolName)
    ) {
      return deny(
        `Tool "${request.toolName}" is not allowed for role "${roleName}". Allowed: ${role.allowedTools.join(", ")}`,
        roleName,
      );
    }
  }

  if (role.maxTokensPerRequest !== undefined) {
    if (!isFiniteNonNegative(role.maxTokensPerRequest)) {
      report({
        code: "RBAC_INVALID_POLICY",
        message: `maxTokensPerRequest for role "${roleName}" must be a finite non-negative number`,
        path: "maxTokensPerRequest",
        severity: "error",
        role: roleName,
      });
      return deny(`policy for role "${roleName}" is invalid`, roleName);
    }
    if (request.tokenCount !== undefined && request.tokenCount > role.maxTokensPerRequest) {
      return deny(
        `Token count ${request.tokenCount} exceeds limit of ${role.maxTokensPerRequest} for role "${roleName}"`,
        roleName,
      );
    }
  }

  return { allow: true, role: roleName, unresolved: false };
}

/**
 * Full authorization decision for one request, excluding rate limiting, which
 * the middleware applies because it mutates limiter state.
 */
export function evaluateAuthorization(input: {
  role: RBACRole | null;
  roleName: string | null;
  request: RBACRequestContext | null;
  enforcement: AuthorizationEnforcement;
  budget?: AuthorizationBudgetView | null | undefined;
  userId: string | null;
  report: (diagnostic: AuthorizationDiagnostic) => void;
}): AuthorizationVerdict {
  const { role, roleName, request, enforcement, budget, userId, report } = input;

  if (role === null || roleName === null) {
    report({
      code: "RBAC_UNRESOLVED_ROLE",
      message: userId === null
        ? "no request identity was resolved and no default role is configured"
        : `no role could be resolved for the request`,
      path: "defaultRole",
      severity: "warning",
      userId: userId ?? undefined,
    });
    return enforcement === "strict"
      ? { allow: false, status: 403, reason: "no role could be resolved for this request", unresolved: true }
      : { allow: true, unresolved: true };
  }

  if (role.maxBudgetPerSession !== undefined) {
    const limit = budget?.limit ?? role.maxBudgetPerSession;
    if (budget === null || budget === undefined) {
      report({
        code: "RBAC_BUDGET_NOT_ENFORCED",
        message: `role "${roleName}" declares maxBudgetPerSession but no budget source is configured, so the limit is not enforced`,
        path: "maxBudgetPerSession",
        severity: "warning",
        role: roleName,
        userId: userId ?? undefined,
      });
      if (enforcement === "strict") {
        return {
          allow: false,
          status: 403,
          reason: `role "${roleName}" requires a budget source that is not configured`,
          role: roleName,
          unresolved: true,
        };
      }
    } else if (budget.spent >= limit) {
      return {
        allow: false,
        status: 403,
        reason: `Spend of ${budget.spent} reaches the session budget limit of ${limit} for role "${roleName}"`,
        role: roleName,
        unresolved: false,
      };
    }
  }

  if (request === null) {
    report({
      code: "RBAC_UNRESOLVED_CONTEXT",
      message: `request context could not be resolved, so provider and model restrictions for role "${roleName}" were not evaluated`,
      path: "$",
      severity: "warning",
      role: roleName,
      userId: userId ?? undefined,
    });
    return enforcement === "strict"
      ? {
          allow: false,
          status: 403,
          reason: `request context could not be resolved for role "${roleName}"`,
          role: roleName,
          unresolved: true,
        }
      : { allow: true, role: roleName, unresolved: true };
  }

  return evaluateRoleRequest({ role, roleName, request, enforcement, report });
}
