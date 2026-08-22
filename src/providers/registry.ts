/**
 * @hilbras/sdk — Provider Registry
 *
 * Manages registered providers. The client looks up providers here before making calls.
 */

import type { ProviderConfig } from "../types/providers.js";
import type { Model } from "../types/models.js";
import { ProviderNotFoundError } from "../errors/index.js";

export class ProviderRegistry {
  private _providers = new Map<string, ProviderConfig>();

  add(config: ProviderConfig): void {
    this._providers.set(config.name, config);
  }

  remove(name: string): boolean {
    return this._providers.delete(name);
  }

  get(name: string): ProviderConfig | undefined {
    return this._providers.get(name);
  }

  getOrThrow(name: string): ProviderConfig {
    const p = this._providers.get(name);
    if (!p) throw new ProviderNotFoundError(name);
    return p;
  }

  list(): ProviderConfig[] {
    return Array.from(this._providers.values());
  }

  /** Find a model across all providers */
  findModel(modelId: string): { provider: ProviderConfig; model: Model } | null {
    for (const provider of this._providers.values()) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) return { provider, model };
    }
    return null;
  }

  clear(): void {
    this._providers.clear();
  }
}
