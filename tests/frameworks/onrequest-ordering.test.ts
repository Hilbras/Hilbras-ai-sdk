/**
 * @hilbras/sdk — onRequest runs before client construction (E2)
 *
 * The handlers called `pool.get()` — which constructs a HilbrasClient — before
 * running `onRequest`. An unauthenticated caller therefore forced a client
 * construction (and, before the pool-retention fix, its retention) on every
 * request, even when the hook was about to reject them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHandler } from "../../src/frameworks/nextjs/route-handlers.js";
import { HilbrasClient } from "../../src/client/client.js";
import { RequestValidationError } from "../../src/errors/index.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.AI_API_KEY = "sk-test-key-1234567890";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

const chatRequest = (body: unknown) =>
  new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("onRequest ordering", () => {
  it("does not construct a client when the hook rejects", async () => {
    const register = vi.spyOn(HilbrasClient.prototype, "addProviderFromCatalog");
    const { POST } = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        throw new RequestValidationError("Unauthorized", undefined, 401);
      },
    });

    const res = await POST(chatRequest({ messages: [{ role: "user", content: "hi" }] }));

    expect(res.status).toBe(401);
    // The rejected request must never reach the point of building a client.
    expect(register).not.toHaveBeenCalled();
  });

  it("still builds one when the hook allows the request", async () => {
    const register = vi.spyOn(HilbrasClient.prototype, "addProviderFromCatalog");
    const { POST } = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {},
    });

    await POST(chatRequest({ messages: [{ role: "user", content: "hi" }], stream: false }));

    expect(register).toHaveBeenCalled();
  });
});
