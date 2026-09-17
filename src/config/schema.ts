/**
 * @hilbras/sdk — Configuration Schema
 *
 * Type-safe configuration with defaults, validation, and layered overrides.
 * Supports global defaults → file config → environment variables → runtime overrides.
 *
 * `ProviderConfig` is the canonical type, defined in `./provider-config.ts`
 * and re-exported from this module for convenience. The legacy
 * `format`/`apiKey` fields are gone; callers should use the structured
 * `authentication` and `adapter` fields.
 */

import type { ProviderConfig } from "./provider-config.js";

export type { ProviderConfig } from "./provider-config.js";

export interface SDKConfig {
  /** Default provider name */
  defaultProvider: string;
  /** Default model ID */
  defaultModel: string;
  /** Default temperature (0-2) */
  temperature: number;
  /** Default max tokens */
  maxTokens: number;
  /** Enable streaming by default */
  stream: boolean;
  /** Enable tool calling by default */
  toolsEnabled: boolean;
  /** Enable reasoning/thinking by default */
  reasoningEnabled: boolean;
  /** Log level: none | error | info | debug */
  logLevel: "none" | "error" | "info" | "debug";
  /** Timeout for HTTP requests (ms) */
  requestTimeoutMs: number;
  /** Max retry attempts */
  maxRetries: number;
  /** Enable circuit breaker */
  circuitBreakerEnabled: boolean;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold: number;
  /** Circuit breaker reset timeout (ms) */
  circuitBreakerResetMs: number;
  /** Enable prompt caching when supported */
  promptCaching: boolean;
  /** Working directory for file tools */
  workspaceDir: string;
  /** Custom provider configurations */
  providers: ProviderConfig[];
  /** Allowed tools (empty = all) */
  allowedTools: string[];
  /** Denied tools */
  deniedTools: string[];
  /** Maximum total cost for the session (null = unlimited) */
  sessionBudget?: number;
  /** Maximum cost per individual request (null = unlimited) */
  perRequestBudget?: number;
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
