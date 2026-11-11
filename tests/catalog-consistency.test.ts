/**
 * @hilbras/sdk — Catalog consistency (F1a)
 *
 * `provider-catalog.ts` (generated) and `models.ts` `BUILTIN_MODELS` both
 * describe the same model ids, but with different metadata. The router applies
 * limits from `BUILTIN_MODELS` while `getProviderCatalog()` reports the other
 * table, so a caller could be told a different context window than the one
 * actually enforced.
 */

import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/index.js";
import { BUILTIN_MODELS } from "../src/catalog/models.js";

type CatalogModel = { id: string; contextWindow?: number; maxOutput?: number };

function catalogModels(): CatalogModel[] {
  const providers = loadCatalog().providers as Record<string, { models?: CatalogModel[] }>;
  return Object.values(providers).flatMap((provider) => provider.models ?? []);
}

describe("catalog consistency", () => {
  it("agrees on contextWindow and maxOutput for every shared model id", () => {
    const byId = new Map(catalogModels().map((model) => [model.id, model]));
    const conflicts: string[] = [];

    for (const entry of BUILTIN_MODELS) {
      const other = byId.get(entry.id);
      if (!other) continue;
      if (other.contextWindow !== undefined && other.contextWindow !== entry.contextWindow) {
        conflicts.push(`${entry.id}: contextWindow catalog=${other.contextWindow} models=${entry.contextWindow}`);
      }
      if (other.maxOutput !== undefined && other.maxOutput !== entry.maxOutput) {
        conflicts.push(`${entry.id}: maxOutput catalog=${other.maxOutput} models=${entry.maxOutput}`);
      }
    }

    expect(conflicts).toEqual([]);
  });
});
