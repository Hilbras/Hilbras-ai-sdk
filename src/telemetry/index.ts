/**
 * @hilbras/sdk — Telemetry Module
 *
 * Production observability tools: OpenTelemetry, structured logging,
 * usage dashboard, and body logging.
 */

export { OpenTelemetryExporter } from "./opentelemetry.js";
export type { OpenTelemetryConfig } from "./opentelemetry.js";

export { StructuredLogger } from "./structured-logger.js";
export type { StructuredLoggerConfig, StructuredLogEntry, LogLevel } from "./structured-logger.js";

export { UsageDashboard } from "./dashboard.js";
export type { UsageSummary, ProviderMetrics, ModelMetrics } from "./dashboard.js";

export { BodyLogger } from "./body-logger.js";
export type { BodyLoggerConfig, BodyLogEntry } from "./body-logger.js";
