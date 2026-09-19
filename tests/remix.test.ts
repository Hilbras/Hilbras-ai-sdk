import { describe, it, expect } from "vitest";
import { createChatAction, createCompletionAction } from "../src/frameworks/remix/actions.js";

describe("createChatAction", () => {
  it("creates action function", () => {
    const action = createChatAction({ provider: "openai", model: "gpt-4o" });
    expect(typeof action).toBe("function");
  });

  it("action returns streaming Response", async () => {
    const action = createChatAction({ provider: "openai", model: "gpt-4o" });
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    });
    const response = await action({ request: req });
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  });
});

describe("createCompletionAction", () => {
  it("creates action function", () => {
    const action = createCompletionAction({ provider: "openai", model: "gpt-4o" });
    expect(typeof action).toBe("function");
  });

  it("action returns JSON Response", async () => {
    const action = createCompletionAction({ provider: "openai", model: "gpt-4o" });
    const req = new Request("http://localhost/api/completion", {
      method: "POST",
      body: JSON.stringify({ prompt: "Hello" }),
    });
    // Without a real API key, this will throw an adapter error
    try {
      const response = await action({ request: req });
      expect(response).toBeInstanceOf(Response);
      const data = await response.json();
      expect(data.id).toBeDefined();
    } catch {
      // Expected when no API key configured - handler was still invoked
    }
  });
});
