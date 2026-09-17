/**
 * @hilbras/sdk — Provider and API format types
 *
 * `ProviderConfig` is defined in `src/config/provider-config.ts` (the
 * canonical home). It is re-exported here for backward compatibility
 * with the existing public path `@hilbras/sdk/types` and the top-level
 * `@hilbras/sdk`.
 */

/** Supported API wire formats */
export type APIFormat = "openai" | "anthropic" | "google-genai";

/** Authentication method for a provider */
export type Authentication =
  | { type: "bearer"; apiKey: string }
  | { type: "header"; name: string; value: string }
  | { type: "none" };

/** Which adapter to use for a provider */
export type AdapterName = "openai" | "anthropic" | "google-genai" | "azure" | "groq" | "ollama";

// Re-export the canonical ProviderConfig so existing imports work.
export type { ProviderConfig } from "../config/provider-config.js";
