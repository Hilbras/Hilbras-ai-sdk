/**
 * @hilbras/sdk — Provider and API format types
 */

import type { Model } from "./models.js";

/** Supported API wire formats */
export type APIFormat = "openai" | "anthropic" | "google-genai";

/** Authentication method for a provider */
export type Authentication =
  | { type: "bearer"; apiKey: string }
  | { type: "header"; name: string; value: string }
  | { type: "none" };

/** Which adapter to use for a provider */
export type AdapterName = "openai" | "anthropic" | "google-genai" | "azure" | "groq" | "ollama";

/** Minimal provider configuration */
export interface ProviderConfig {
  name: string;
  baseUrl: string;
  authentication: Authentication;
  models: Model[];
  adapter: AdapterName;
  timeout?: number;
  extraHeaders?: Record<string, string>;
}
