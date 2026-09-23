import { describe, expect, it } from "vitest";
import { assertExtraFieldAllowed, mergeExtraParams } from "../src/adapters/extra.js";

describe("provider extra parameter boundary", () => {
  it("rejects attempts to override SDK-owned request fields", () => {
    expect(() => assertExtraFieldAllowed("model")).toThrow(/reserved/);
    expect(() => assertExtraFieldAllowed("messages")).toThrow(/reserved/);
    expect(() => assertExtraFieldAllowed("__proto__")).toThrow(/Unsafe/);
  });

  it("merges provider-specific fields", () => {
    const body: Record<string, unknown> = { model: "safe" };
    mergeExtraParams(body, { top_p: 0.9, reasoning_effort: "high" });
    expect(body).toEqual({ model: "safe", top_p: 0.9, reasoning_effort: "high" });
  });
});
