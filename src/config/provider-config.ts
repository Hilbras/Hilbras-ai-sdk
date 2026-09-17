/**
 * @hilbras/sdk — Canonical ProviderConfig
 *
 * This is the single source of truth for the per-provider configuration shape.
 * `src/types/providers.ts` re-exports from here so existing imports of
 * `ProviderConfig` from `@hilbras/sdk` and `@hilbras/sdk/types` keep working.
 *
 * The legacy `format: "openai" | "anthropic" | "google-genai"` field and the
 * flat `apiKey: string` field (which used to live in `src/config/schema.ts`)
 * are gone. Callers should use the structured `authentication` field
 * (`{ type: "bearer", apiKey }` or `{ type: "header", name, value }`) and the
 * `adapter` field.
 */

import type { Model } from "../types/models.js";
import type { AdapterName, Authentication } from "../types/providers.js";

/**
 * Per-provider configuration.
 *
 * The `baseUrl` is validated through `validateBaseUrl` before the provider is
 * registered. Use `allowInsecure: true` to allow `http://` for local Ollama
 * and similar.
 */
export interface ProviderConfig {
  /** Display name used as the key in `client.addProvider` / `client.removeProvider`. */
  name: string;
  /** Provider endpoint. Validated against `validateBaseUrl`. */
  baseUrl: string;
  /** Authentication: bearer, header, or none. */
  authentication: Authentication;
  /** Models exposed by this provider. */
  models: Model[];
  /** Which built-in or custom adapter to use. */
  adapter: AdapterName;
  /** Request timeout in ms; falls back to policy timeout. */
  timeout?: number;
  /** Custom HTTP headers to add to every request. */
  extraHeaders?: Record<string, string>;
  /**
   * Allow non-https baseUrl. Required for local Ollama
   * (`http://localhost:11434`) and similar. Defaults to false.
   */
  allowInsecure?: boolean;
}
