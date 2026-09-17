import { describe, it, expect } from "vitest";
import { generateId, createIdGenerator, shortId } from "../src/utils/id.js";

describe("generateId", () => {
  it("generates a UUID-format string", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("createIdGenerator", () => {
  it("generates sequential IDs with prefix", () => {
    const gen = createIdGenerator("req");
    expect(gen()).toBe("req_000001");
    expect(gen()).toBe("req_000002");
    expect(gen()).toBe("req_000003");
  });

  it("starts from a custom number", () => {
    const gen = createIdGenerator("call", 100);
    expect(gen()).toBe("call_000100");
    expect(gen()).toBe("call_000101");
  });

  it("uses default prefix when empty", () => {
    const gen = createIdGenerator();
    expect(gen()).toMatch(/^id_\d+$/);
  });
});

describe("shortId", () => {
  it("generates an 8-character hex string", () => {
    const id = shortId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique short IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    expect(ids.size).toBe(100);
  });
});
