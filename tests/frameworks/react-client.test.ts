/**
 * @hilbras/sdk — @hilbras/sdk/react-client subpath
 *
 * These hooks previously shipped as the unpublished `@hilbras/react` package
 * and moved here in 3.5.0. The old test was one assertion over four exports and
 * imported through the package entry.
 *
 * Two things are asserted here that nothing else would catch:
 *
 * 1. The browser-credential warning. `HilbrasProvider` accepts a `config` that
 *    can hold an API key, and in a browser that key is bundled into client JS.
 *    That risk is invisible at runtime — it exists only as a doc comment — so
 *    its presence is asserted rather than assumed.
 * 2. That the provider still renders its children through context. Removing the
 *    `createElement` call keeps every export a function, so an export-shape test
 *    passes while `useHilbrasClient` can no longer reach the client from any
 *    descendant.
 *
 * `useChat` / `useCompletion` here call `client.stream()` in the browser. The
 * same names in `@hilbras/sdk/react` are route-based (`fetch(api)`). Both are
 * exported, from different subpaths, deliberately.
 */
import { describe, expect, it } from "vitest";
import {
  HilbrasProvider,
  useChat,
  useCompletion,
  useCost,
} from "../../src/frameworks/react-client/index.js";

const readSource = async (file: string) => {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(file, import.meta.url), "utf8");
};

describe("@hilbras/sdk/react-client", () => {
  it("exports the documented client integration hooks", () => {
    expect(typeof HilbrasProvider).toBe("function");
    expect(typeof useChat).toBe("function");
    expect(typeof useCompletion).toBe("function");
    expect(typeof useCost).toBe("function");
  });

  it("does not collide with the route-based hooks in @hilbras/sdk/react", async () => {
    const clientMode = await import("../../src/frameworks/react-client/index.js");
    const routeMode = await import("../../src/frameworks/react/index.js");

    // Both export useChat. They must be different implementations: one holds a
    // HilbrasClient, the other holds an API route. If a future refactor ever
    // aliased one to the other, this is the assertion that catches it.
    expect(clientMode.useChat).not.toBe(routeMode.useChat);
    expect(clientMode.useCompletion).not.toBe(routeMode.useCompletion);
  });

  it("keeps the browser-credential warning on the config prop", async () => {
    const source = await readSource("../../src/frameworks/react-client/provider.ts");
    expect(source).toContain("bundles it into your client-side");
  });

  it("keeps the warning that the provider calls providers from the browser", async () => {
    const source = await readSource("../../src/frameworks/react-client/provider.ts");
    expect(source).toContain("from the browser");
    expect(source).toContain("@hilbras/sdk/react");
  });

  it("renders its children through context rather than returning them bare", async () => {
    const source = await readSource("../../src/frameworks/react-client/provider.ts");
    // A bare `return children` keeps every export a function while making the
    // context unreachable, so the provider element itself is asserted.
    expect(source).toContain("HilbrasContext.Provider");
    expect(source).toContain("createElement(HilbrasContext.Provider");
  });

  it("builds the provider element with createElement, not JSX", async () => {
    const source = await readSource("../../src/frameworks/react-client/provider.ts");
    // The SDK ships no .tsx and its tsconfig sets no --jsx. A stray JSX return
    // here would break the build for the whole package, so the convention is
    // pinned rather than left to review.
    expect(source).not.toMatch(/return <HilbrasContext/);
  });

  it("documents the route-based alternative on the subpath entry", async () => {
    const source = await readSource("../../src/frameworks/react-client/index.ts");
    expect(source).toContain("@hilbras/sdk/react");
    expect(source).toContain("inference runs **in the browser**");
  });
});
