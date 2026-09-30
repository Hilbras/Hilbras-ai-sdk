/**
 * @hilbras/sdk — Configuration compatibility facade
 *
 * New code should use `resolveConfig()` and explicit configuration sources.
 * These functions remain as the v3.2-compatible API surface.
 */

import { readFileSync } from "node:fs";
import type { SDKConfig } from "./schema.js";
import { resolveConfig } from "./config-resolver.js";
import { createEnvironmentSource } from "./sources/environment.js";
import { createFileSource } from "./sources/file.js";
import { validateBaseUrl } from "../security/url-guard.js";

/**
 * Load configuration with the legacy precedence and permissive file behavior:
 * defaults < file < environment < runtime overrides.
 */
export function loadConfig(options?: {
  configPath?: string;
  overrides?: Partial<SDKConfig>;
}): SDKConfig {
  const sources = [];
  if (options?.configPath) {
    sources.push(createFileSource({
      path: options.configPath,
      readFile: (path) => readFileSync(path, "utf-8"),
    }));
  }
  sources.push(createEnvironmentSource(
    typeof process !== "undefined" && process.env ? process.env : {},
  ));

  const resolved = resolveConfig({
    sources,
    overrides: options?.overrides,
    strict: false,
  });

  const unsafeUrl = resolved.diagnostics.find((diagnostic) => diagnostic.code === "CONFIG_UNSAFE_PROVIDER_URL");
  if (unsafeUrl) {
    throw new Error(`HILBRAS_PROVIDER_URL rejected by SSRF guard: ${unsafeUrl.message}`);
  }

  return resolved.values;
}

/** Create a fresh config with overrides (no environment or file loading). */
export function createConfig(overrides?: Partial<SDKConfig>): SDKConfig {
  return resolveConfig({
    sources: [],
    overrides: overrides ?? {},
    strict: false,
  }).values;
}

/**
 * Validate a config using the legacy string-or-null contract.
 * New code should inspect `resolveConfig().diagnostics` instead.
 */
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
  for (const provider of config.providers) {
    const guard = validateBaseUrl(provider.baseUrl, { allowInsecure: !!provider.allowInsecure });
    if (!guard.ok) return `Provider ${provider.name}: ${guard.reason}`;
  }
  return null;
}
