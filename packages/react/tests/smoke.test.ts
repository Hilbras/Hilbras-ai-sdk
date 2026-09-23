import { describe, expect, it } from "vitest";
import { HilbrasProvider, useChat, useCompletion, useCost } from "../src/index.js";

describe("@hilbras/react", () => {
  it("exports the documented client integration hooks", () => {
    expect(typeof HilbrasProvider).toBe("function");
    expect(typeof useChat).toBe("function");
    expect(typeof useCompletion).toBe("function");
    expect(typeof useCost).toBe("function");
  });
});
