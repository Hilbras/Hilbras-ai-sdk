/**
 * @hilbras/sdk — Configuration Loader
 *
 * Loads configuration from multiple sources with precedence:
 * Runtime overrides > Environment variables > File config > Defaults
 */

import type { SDKConfig, ProviderConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";
import { readFileSync } from "node:fs";

/** Environment variable prefix for SDK config */
const ENV_PREFIX = "HILBRAS_";

/** Parse environment variables into SDKConfig fields */
function loadFromEnv(): Partial<SDKConfig> {
  const env = process.env;
  const config: Partial<SDKConfig> = {};

  if (env[`${ENV_PREFIX}DEFAULT_PROVIDER`]) config.defaultProvider = env[`${ENV_PREFIX}DEFAULT_PROVIDER`];
  if (env[`${ENV_PREFIX}DEFAULT_MODEL`]) config.defaultModel = env[`${ENV_PREFIX}DEFAULT_MODEL`];
  if (env[`${ENV_PREFIX}TEMPERATURE`]) config.temperature = parseFloat(env[`${ENV_PREFIX}TEMPERATURE`] ?? "");
  if (env[`${ENV_PREFIX}MAX_TOKENS`]) config.maxTokens = parseInt(env[`${ENV_PREFIX}MAX_TOKENS`] ?? "", 10);
  if (env[`${ENV_PREFIX}STREAM`]) config.stream = env[`${ENV_PREFIX}STREAM`] === "true";
  if (env[`${ENV_PREFIX}LOG_LEVEL`]) config.logLevel = env[`${ENV_PREFIX}LOG_LEVEL`] as SDKConfig["logLevel"];
  if (env[`${ENV_PREFIX}TIMEOUT`]) config.requestTimeoutMs = parseInt(env[`${ENV_PREFIX}TIMEOUT`] ?? "", 10);
  if (env[`${ENV_PREFIX}MAX_RETRIES`]) config.maxRetries = parseInt(env[`${ENV_PREFIX}MAX_RETRIES`] ?? "", 10);
  if (env[`${ENV_PREFIX}PROMPT_CACHING`]) config.promptCaching = env[`${ENV_PREFIX}PROMPT_CACHING`] === "true";

  // Provider config from env
  const providerUrl = env[`${ENV_PREFIX}PROVIDER_URL`];
  const providerKey = env[`${ENV_PREFIX}PROVIDER_KEY`];
  const providerName = env[`${ENV_PREFIX}PROVIDER_NAME`];
  const providerFormat = env[`${ENV_PREFIX}PROVIDER_FORMAT`] as ProviderConfig["format"];
  if (providerUrl && providerKey) {
    config.providers = [{
      name: providerName || "default",
      baseUrl: providerUrl,
      apiKey: providerKey,
      format: providerFormat || "openai",
    }];
    config.defaultProvider = providerName || "default";
  }

  return config;
}

/** Parse a simple JSON config file */
function loadFromFile(filePath: string): Partial<SDKConfig> {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Partial<SDKConfig>;
  } catch {
    return {};
  }
}

/** Deep merge two config objects (second overrides first) */
function deepMerge(base: SDKConfig, override: Partial<SDKConfig>): SDKConfig {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = result[key as keyof SDKConfig];
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing) && typeof value === "object" && value !== null && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = deepMerge(existing as SDKConfig, value as Partial<SDKConfig>);
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Load configuration with layered precedence:
 * 1. Defaults
 * 2. File config (if provided)
 * 3. Environment variables
 * 4. Runtime overrides
 */
export function loadConfig(options?: {
  configPath?: string;
  overrides?: Partial<SDKConfig>;
}): SDKConfig {
  let config = { ...DEFAULT_CONFIG };

  // Layer 2: File config
  if (options?.configPath) {
    const fileConfig = loadFromFile(options.configPath);
    config = deepMerge(config, fileConfig);
  }

  // Layer 3: Environment variables
  const envConfig = loadFromEnv();
  config = deepMerge(config, envConfig);

  // Layer 4: Runtime overrides
  if (options?.overrides) {
    config = deepMerge(config, options.overrides);
  }

  return config;
}

/** Create a fresh config with overrides (no env or file loading) */
export function createConfig(overrides?: Partial<SDKConfig>): SDKConfig {
  return deepMerge({ ...DEFAULT_CONFIG }, overrides ?? {});
}

/** Validate a config (returns null if valid, error message if invalid) */
export function validateConfig(config: SDKConfig): string | null {
  if (config.temperature < 0 || config.temperature > 2) {
    return `Temperature must be between 0 and 2, got ${config.temperature}`;
  }
  if (config.maxTokens < 1) {
    return `maxTokens must be positive, got ${config.maxTokens}`;
  }
  if (config.requestTimeoutMs < 1000) {
    return `requestTimeoutMs must be at least 1000, got ${config.requestTimeoutMs}`;
  }
  if (config.maxRetries < 0) {
    return `maxRetries must be non-negative, got ${config.maxRetries}`;
  }
  if (!["none", "error", "info", "debug"].includes(config.logLevel)) {
    return `Invalid logLevel: ${config.logLevel}`;
  }
  return null;
}
