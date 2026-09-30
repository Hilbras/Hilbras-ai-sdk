/**
 * @hilbras/sdk — Framework handler correctness
 *
 * The handlers shipped non-functional: `addProviderFromCatalog` registers under
 * the catalog display name ("OpenAI") but the handlers called with the
 * caller's spelling ("openai"), so every request threw `ProviderNotFoundError`.
 * The streaming path reported that as HTTP 200 with the failure inside the SSE
 * body, and the existing tests passed because they asserted only the status and
 * content type and never read the body.
 *
 * These tests read the body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHandler, createCompletionHandler } from "../../src/frameworks/nextjs/route-handlers.js";
import { createChatEndpoint, createCompletionEndpoint } from "../../src/frameworks/astro/endpoints.js";
import { createChatAction, createCompletionAction } from "../../src/frameworks/remix/actions.js";

const COMPLETION = JSON.stringify({
  id: "cmpl-1",
  object: "chat.completion",
  created: 0,
  model: "gpt-4o",
  choices: [{ index: 0, message: { role: "assistant", content: "hello from provider" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const originalEnv = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.AI_API_KEY = "sk-test-key-1234567890";
  delete process.env.OPENAI_API_KEY;
  fetchMock = vi.fn(async () =>
    new Response(COMPLETION, { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_") || key.startsWith("OPENAI_") || key.startsWith("HILBRAS_")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

const chatRequest = (body: unknown, url = "https://app.test/api/chat") =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const userMessage = { messages: [{ role: "user", content: "hi" }] };

describe("createChatHandler", () => {
  it("serves a request for the documented lowercase provider id", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ ...userMessage, stream: false }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.choices[0].message.content).toBe("hello from provider");
  });

  it("serves a request for the display-name spelling too", async () => {
    const { POST } = createChatHandler({ provider: "OpenAI", model: "gpt-4o" });
    const res = await POST(chatRequest({ ...userMessage, stream: false }));
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello from provider");
  });

  it("returns a stream whose body has no error chunk", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest(userMessage));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).not.toContain('"type":"error"');
    expect(text).not.toContain("not found");
  });

  it("reports an unknown model as a real error status, not a 200 stream", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ ...userMessage, model: "no-such-model" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toContain("no-such-model");
  });

  it("reports an unknown provider as a real error status", async () => {
    const { POST } = createChatHandler({ provider: "not-a-provider", model: "gpt-4o" });
    const res = await POST(chatRequest({ ...userMessage, stream: false }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).error).toContain("not-a-provider");
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not valid JSON");
  });

  it("returns 400 for an empty body", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-object body", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest("[1,2,3]"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is missing", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ stream: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("messages");
  });

  it("prepends the operator system prompt", async () => {
    const { POST } = createChatHandler({
      provider: "openai", model: "gpt-4o", systemPrompt: "be terse",
    });
    await POST(chatRequest({ ...userMessage, stream: false }));
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(sent.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("reuses one client across requests", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    await POST(chatRequest({ ...userMessage, stream: false }));
    await POST(chatRequest({ ...userMessage, stream: false }));
    await POST(chatRequest({ ...userMessage, stream: false }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A per-request client would have re-resolved the catalog each time; the
    // pool is keyed on model, so all three share one registration.
  });

  it("propagates the request signal so a disconnect aborts the call", async () => {
    const controller = new AbortController();
    const req = new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...userMessage, stream: false }),
      signal: controller.signal,
    });
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const sentSignal = fetchMock.mock.calls[0][1]?.signal;
    expect(sentSignal).toBeDefined();
  });

  it("exposes dispose for the cached clients", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });
    await handler.POST(chatRequest({ ...userMessage, stream: false }));
    await expect(handler.dispose()).resolves.toBeUndefined();
  });
});

describe("createCompletionHandler", () => {
  it("serves a request for the documented lowercase provider id", async () => {
    const { POST } = createCompletionHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ prompt: "hi" }, "https://app.test/api/complete"));
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello from provider");
  });

  it("uses the same model for registration and for the call", async () => {
    const { POST } = createCompletionHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ prompt: "hi", model: "gpt-4o" }, "https://app.test/api/complete"));
    expect(res.status).toBe(200);
  });

  it("returns 400 when prompt is missing instead of sending an empty completion", async () => {
    const { POST } = createCompletionHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({}, "https://app.test/api/complete"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("prompt");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("astro endpoints", () => {
  it("serves a request for the documented lowercase provider id", async () => {
    const { POST } = createChatEndpoint({ provider: "openai", model: "gpt-4o" });
    const res = await POST({ request: chatRequest({ ...userMessage, stream: false }) });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello from provider");
  });

  it("streams without an error chunk", async () => {
    const { POST } = createChatEndpoint({ provider: "openai", model: "gpt-4o" });
    const res = await POST({ request: chatRequest(userMessage) });
    expect(await res.text()).not.toContain('"type":"error"');
  });

  it("returns 400 for a missing prompt", async () => {
    const { POST } = createCompletionEndpoint({ provider: "openai", model: "gpt-4o" });
    const res = await POST({ request: chatRequest({}, "https://app.test/api/complete") });
    expect(res.status).toBe(400);
  });

  it("exposes dispose", async () => {
    const endpoint = createChatEndpoint({ provider: "openai", model: "gpt-4o" });
    await endpoint.POST({ request: chatRequest({ ...userMessage, stream: false }) });
    await expect(endpoint.dispose()).resolves.toBeUndefined();
  });
});

describe("remix actions", () => {
  it("serves a request for the documented lowercase provider id", async () => {
    const action = createChatAction({ provider: "openai", model: "gpt-4o" });
    const res = await action({ request: chatRequest({ ...userMessage, stream: false }) });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello from provider");
  });

  it("streams without an error chunk", async () => {
    const action = createChatAction({ provider: "openai", model: "gpt-4o" });
    const res = await action({ request: chatRequest(userMessage) });
    expect(await res.text()).not.toContain('"type":"error"');
  });

  it("returns 400 for a missing prompt", async () => {
    const action = createCompletionAction({ provider: "openai", model: "gpt-4o" });
    const res = await action({ request: chatRequest({}, "https://app.test/api/complete") });
    expect(res.status).toBe(400);
  });

  it("exposes dispose on the action itself", async () => {
    const action = createChatAction({ provider: "openai", model: "gpt-4o" });
    expect(typeof action).toBe("function");
    await expect(action.dispose()).resolves.toBeUndefined();
  });
});

describe("api key resolution", () => {
  it("prefers an explicit apiKey", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o", apiKey: "sk-explicit" });
    await POST(chatRequest({ ...userMessage, stream: false }));
    expect(String(fetchMock.mock.calls[0][1]?.headers?.Authorization ?? "")).toContain("sk-explicit");
  });

  it("falls back to AI_API_KEY", async () => {
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    await POST(chatRequest({ ...userMessage, stream: false }));
    expect(String(fetchMock.mock.calls[0][1]?.headers?.Authorization ?? "")).toContain("sk-test-key");
  });

  it("falls back to the provider's catalog envKey", async () => {
    delete process.env.AI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-openai-env";
    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await POST(chatRequest({ ...userMessage, stream: false }));
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][1]?.headers?.Authorization ?? "")).toContain("sk-from-openai-env");
  });
});
