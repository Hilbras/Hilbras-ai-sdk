/**
 * @hilbras/sdk — Streaming failure surface (E1)
 *
 * `client.streamText` is a lazy generator, so a provider call happens *inside*
 * `createSSEResponse`, after the route already returned 200. The failure was
 * caught by the SSE writer, which wrote the raw error message to the client —
 * including provider response bodies — while `onError` was never invoked, so
 * the operator saw nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHandler } from "../../src/frameworks/nextjs/route-handlers.js";
import { createSSEResponse } from "../../src/utils/sse-writer.js";
import type { StreamChunk } from "../../src/types/streams.js";

const originalEnv = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.AI_API_KEY = "sk-test-key-1234567890";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(process.env, originalEnv);
});

const chatRequest = (body: unknown) =>
  new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const PROVIDER_SECRET = "sk-live-PROVIDERSECRET";
const PROVIDER_BODY = `{"error":{"message":"invalid api key ${PROVIDER_SECRET}","type":"invalid_request_error"}}`;

describe("streaming provider failure through the route", () => {
  it("keeps the provider body out of the response and reports the failure", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(PROVIDER_BODY, { status: 401, headers: { "content-type": "application/json" } }),
    );
    const onError = vi.fn();

    const { POST } = createChatHandler({ provider: "openai", model: "gpt-4o", onError });
    const res = await POST(chatRequest({ messages: [{ role: "user", content: "hi" }] }));

    // The headers were already sent, so the status cannot change.
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).not.toContain(PROVIDER_SECRET);
    expect(text).not.toContain("invalid api key");
    expect(text).toContain("The model stream failed");
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("createSSEStream failure handling", () => {
  it("sends a fixed message and hands the real error to onError", async () => {
    const reported: unknown[] = [];
    const chunks = (async function* (): AsyncGenerator<StreamChunk> {
      throw new Error(`Provider 'OpenAI' returned HTTP 401: ${PROVIDER_BODY}`);
    })();

    const res = createSSEResponse(chunks, { onError: (error) => reported.push(error) });
    const text = await res.text();

    expect(text).not.toContain(PROVIDER_SECRET);
    expect(text).toContain("The model stream failed");
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toContain("HTTP 401");
  });
});
