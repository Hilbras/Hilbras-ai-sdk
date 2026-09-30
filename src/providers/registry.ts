/**
 * @hilbras/sdk — Provider Registry
 *
 * Manages registered providers. The client looks up providers here before making calls.
 */

import type { ProviderConfig } from "../types/providers.js";
import { cloneProviderConfig } from "../config/provider-config.js";
import type { Model } from "../types/models.js";
import { ProviderNotFoundError } from "../errors/index.js";

export class ProviderRegistry {
  private _providers = new Map<string, ProviderConfig>();

  add(config: ProviderConfig): void {
    this._providers.set(config.name, cloneProviderConfig(config));
  }

  remove(name: string): boolean {
    return this._providers.delete(name);
  }

  get(name: string): ProviderConfig | undefined {
    const config = this._providers.get(name);
    return config ? cloneProviderConfig(config) : undefined;
  }

  getOrThrow(name: string): ProviderConfig {
    const config = this._providers.get(name);
    if (!config) throw new ProviderNotFoundError(name, this.list().map((c) => c.name));
    return cloneProviderConfig(config);
  }

  list(): ProviderConfig[] {
    return [...this._providers.values()].map(cloneProviderConfig);
  }

  /**
   * Resolve a provider name from a request URL.
   *
   * Authorization decisions happen at the transport layer, where the request
   * body carries a model but never a provider. Matching the URL back to a
   * registered provider is how the provider for a request is identified.
   * Matches on origin, tolerating base-path prefixes and trailing slashes.
   */
  findByUrl(url: string): string | null {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return null;
    }
    const targetOrigin = target.origin.toLowerCase();

    for (const provider of this._providers.values()) {
      let base: URL;
      try {
        base = new URL(provider.baseUrl);
      } catch {
        continue;
      }
      if (base.origin.toLowerCase() !== targetOrigin) continue;

      const basePath = base.pathname.replace(/\/+$/, "");
      if (basePath.length > 0) {
        const targetPath = target.pathname;
        if (targetPath !== basePath && !targetPath.startsWith(`${basePath}/`)) continue;
      }
      return provider.name;
    }
    return null;
  }

  /** Find a model across all providers */
  findModel(modelId: string): { provider: ProviderConfig; model: Model } | null {
    for (const provider of this._providers.values()) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) return { provider: cloneProviderConfig(provider), model: { ...model, capabilities: { ...model.capabilities } } };
    }
    return null;
  }

  clear(): void {
    this._providers.clear();
  }
}
