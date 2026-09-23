/**
 * @hilbras/sdk — Provider Catalog
 *
 * Dynamic provider/model catalog for auto-discovery.
 * Use `loadCatalog()` to get the full provider catalog at runtime.
 */

import catalog from "./provider-catalog.js";

export interface CatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: string[];
}

export interface CatalogProvider {
  name: string;
  baseUrl: string;
  adapters: string[];
  envKey: string | null;
  models: CatalogModel[];
}

export interface ProviderCatalog {
  version: string;
  generated: string;
  providers: Record<string, CatalogProvider>;
}

/**
 * Load the built-in provider catalog.
 * Returns the full catalog with all providers and models.
 */
export function loadCatalog(): ProviderCatalog {
  return catalog as ProviderCatalog;
}

/**
 * List all available provider IDs.
 */
export function listProviders(): string[] {
  return Object.keys(catalog.providers);
}

/**
 * Get a specific provider's catalog entry.
 */
export function getProviderCatalog(providerId: string): CatalogProvider | undefined {
  return catalog.providers[providerId as keyof typeof catalog.providers] as CatalogProvider | undefined;
}

/**
 * Find models matching a query across all providers.
 */
export function searchModels(query: string): Array<{ provider: string; model: CatalogModel }> {
  const q = query.toLowerCase();
  const results: Array<{ provider: string; model: CatalogModel }> = [];

  for (const [providerId, provider] of Object.entries(catalog.providers)) {
    for (const model of (provider as CatalogProvider).models) {
      if (model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q)) {
        results.push({ provider: providerId, model });
      }
    }
  }

  return results;
}

/**
 * Get all models for a specific provider.
 */
export function getModelsForProvider(providerId: string): CatalogModel[] {
  const provider = catalog.providers[providerId as keyof typeof catalog.providers] as CatalogProvider | undefined;
  return provider?.models ?? [];
}
