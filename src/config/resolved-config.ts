import type { SDKConfig } from "./schema.js";
import type { ExecutionPolicy } from "../types/policy.js";
import type { BudgetConfig } from "../cost/types.js";
import {
  cloneConfigValue,
  type ConfigDiagnostic,
  type ConfigSourceKind,
  type SafeSDKConfig,
} from "./config-schema.js";

export interface ResolvedSDKConfig {
  values: SDKConfig;
  sources: ConfigSourceKind[];
  diagnostics: ConfigDiagnostic[];
  fieldSources: Partial<Record<keyof SDKConfig, ConfigSourceKind>>;
  safeSnapshot(): SafeSDKConfig;
}

const SECRET_KEY = /(secret|token|password|apikey|api_key|authorization|webhook|credential)/i;

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = redactValue(childKey, childValue);
    }
    return result;
  }
  return value;
}

export function policyFromConfig(config: SDKConfig): ExecutionPolicy {
  return {
    retry: { maxRetries: config.maxRetries },
    timeout: { requestTimeoutMs: config.requestTimeoutMs },
    circuitBreaker: {
      enabled: config.circuitBreakerEnabled,
      failureThreshold: config.circuitBreakerThreshold,
      timeoutMs: config.circuitBreakerResetMs,
    },
  };
}

export function budgetFromConfig(config: SDKConfig): BudgetConfig {
  const budget: BudgetConfig = {};
  if (config.sessionBudget !== undefined) budget.sessionBudget = config.sessionBudget;
  if (config.perRequestBudget !== undefined) budget.perRequestBudget = config.perRequestBudget;
  return budget;
}

export function createSafeSnapshot(values: SDKConfig): SafeSDKConfig {
  const copied = cloneConfigValue(values);
  const safe = redactValue("config", copied) as SDKConfig;
  return {
    ...safe,
    providers: safe.providers.map((provider) => ({
      ...provider,
      authentication: { type: provider.authentication.type },
      extraHeaders: provider.extraHeaders
        ? Object.fromEntries(Object.keys(provider.extraHeaders).map((key) => [key, "[REDACTED]"]))
        : undefined,
    })),
  } as SafeSDKConfig;
}

export function createResolvedConfig(
  values: SDKConfig,
  sources: ConfigSourceKind[],
  diagnostics: ConfigDiagnostic[],
  fieldSources: Partial<Record<keyof SDKConfig, ConfigSourceKind>>,
): ResolvedSDKConfig {
  const stableValues = cloneConfigValue(values);
  const stableDiagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
  return {
    values: stableValues,
    sources: [...sources],
    diagnostics: stableDiagnostics,
    fieldSources: { ...fieldSources },
    safeSnapshot: () => createSafeSnapshot(stableValues),
  };
}
