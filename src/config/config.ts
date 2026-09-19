/**
 * @hilbras/sdk — Configuration Loader
 *
 * Loads configuration from multiple sources with precedence:
 * Runtime overrides > Environment variables > File config > Defaults
 *
 * The env loader maps the legacy `HILBRAS_PROVIDER_*` variables to the
 * canonical `ProviderConfig` shape (introduced in v0.10.0) and runs every
 * `baseUrl` through `validateBaseUrl` so an env-var-based SSRF bypass is
 * not possible. The API key is captured for redacted error messages; it
 * is *not* stored as a plain string on the loaded config — the loader
 * forces it into the `authentication` field which is the public contract.
 */

import type { SDKConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./schema.js";
import type { ProviderConfig } from "./provider-config.js";
import { validateBaseUrl } from "../security/url-guard.js";
import { redact } from "../logging/logger.js";
import { readFileSync } from "node:fs";

/** Environment variable prefix for SDK config */
const ENV_PREFIX = "HILBRAS_";

/**
 * Heuristic adapter detection from a baseUrl. Used when the env loader
 * builds a provider from `HILBRAS_PROVIDER_URL`/`HILBRAS_PROVIDER_FORMAT`
 * and the user has not specified an adapter explicitly. Matches the
 * simplest substrings; if no match, defaults to `openai`.
 */
function inferAdapter(baseUrl: string): ProviderConfig["adapter"] {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("anthropic")) return "anthropic";
  if (lower.includes("googleapis") || lower.includes("generativelanguage")) return "google-genai";
  if (lower.includes("azure")) return "azure";
  if (lower.includes("groq")) return "groq";
  if (lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("[::1]")) return "ollama";
  return "openai";
}

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

  // Provider config from env. v0.10.0: the loader now produces the canonical
  // `ProviderConfig` shape. We also redact the API key for any log that
  // would surface it.
  const providerUrl = env[`${ENV_PREFIX}PROVIDER_URL`];
  const providerKey = env[`${ENV_PREFIX}PROVIDER_KEY`];
  const providerName = env[`${ENV_PREFIX}PROVIDER_NAME`];
  if (providerUrl && providerKey) {
    // Validate the URL through the v0.9.3 SSRF guard. We deliberately
    // allow insecure here because the env loader is the documented
    // way to point at a local Ollama (`http://localhost:11434`).
    // Loopback/private-range access is gated by the global
    // `allowInsecureUrls` / `allowPrivateNetwork` flags on HilbrasClient,
    // not on the loader.
    const guard = validateBaseUrl(providerUrl, { allowInsecure: true });
    if (!guard.ok) {
      throw new Error(
        `HILBRAS_PROVIDER_URL rejected by SSRF guard: ${guard.reason}`,
      );
    }
    const inferredAdapter = inferAdapter(providerUrl);
    config.providers = [{
      name: providerName || "default",
      baseUrl: providerUrl,
      authentication: { type: "bearer", apiKey: providerKey },
      models: [],
      adapter: inferredAdapter,
      allowInsecure: providerUrl.startsWith("http://"),
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
  // v0.10.0: also validate every provider's baseUrl.
  for (const p of config.providers) {
    const guard = validateBaseUrl(p.baseUrl, { allowInsecure: !!p.allowInsecure });
    if (!guard.ok) return `Provider ${p.name}: ${guard.reason}`;
  }
  return null;
}
