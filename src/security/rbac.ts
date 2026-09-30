/**
 * @hilbras/sdk — Role-Based Access Control (RBAC)
 *
 * Provides role definitions, permission checking, and RBAC middleware for
 * controlling which providers, models, and tools each caller may use.
 *
 * The policy vocabulary and the pure evaluators live in
 * `security/authorization.ts`. This module keeps the historical public surface
 * (`RBACRole`, `RBACConfig`, `checkPermission`, `createRBACMiddleware`) and
 * adds transport concerns — rate limiting, audit attribution, and response
 * construction.
 */

import type { Middleware, MiddlewareContext } from "../middleware/middleware.js";
import { RateLimiterRegistry } from "./rate-limiter.js";
import {
  evaluateAuthorization,
  resolveRequestFromContext,
  type AuthorizationDiagnostic,
  type AuthorizationOptions,
  type RBACConfig,
  type RBACRequestContext,
  type RBACRole,
} from "./authorization.js";

export type { RBACRole, RBACConfig } from "./authorization.js";
export type {
  AuthorizationBudgetView,
  AuthorizationDiagnostic,
  AuthorizationEnforcement,
  AuthorizationOptions,
  AuthorizationVerdict,
  RBACRequestContext,
} from "./authorization.js";
export {
  evaluateAuthorization,
  evaluateRoleRequest,
  resolveRequestFromContext,
  validateRbacConfig,
} from "./authorization.js";

/** @deprecated Use RBACRole instead */
export type Role = RBACRole;

/** Result of a permission check */
export interface PermissionCheck {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason if denied */
  reason?: string;
  /** The role that was checked */
  role: string;
}

/**
 * Check if a role has permission to use a specific provider/model.
 *
 * A role that declares no restrictions allows everything. A role whose policy
 * is malformed denies, because an invalid policy must never be treated as an
 * absent one.
 */
export function checkPermission(
  role: RBACRole,
  provider: string,
  model: string,
  tokenCount?: number,
): PermissionCheck {
  const verdict = evaluateAuthorization({
    role,
    roleName: role.name,
    request: { provider, model, tokenCount },
    enforcement: "permissive",
    userId: null,
    report: () => {},
  });

  if (verdict.allow) return { allowed: true, role: role.name };
  return { allowed: false, reason: verdict.reason, role: role.name };
}

function jsonResponse(status: number, payload: Record<string, unknown>, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Create RBAC middleware that enforces role-based access control.
 *
 * The `getUserId` callback extracts the caller identity from the request. Pass
 * `options.resolveRole` to map that identity onto a role name; without it the
 * middleware applies `config.defaultRole`, which is the behavior of every
 * release before v3.4.0.
 *
 * Enforcement is `"permissive"` by default: a request whose context cannot be
 * resolved is allowed and recorded as a diagnostic, while explicit policy
 * violations and rate-limit rejections still return 403/429. Set
 * `enforcement: "strict"` to deny any unresolvable context with 403.
 *
 * @example
 * ```ts
 * const rbacMiddleware = createRBACMiddleware(
 *   {
 *     roles: {
 *       viewer: { name: "viewer", allowedProviders: ["openai"], maxTokensPerRequest: 4096 },
 *       admin: { name: "admin" },
 *     },
 *     defaultRole: "viewer",
 *     enforcement: "strict",
 *   },
 *   (ctx) => extractUserIdFromHeader(ctx.init),
 *   { resolveRole: (ctx) => roleForUser(extractUserIdFromHeader(ctx.init)) },
 * );
 *
 * const client = new HilbrasClient({ middleware: rbacMiddleware });
 * ```
 */
export function createRBACMiddleware(
  config: RBACConfig,
  getUserId: (ctx: MiddlewareContext) => string | null,
  options?: AuthorizationOptions,
): Middleware {
  const rateLimiters = options?.rateLimiters ?? new RateLimiterRegistry();
  const auditLogger = options?.auditLogger;

  return async (ctx: MiddlewareContext): Promise<Response> => {
    const report = (diagnostic: AuthorizationDiagnostic): void => {
      options?.onDiagnostic?.(diagnostic);
    };

    const enforcement = options?.enforcement ?? config.enforcement ?? "permissive";

    // Resolve the caller identity. A resolver that throws is reported rather
    // than propagated, so an identity backend outage cannot bypass policy.
    let userId: string | null = null;
    if (typeof getUserId === "function") {
      try {
        userId = getUserId(ctx) ?? null;
      } catch {
        report({
          code: "RBAC_IDENTITY_RESOLVER_FAILED",
          message: "the identity resolver threw; treating the request as unidentified",
          path: "$",
          severity: "warning",
        });
      }
    }

    // Resolve the role name. A resolver returning nothing falls back to the
    // default role, which preserves pre-v3.4.0 behavior for anonymous callers.
    let roleName: string | null = null;
    if (options?.resolveRole) {
      try {
        const resolved = options.resolveRole(ctx);
        if (typeof resolved === "string" && resolved.length > 0) roleName = resolved;
      } catch {
        report({
          code: "RBAC_ROLE_RESOLVER_FAILED",
          message: "the role resolver threw; falling back to the default role",
          path: "defaultRole",
          severity: "warning",
          userId: userId ?? undefined,
        });
      }
    }
    if (roleName === null) roleName = config.defaultRole ?? "default";

    const role = config.roles?.[roleName] ?? null;
    if (roleName === null || role === null) {
      report({
        code: "RBAC_UNRESOLVED_ROLE",
        message: `role "${roleName}" is not defined in the configured roles`,
        path: "defaultRole",
        severity: "warning",
        userId: userId ?? undefined,
      });
    }

    // Rate limiting runs before the permission check because it does not depend
    // on the request context, and an allowed-then-denied request must still
    // count against the limit.
    if (role?.rateLimit) {
      if (userId === null) {
        report({
          code: "RBAC_RATE_LIMIT_UNKEYED",
          message: `role "${role.name}" declares a rate limit but no request identity was resolved, so the limit was not applied`,
          path: "rateLimit",
          severity: "warning",
          role: role.name,
        });
      } else {
        const limiter = rateLimiters.getOrCreate(`rbac:${userId}:${role.name}`, {
          maxTokens: role.rateLimit.maxRequests,
          refillRate: role.rateLimit.maxRequests / (role.rateLimit.windowMs / 1000),
        });
        const result = limiter.tryConsume();
        if (!result.allowed) {
          auditLogger?.logSecurity({
            eventType: "rate_limit",
            action: "rbac_rate_limit",
            userId,
            description: `Rate limit exceeded (role: ${role.name})`,
            severity: "warning",
            meta: { role: role.name, retryAfterMs: result.retryAfterMs },
          });
          return jsonResponse(
            429,
            { error: "Rate limit exceeded", retryAfterMs: result.retryAfterMs },
            { "Retry-After": String(Math.ceil((result.retryAfterMs || 1000) / 1000)) },
          );
        }
      }
    }

    // Resolve the request context. Provider identity comes from the URL, since
    // no adapter places `provider` in the request body.
    let request: RBACRequestContext | null = null;
    try {
      request = options?.resolveRequest
        ? options.resolveRequest(ctx) ?? null
        : resolveRequestFromContext(ctx, options?.resolveProviderByUrl);
    } catch {
      report({
        code: "RBAC_REQUEST_RESOLVER_FAILED",
        message: "the request-context resolver threw; treating the request as unresolved",
        path: "$",
        severity: "warning",
        role: roleName ?? undefined,
        userId: userId ?? undefined,
      });
      request = null;
    }

    let budget;
    if (options?.resolveBudget && role) {
      try {
        budget = options.resolveBudget({ ctx, role, roleName: role.name, userId });
      } catch {
        report({
          code: "RBAC_BUDGET_RESOLVER_FAILED",
          message: "the budget resolver threw; the session budget was not evaluated",
          path: "maxBudgetPerSession",
          severity: "warning",
          role: role.name,
          userId: userId ?? undefined,
        });
        budget = null;
      }
    }

    const verdict = evaluateAuthorization({
      role,
      roleName: role === null ? null : roleName,
      request,
      enforcement,
      budget,
      userId,
      report,
    });

    if (verdict.allow) return ctx.next();

    auditLogger?.logSecurity({
      eventType: "custom",
      action: "rbac_denied",
      userId: userId ?? undefined,
      description: verdict.reason ?? "Access denied",
      severity: "warning",
      meta: { role: verdict.role, unresolved: verdict.unresolved },
    });

    if (verdict.status === 429) {
      return jsonResponse(429, { error: verdict.reason, retryAfterMs: verdict.retryAfterMs });
    }
    return jsonResponse(403, { error: verdict.reason ?? "Access denied" });
  };
}
