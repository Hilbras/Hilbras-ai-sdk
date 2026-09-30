/**
 * Canonical configuration contracts for the v3.3 resolver.
 *
 * This module owns `SDKConfig` and `DEFAULT_CONFIG`. `schema.ts` re-exports
 * these symbols for compatibility with existing imports.
 */

import type { ProviderConfig, Authentication } from "../types/providers.js";

export type ConfigSourceKind = "defaults" | "file" | "environment" | "runtime";
export type ConfigDiagnosticSeverity = "info" | "warning" | "error";

export interface ConfigDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: ConfigDiagnosticSeverity;
  source: ConfigSourceKind;
}

export interface ConfigSourceResult {
  values: Partial<SDKConfig>;
  diagnostics?: ConfigDiagnostic[];
}

export interface ConfigSource {
  kind: ConfigSourceKind;
  load(): ConfigSourceResult;
}

export interface ConfigResolutionOptions {
  sources?: ConfigSource[];
  overrides?: Partial<SDKConfig>;
  strict?: boolean;
  rejectUnknownKeys?: boolean;
}

export type SafeProviderConfig = Omit<ProviderConfig, "authentication" | "extraHeaders"> & {
  authentication: { type: Authentication["type"] };
  extraHeaders?: Record<string, string>;
};

export type SafeSDKConfig = Omit<SDKConfig, "providers"> & {
  providers: SafeProviderConfig[];
};

/** Application-level SDK configuration. */
export interface SDKConfig {
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  toolsEnabled: boolean;
  reasoningEnabled: boolean;
  logLevel: "none" | "error" | "info" | "debug";
  requestTimeoutMs: number;
  maxRetries: number;
  circuitBreakerEnabled: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  promptCaching: boolean;
  workspaceDir: string;
  providers: ProviderConfig[];
  allowedTools: string[];
  deniedTools: string[];
  sessionBudget?: number;
  perRequestBudget?: number;
  rbac?: import("../security/rbac.js").RBACConfig;
  costAlerts?: import("../cost/alerts.js").CostAlertConfig;
  sla?: Array<import("../telemetry/sla.js").SLADefinition>;
}

export const DEFAULT_CONFIG: SDKConfig = {
  defaultProvider: "",
  defaultModel: "gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  toolsEnabled: true,
  reasoningEnabled: false,
  logLevel: "none",
  requestTimeoutMs: 120_000,
  maxRetries: 3,
  circuitBreakerEnabled: true,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60_000,
  promptCaching: true,
  workspaceDir: typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/",
  providers: [],
  allowedTools: [],
  deniedTools: [],
};

const OPTIONAL_CONFIG_KEYS = [
  "sessionBudget",
  "perRequestBudget",
  "rbac",
  "costAlerts",
  "sla",
] as const;

export const CONFIG_KEYS = new Set<string>([
  ...Object.keys(DEFAULT_CONFIG),
  ...OPTIONAL_CONFIG_KEYS,
]);

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function cloneConfigValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneConfigValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (BLOCKED_KEYS.has(key)) continue;
      result[key] = cloneConfigValue(item);
    }
    return result as T;
  }
  return value;
}

export function isConfigKey(key: string): key is keyof SDKConfig {
  return CONFIG_KEYS.has(key) && !BLOCKED_KEYS.has(key);
}
