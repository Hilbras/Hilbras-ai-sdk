/**
 * Canonical configuration contracts for the v3.3 resolver.
 *
 * The existing SDKConfig and DEFAULT_CONFIG remain re-exported from
 * `schema.ts` while callers migrate to the resolver. New configuration
 * sources and diagnostics are defined here so the resolver has no dependency
 * on the client or provider implementations.
 */

import type { ProviderConfig, Authentication } from "../types/providers.js";

export type { SDKConfig } from "./schema.js";
export { DEFAULT_CONFIG } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";
import type { SDKConfig } from "./schema.js";

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

/** Clone configuration data without preserving caller-owned references. */
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

/** Return true for a safe, schema-known configuration key. */
export function isConfigKey(key: string): key is keyof SDKConfig {
  return CONFIG_KEYS.has(key) && !BLOCKED_KEYS.has(key);
}
