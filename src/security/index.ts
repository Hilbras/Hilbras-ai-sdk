/**
 * @hilbras/sdk — Security primitives barrel
 */

export { validateBaseUrl } from "./url-guard.js";
export type { UrlGuardOptions, UrlGuardResult } from "./url-guard.js";

export { RequestSigner, signingMiddleware } from "./request-signer.js";
export type { RequestSignerConfig, SignedRequest } from "./request-signer.js";

export { redactPii, detectPii, createPiiRedactor } from "./pii-guard.js";
export type { PiiType, PiiMatch, PiiGuardConfig } from "./pii-guard.js";

export { AuditLogger, createRetentionPolicy } from "./audit-logger.js";
export type { AuditCategory, AuditSeverity, AuditEntry, AuthAuditEntry, DataAccessAuditEntry, ConfigChangeAuditEntry, SecurityAuditEntry, AuditLoggerConfig } from "./audit-logger.js";
