/**
 * @hilbras/sdk — Base64 encoding (D3)
 *
 * The Google adapters encoded audio with `btoa(String.fromCharCode(...bytes))`,
 * which spreads every element into one call and throws
 * `RangeError: Maximum call stack size exceeded` past roughly 100 kB — well
 * below a normal audio clip.
 */

import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/utils/base64.js";

describe("toBase64", () => {
  it("matches Buffer for a payload beyond the spread limit", () => {
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes an empty payload", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it("encodes a chunk-boundary-sized payload exactly", () => {
    const bytes = new Uint8Array(0x8000 * 2);

    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
