/**
 * @hilbras/sdk — Security primitives barrel
 */

export { validateBaseUrl } from "./url-guard.js";
export type { UrlGuardOptions, UrlGuardResult } from "./url-guard.js";

export { RequestSigner, signingMiddleware } from "./request-signer.js";
export type { RequestSignerConfig, SignedRequest } from "./request-signer.js";

export { redactPii, detectPii, createPiiRedactor } from "./pii-guard.js";
export type { PiiType, PiiMatch, PiiGuardConfig } from "./pii-guard.js";

export { detectInjection, scanMessages, createInjectionGuard, INJECTION_PATTERNS } from "./prompt-injection-guard.js";
export type { InjectionSeverity, InjectionBlockLevel, InjectionMatch, InjectionDetection, InjectionGuardConfig } from "./prompt-injection-guard.js";

export { AuditLogger, createRetentionPolicy } from "./audit-logger.js";
export type { AuditCategory, AuditSeverity, AuditEntry, AuthAuditEntry, DataAccessAuditEntry, ConfigChangeAuditEntry, SecurityAuditEntry, AuditLoggerConfig } from "./audit-logger.js";

export { RateLimiter, createRateLimiter, RateLimiterRegistry } from "./rate-limiter.js";
export type { RateLimiterConfig, ThrottleInfo, RateLimiterStats } from "./rate-limiter.js";
