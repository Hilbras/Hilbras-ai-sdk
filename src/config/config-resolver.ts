import { DEFAULT_CONFIG } from "./schema.js";
import type { SDKConfig } from "./schema.js";
import { createDefaultsSource } from "./sources/defaults.js";
import { createRuntimeSource } from "./sources/runtime.js";
import { createResolvedConfig, type ResolvedSDKConfig } from "./resolved-config.js";
import {
  CONFIG_KEYS,
  cloneConfigValue,
  type ConfigDiagnostic,
  type ConfigResolutionOptions,
  type ConfigSourceKind,
} from "./config-schema.js";
import { validateBaseUrl } from "../security/url-guard.js";
import { ConfigurationError } from "../errors/index.js";

const LOG_LEVELS = new Set<SDKConfig["logLevel"]>(["none", "error", "info", "debug"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorDiagnostic(
  source: ConfigSourceKind,
  code: string,
  path: string,
  message: string,
): ConfigDiagnostic {
  return { code, path, message, severity: "error", source };
}

function warningDiagnostic(
  source: ConfigSourceKind,
  code: string,
  path: string,
  message: string,
): ConfigDiagnostic {
  return { code, path, message, severity: "warning", source };
}

function mergePlainObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === undefined) continue;
    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = mergePlainObjects(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = cloneConfigValue(value);
    }
  }
  return result;
}

function mergeValues(
  base: SDKConfig,
  override: Partial<SDKConfig>,
  source: ConfigSourceKind,
  rejectUnknownKeys: boolean,
  diagnostics: ConfigDiagnostic[],
  fieldSources: Partial<Record<keyof SDKConfig, ConfigSourceKind>>,
): SDKConfig {
  const result = cloneConfigValue(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (!CONFIG_KEYS.has(key)) {
      diagnostics.push((rejectUnknownKeys ? errorDiagnostic : warningDiagnostic)(
        source,
        "CONFIG_UNKNOWN_KEY",
        key,
        `unknown configuration key '${key}' was ignored`,
      ));
      continue;
    }
    if (value === undefined) continue;
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergePlainObjects(current, value as Record<string, unknown>);
    } else {
      result[key] = cloneConfigValue(value);
    }
    fieldSources[key as keyof SDKConfig] = source;
  }
  return result as unknown as SDKConfig;
}

function validateValues(values: SDKConfig, source: ConfigSourceKind): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const numberFields: Array<[keyof SDKConfig, string, (value: number) => boolean]> = [
    ["temperature", "temperature", (value) => Number.isFinite(value) && value >= 0 && value <= 2],
    ["maxTokens", "maxTokens", (value) => Number.isInteger(value) && value > 0],
    ["requestTimeoutMs", "requestTimeoutMs", (value) => Number.isInteger(value) && value >= 1000],
    ["maxRetries", "maxRetries", (value) => Number.isInteger(value) && value >= 0],
    ["circuitBreakerThreshold", "circuitBreakerThreshold", (value) => Number.isInteger(value) && value > 0],
    ["circuitBreakerResetMs", "circuitBreakerResetMs", (value) => Number.isInteger(value) && value >= 0],
  ];
  for (const [field, path, valid] of numberFields) {
    if (!valid(values[field] as number)) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_VALUE", path, `${path} has an invalid value`));
    }
  }
  if (!LOG_LEVELS.has(values.logLevel)) {
    diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_ENUM", "logLevel", "logLevel must be none, error, info, or debug"));
  }
  if (!Array.isArray(values.providers)) {
    diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_TYPE", "providers", "providers must be an array"));
    return diagnostics;
  }
  const names = new Set<string>();
  values.providers.forEach((provider, index) => {
    const path = `providers[${index}]`;
    if (!provider || typeof provider !== "object") {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_TYPE", path, "provider must be an object"));
      return;
    }
    if (!provider.name || typeof provider.name !== "string") {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_VALUE", `${path}.name`, "provider name is required"));
    } else if (names.has(provider.name)) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_DUPLICATE_PROVIDER", `${path}.name`, "provider names must be unique"));
    } else {
      names.add(provider.name);
    }
    if (typeof provider.adapter !== "string" || provider.adapter.length === 0) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_VALUE", `${path}.adapter`, "provider adapter is required"));
    }
    if (!Array.isArray(provider.models)) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_TYPE", `${path}.models`, "provider models must be an array"));
    }
    if (typeof provider.baseUrl !== "string") {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_VALUE", `${path}.baseUrl`, "provider baseUrl is required"));
    } else {
      const guard = validateBaseUrl(provider.baseUrl, { allowInsecure: !!provider.allowInsecure });
      if (!guard.ok) {
        diagnostics.push(errorDiagnostic(source, "CONFIG_UNSAFE_PROVIDER_URL", `${path}.baseUrl`, `provider URL rejected by security policy: ${guard.reason}`));
      }
    }
    const auth = provider.authentication;
    if (!auth || typeof auth !== "object" || typeof auth.type !== "string") {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_AUTH", `${path}.authentication`, "provider authentication is required"));
    } else if (auth.type === "bearer" && (typeof auth.apiKey !== "string" || auth.apiKey.length === 0)) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_AUTH", `${path}.authentication.apiKey`, "bearer authentication requires an API key"));
    } else if (auth.type === "header" && (typeof auth.name !== "string" || typeof auth.value !== "string")) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_AUTH", `${path}.authentication`, "header authentication requires name and value"));
    } else if (auth.type !== "bearer" && auth.type !== "header" && auth.type !== "none") {
      diagnostics.push(errorDiagnostic(source, "CONFIG_INVALID_AUTH", `${path}.authentication.type`, "unsupported authentication type"));
    }
  });
  if (Array.isArray(values.allowedTools) && Array.isArray(values.deniedTools)) {
    const denied = new Set(values.deniedTools);
    const overlap = values.allowedTools.filter((tool) => denied.has(tool));
    if (overlap.length > 0) {
      diagnostics.push(errorDiagnostic(source, "CONFIG_TOOL_POLICY_CONFLICT", "allowedTools", "allowedTools and deniedTools must not overlap"));
    }
  }
  return diagnostics;
}

function throwForDiagnostics(diagnostics: ConfigDiagnostic[]): void {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return;
  const summary = errors.slice(0, 3).map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("; ");
  throw new ConfigurationError(
    `Configuration resolution failed: ${summary}`,
    "Check the configuration source, value types, and provider security policy.",
  );
}

export function resolveConfig(options: ConfigResolutionOptions = {}): ResolvedSDKConfig {
  const strict = options.strict ?? true;
  const rejectUnknownKeys = options.rejectUnknownKeys ?? false;
  const diagnostics: ConfigDiagnostic[] = [];
  const fieldSources: Partial<Record<keyof SDKConfig, ConfigSourceKind>> = {};
  const suppliedSources = options.sources ?? [];
  const sources = [
    createDefaultsSource(),
    ...suppliedSources.filter((source) => source.kind !== "defaults"),
    ...(options.overrides ? [createRuntimeSource(options.overrides)] : []),
  ];

  let values = cloneConfigValue(DEFAULT_CONFIG);
  for (const source of sources) {
    let loaded: ReturnType<typeof source.load>;
    try {
      loaded = source.load();
    } catch {
      diagnostics.push(errorDiagnostic(source.kind, "CONFIG_SOURCE_FAILED", "$", `configuration source '${source.kind}' failed`));
      if (strict) throwForDiagnostics(diagnostics);
      continue;
    }
    diagnostics.push(...(loaded.diagnostics ?? []));
    if (loaded.diagnostics?.some((diagnostic) => diagnostic.severity === "error")) {
      if (strict) throwForDiagnostics(diagnostics);
      // In compatibility mode retain valid fields from the source while
      // surfacing the invalid ones as diagnostics.
    }
    values = mergeValues(values, loaded.values, source.kind, rejectUnknownKeys, diagnostics, fieldSources);
  }

  diagnostics.push(...validateValues(values, "runtime"));
  if (strict) throwForDiagnostics(diagnostics);
  return createResolvedConfig(values, sources.map((source) => source.kind), diagnostics, fieldSources);
}
