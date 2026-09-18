import { describe, it, expect } from "vitest";
import { RealtimeSession } from "../src/index.js";

describe("RealtimeSession", () => {
  it("can be instantiated with openai config", () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test-key",
    });
    expect(session).toBeDefined();
    expect(session.connected).toBe(false);
  });

  it("can be instantiated with google config", () => {
    const session = new RealtimeSession({
      provider: "google",
      model: "gemini-2.0-flash-live",
      apiKey: "test-key",
    });
    expect(session).toBeDefined();
  });

  it("can be instantiated with xai config", () => {
    const session = new RealtimeSession({
      provider: "xai",
      model: "grok-realtime",
      apiKey: "test-key",
    });
    expect(session).toBeDefined();
  });

  it("on/off register and remove handlers", () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test",
    });

    const handler = () => {};
    session.on("text", handler);
    session.off("text", handler);
  });

  it("sendAudio throws when not connected", async () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test",
    });
    await expect(session.sendAudio(new ArrayBuffer(0))).rejects.toThrow("Not connected");
  });

  it("sendText throws when not connected", async () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test",
    });
    await expect(session.sendText("hello")).rejects.toThrow("Not connected");
  });

  it("sendToolResult throws when not connected", async () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test",
    });
    await expect(session.sendToolResult("call1", "result")).rejects.toThrow("Not connected");
  });

  it("close does not throw when not connected", async () => {
    const session = new RealtimeSession({
      provider: "openai",
      model: "gpt-4o-realtime",
      apiKey: "test",
    });
    await expect(session.close()).resolves.not.toThrow();
  });
});
