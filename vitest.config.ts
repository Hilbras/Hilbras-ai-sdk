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
    include: ["tests/**/*.test.ts", "tests/**/*.test-d.ts"],
    exclude: ["tests/benchmarks/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/**/index.ts"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
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
