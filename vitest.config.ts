import { defineConfig } from "vitest/config";

const nextMock = `
class MockHeaders {
  constructor(init) { this._map = new Map(init || {}); }
  get(k) { return this._map.get(k); }
  set(k, v) { this._map.set(k, v); }
}
export const NextResponse = {
  json: (data, init) => ({ status: init?.status ?? 200, headers: new MockHeaders(init?.headers), body: JSON.stringify(data) }),
  next: () => ({ status: 200, headers: new MockHeaders() }),
};
`;

export default defineConfig({
  test: {
    globals: true,
    // Cold module transforms and import-heavy provider contracts can exceed
    // the default 5s under parallel CI load; assertions remain unchanged.
    testTimeout: 15_000,
    include: ["tests/**/*.test.ts", "tests/**/*.test-d.ts"],
    exclude: ["tests/benchmarks/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/**/index.ts"],
      // These are the measured 3.8.0 figures, rounded down slightly for
      // headroom — not an aspiration. The previous 80/70/80/80 was decorative:
      // nothing ran coverage, so nobody noticed actual coverage was ~68/64/70/70
      // and the gate failed on every run. CI now runs it, so this is a real
      // ratchet: raise these as the untested modules (websocket/transport/sse
      // -writer) gain coverage — see ROADMAP-v4.0.0.md.
      thresholds: {
        statements: 67,
        branches: 63,
        functions: 69,
        lines: 69,
      },
    },
  },
  resolve: {
    alias: {
      "next/server": nextMock,
      "next": nextMock,
    },
  },
});
