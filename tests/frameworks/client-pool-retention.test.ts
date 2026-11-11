/**
 * @hilbras/sdk — Framework client pool retention (E2)
 *
 * `createFrameworkClientPool` added each new client to its `owned` set *before*
 * `addProviderFromCatalog`, which throws for a model that is not in the
 * catalog. The client was then unreachable through the cache and drained only
 * by `dispose()`, so every failed request leaked one for the process lifetime —
 * an unbounded set any caller could grow.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { createFrameworkClientPool } from "../../src/frameworks/shared/handler-core.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFrameworkClientPool retention", () => {
  it("does not retain a client whose provider registration failed", async () => {
    const dispose = vi.spyOn(HilbrasClient.prototype, "dispose");
    const pool = createFrameworkClientPool({ provider: "openai", model: "no-such-model", apiKey: "k" });

    expect(() => pool.get("no-such-model")).toThrow();

    await pool.dispose();

    // A retained client would be disposed here; the failed one must not be.
    expect(dispose).not.toHaveBeenCalled();
  });

  it("still disposes a client that did register", async () => {
    const dispose = vi.spyOn(HilbrasClient.prototype, "dispose");
    const pool = createFrameworkClientPool({ provider: "openai", model: "gpt-4o", apiKey: "k" });

    pool.get("gpt-4o");
    await pool.dispose();

    expect(dispose).toHaveBeenCalled();
  });
});
