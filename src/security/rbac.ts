/**
 * @hilbras/sdk — Role-Based Access Control (RBAC)
 *
 * Provides role definitions, permission checking, and RBAC middleware
 * for controlling which providers, models, and features each user can access.
 */

import type { Middleware, MiddlewareContext } from "../middleware/middleware.js";
import { RateLimiterRegistry } from "./rate-limiter.js";
import { AuditLogger } from "./audit-logger.js";

/** A role definition with access constraints */
export interface RBACRole {
  /** Role name */
  name: string;
  /** Allowed provider names (empty = all providers allowed) */
  allowedProviders?: string[];
  /** Allowed model patterns (empty = all models allowed) */
  allowedModels?: string[];
  /** Maximum tokens per request (undefined = no limit) */
  maxTokensPerRequest?: number;
  /** Maximum budget per session in dollars (undefined = no limit) */
  maxBudgetPerSession?: number;
  /** Rate limit configuration */
  rateLimit?: {
    /** Maximum requests within the window */
    maxRequests: number;
    /** Window duration in milliseconds */
    windowMs: number;
  };
}

/** @deprecated Use RBACRole instead */
export type Role = RBACRole;

/** RBAC configuration */
export interface RBACConfig {
  /** Map of role name to role definition */
  roles: Record<string, RBACRole>;
  /** Default role for users without an explicit role */
  defaultRole?: string;
}

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
 */
export function checkPermission(
  role: RBACRole,
  provider: string,
  model: string,
  tokenCount?: number,
): PermissionCheck {
  // Check provider access
  if (role.allowedProviders?.length && !role.allowedProviders.includes(provider)) {
    return {
      allowed: false,
      reason: `Provider "${provider}" is not allowed for role "${role.name}". Allowed: ${role.allowedProviders.join(", ")}`,
      role: role.name,
    };
  }

  // Check model access
  if (role.allowedModels?.length) {
    const modelAllowed = role.allowedModels.some((pattern) => {
      if (pattern.endsWith("*")) {
        return model.startsWith(pattern.slice(0, -1));
      }
      return model === pattern;
    });
    if (!modelAllowed) {
      return {
        allowed: false,
        reason: `Model "${model}" is not allowed for role "${role.name}". Allowed: ${role.allowedModels.join(", ")}`,
        role: role.name,
      };
    }
  }

  // Check token limit
  if (role.maxTokensPerRequest !== undefined && tokenCount !== undefined) {
    if (tokenCount > role.maxTokensPerRequest) {
      return {
        allowed: false,
        reason: `Token count ${tokenCount} exceeds limit of ${role.maxTokensPerRequest} for role "${role.name}"`,
        role: role.name,
      };
    }
  }

  return { allowed: true, role: role.name };
}

/**
 * Create RBAC middleware that enforces role-based access control.
 *
 * The `getUserId` callback extracts the user identity from the request
 * (e.g., from an auth header, API key, or session). The middleware
 * checks the user's role against the requested provider/model.
 *
 * @example
 * ```ts
 * const rbacMiddleware = createRBACMiddleware(
 *   {
 *     roles: {
 *       viewer: { name: "viewer", allowedProviders: ["openai"], maxTokensPerRequest: 4096 },
 *       admin: { name: "admin" },  // no restrictions
 *     },
 *     defaultRole: "viewer",
 *   },
 *   (ctx) => extractUserIdFromHeader(ctx.init),
 * );
 *
 * const client = new HilbrasClient({ middleware: rbacMiddleware });
 * ```
 */
export function createRBACMiddleware(
  config: RBACConfig,
  getUserId: (ctx: MiddlewareContext) => string | null,
  options?: {
    /** Audit logger for access-denied events */
    auditLogger?: AuditLogger;
    /** Rate limiter registry (created automatically if not provided) */
    rateLimiters?: RateLimiterRegistry;
  },
): Middleware {
  const rateLimiters = options?.rateLimiters ?? new RateLimiterRegistry();
  const auditLogger = options?.auditLogger;

  return async (ctx: MiddlewareContext) => {
    const userId = getUserId(ctx);

    // If no user ID, apply default role or allow through
    const roleId = config.defaultRole ?? "default";
    const role = config.roles[roleId];

    if (!role) {
      // No role configured, allow through
      return ctx.next();
    }

    // Extract provider/model from the request body if available
    let provider = "";
    let model = "";
    let tokenCount: number | undefined;

    try {
      const body = ctx.init.body;
      if (typeof body === "string") {
        const parsed = JSON.parse(body);
        provider = parsed.provider ?? "";
        model = parsed.model ?? "";
        tokenCount = parsed.max_tokens;
      }
    } catch { /* body may not be JSON — skip extraction */ }

    // Check permissions
    if (provider && model) {
      const check = checkPermission(role, provider, model, tokenCount);
      if (!check.allowed) {
        auditLogger?.logSecurity({
          eventType: "custom",
          action: "rbac_denied",
          description: check.reason ?? "Access denied",
          severity: "warning",
        });
        return new Response(JSON.stringify({ error: check.reason }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Check rate limit
    if (role.rateLimit && userId) {
      const limiter = rateLimiters.getOrCreate(`rbac:${userId}`, {
        maxTokens: role.rateLimit.maxRequests,
        refillRate: role.rateLimit.maxRequests / (role.rateLimit.windowMs / 1000),
      });
      const result = limiter.acquire();
      if (!result.allowed) {
        auditLogger?.logSecurity({
          eventType: "rate_limit",
          action: "rbac_rate_limit",
          description: `Rate limit exceeded for user ${userId} (role: ${role.name})`,
          severity: "warning",
        });
        return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfterMs: result.retryAfterMs }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((result.retryAfterMs ?? 1000) / 1000)),
          },
        });
      }
    }

    return ctx.next();
  };
}
