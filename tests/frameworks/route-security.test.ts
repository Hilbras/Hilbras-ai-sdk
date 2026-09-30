/**
 * @hilbras/sdk — Framework route security (v3.5.0)
 *
 * Three controls land here, all optional so that v3.4 behaviour is unchanged:
 *
 * - `onRequest` — the authentication/authorization extension point. Throwing
 *   from it rejects the request, and because it runs before the response is
 *   constructed the status is real rather than an SSE body carrying the error.
 * - `trustClientFields` — whether the request body may override the factory's
 *   own `model`, `tools`, `maxSteps`, `temperature` and `maxTokens`. Default
 *   `true` preserves v3.4; the default flips to `false` in 4.0.0.
 * - `limits` — bounds on body size, message count, tool count, and clamps on
 *   `maxSteps` / `maxTokens` / `temperature`.
 *
 * These tests assert against the request that actually reached the provider
 * (`fetch`), not just the response, because the defect class is "the caller
 * influenced a value the operator configured".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HilbrasClient } from "../../src/client/client.js";
import { createChatHandler, createCompletionHandler } from "../../src/frameworks/nextjs/route-handlers.js";
import { createChatEndpoint, createCompletionEndpoint } from "../../src/frameworks/astro/endpoints.js";
import { createChatAction, createCompletionAction } from "../../src/frameworks/remix/actions.js";
import { RequestValidationError } from "../../src/errors/index.js";

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
  process.env.AI_API_KEY = "test-key";
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

const post = (body: unknown, url = "https://app.test/api/chat") =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const userMessage = { messages: [{ role: "user", content: "hi" }] };

/** Read the JSON body of the nth outgoing provider request. */
async function outgoingBody(n = 0): Promise<Record<string, unknown>> {
  const [, init] = fetchMock.mock.calls[n] as [string, RequestInit | undefined];
  return JSON.parse(String(init?.body ?? "")) as Record<string, unknown>;
}

const tool = (name: string) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

/** Tool names present in an outgoing payload. */
async function outgoingToolNames(n = 0): Promise<string[] | undefined> {
  const body = (await outgoingBody(n)) as {
    tools?: Array<{ function: { name: string } }>;
  };
  return body.tools?.map((t) => t.function.name);
}

describe("onRequest authorization hook", () => {
  it("rejects with the status the hook throws, before any provider call", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        throw new RequestValidationError("Unauthorized", undefined, 401);
      },
    });

    const res = await handler.POST(post({ ...userMessage, stream: false }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    // The whole point of the hook: a rejected request costs nothing upstream.
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("rejects a streaming request with a real status, not a 200 carrying the error", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        throw new RequestValidationError("Forbidden", undefined, 403);
      },
    });

    const res = await handler.POST(post(userMessage));

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("reads the request, so a header-based check is possible", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: ({ request: req }) => {
        if (req.headers.get("authorization") !== "Bearer secret") {
          throw new RequestValidationError("Unauthorized", undefined, 401);
        }
      },
    });

    const req = post({ ...userMessage, stream: false }, "https://app.test/api/chat");
    req.headers.set("authorization", "Bearer secret");

    const res = await handler.POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await handler.dispose();
  });

  it("reports the post-allowlist model to the hook, not the requested one", async () => {
    // A per-model authorization hook must see the value that will be used. If it
    // read `body.model` it could authorize "gpt-4o" while the handler sent
    // something else.
    const seen: string[] = [];
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
      onRequest: ({ effective }) => {
        seen.push(effective.model);
      },
    });

    await handler.POST(post({ ...userMessage, model: "attacker-model", stream: false }));

    expect(seen).toEqual(["gpt-4o"]);
    expect((await outgoingBody()).model).toBe("gpt-4o");
    await handler.dispose();
  });

  it("awaits an async hook before calling the provider", async () => {
    const order: string[] = [];
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("hook");
      },
    });

    await handler.POST(post({ ...userMessage, stream: false }));

    expect(order).toEqual(["hook"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await handler.dispose();
  });

  it("is available on the completion handler too", async () => {
    const handler = createCompletionHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        throw new RequestValidationError("Unauthorized", undefined, 401);
      },
    });

    const res = await handler.POST(post({ prompt: "hi" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("is available on the Astro and Remix adapters, not just Next.js", async () => {
    const deny = () => {
      throw new RequestValidationError("Unauthorized", undefined, 401);
    };
    const endpoint = createChatEndpoint({ provider: "openai", model: "gpt-4o", onRequest: deny });
    const action = createChatAction({ provider: "openai", model: "gpt-4o", onRequest: deny });

    const req = post(userMessage);
    expect((await endpoint.POST({ request: req })).status).toBe(401);
    expect((await action({ request: post(userMessage) })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    await endpoint.dispose();
    await action.dispose();
  });
});

describe("onError hook", () => {
  it("receives a provider-phase error with the request", async () => {
    // 400 is not retryable, so the failure is guaranteed to reach `onError`
    // instead of being recovered by a second attempt — which is what made an
    // earlier version of this test pass while `seen` stayed empty.
    fetchMock.mockImplementation(async () => new Response("upstream exploded", { status: 400 }));
    const seen: Array<{ phase: string; message: string }> = [];
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onError: (error, ctx) => {
        seen.push({ phase: ctx.phase, message: String((error as Error)?.message ?? error) });
      },
    });

    const res = await handler.POST(post({ ...userMessage, stream: false }));

    expect(res.status).toBe(400);
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe("provider");
    expect(seen[0].message).toContain("upstream exploded");
    await handler.dispose();
  });

  it("classifies a validation failure as the request phase", async () => {
    const seen: string[] = [];
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onError: (_error, ctx) => {
        seen.push(ctx.phase);
      },
    });

    await handler.POST(post({ messages: "not-an-array" }));

    expect(seen).toEqual(["request"]);
    await handler.dispose();
  });

  it("fires for a request rejected by onRequest", async () => {
    const seen: string[] = [];
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        throw new RequestValidationError("Unauthorized", undefined, 401);
      },
      onError: (_error, ctx) => {
        seen.push(ctx.phase);
      },
    });

    await handler.POST(post({ ...userMessage, stream: false }));

    expect(seen).toEqual(["request"]);
    await handler.dispose();
  });

  it("does not fire on a successful request", async () => {
    let calls = 0;
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      onError: () => {
        calls++;
      },
    });

    const res = await handler.POST(post({ ...userMessage, stream: false }));

    expect(res.status).toBe(200);
    expect(calls).toBe(0);
    await handler.dispose();
  });
});

describe("trustClientFields", () => {
  it("ignores body.model when false", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await handler.POST(post({ ...userMessage, model: "attacker-model", stream: false }));

    expect((await outgoingBody()).model).toBe("gpt-4o");
    await handler.dispose();
  });

  it("ignores body.tools when false", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await handler.POST(post({ ...userMessage, stream: false, tools: [tool("get_weather")] }));

    expect(await outgoingToolNames()).toBeUndefined();
    await handler.dispose();
  });

  it("keeps using the factory's own tools when false", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
      tools: [tool("configured_tool")],
    });

    // The streaming path is the one that carries `tools` to the provider; the
    // non-streaming path has never forwarded them (true in v3.4 as well).
    const res = await handler.POST(post({ ...userMessage, tools: [tool("attacker_tool")] }));

    expect(res.status).toBe(200);
    expect(await outgoingToolNames()).toEqual(["configured_tool"]);
    await handler.dispose();
  });

  it("ignores body.maxTokens when false", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await handler.POST(post({ ...userMessage, stream: false, maxTokens: 999_999 }));

    // The adapter omits `max_tokens` when unset rather than defaulting.
    expect((await outgoingBody()).max_tokens).toBeUndefined();
    await handler.dispose();
  });

  it("ignores body.temperature when false, leaving the adapter's own default", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await handler.POST(post({ ...userMessage, stream: false, temperature: 1.9 }));

    // `temperature` is always sent by the adapter, defaulting to 0.7, so the
    // observable proof that the caller's 1.9 was dropped is that 0.7 arrives.
    expect((await outgoingBody()).temperature).toBe(0.7);
    await handler.dispose();
  });

  it("preserves the v3.4 behaviour when unset — the body still wins", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });

    // `gpt-4o-mini` is a real catalog model, so the override reaches the
    // provider rather than failing model validation.
    await handler.POST(post({ ...userMessage, model: "gpt-4o-mini", stream: false }));

    expect((await outgoingBody()).model).toBe("gpt-4o-mini");
    await handler.dispose();
  });

  it("applies to the completion handler's body.model", async () => {
    const handler = createCompletionHandler({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await handler.POST(post({ prompt: "hi", model: "attacker-model" }));

    expect((await outgoingBody()).model).toBe("gpt-4o");
    await handler.dispose();
  });

  it("applies to the Astro and Remix chat adapters", async () => {
    const endpoint = createChatEndpoint({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });
    const action = createChatAction({
      provider: "openai",
      model: "gpt-4o",
      trustClientFields: false,
    });

    await endpoint.POST({ request: post({ ...userMessage, model: "a1", stream: false }) });
    expect((await outgoingBody(0)).model).toBe("gpt-4o");

    await action({ request: post({ ...userMessage, model: "a2", stream: false }) });
    expect((await outgoingBody(1)).model).toBe("gpt-4o");

    await endpoint.dispose();
    await action.dispose();
  });
});

describe("bounded request limits", () => {
  it("rejects a body over maxBodyBytes with 413", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 200 },
    });

    const big = post({ messages: [{ role: "user", content: "x".repeat(4000) }] });
    const res = await handler.POST(big);

    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("200 byte limit");
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("rejects an oversized body on the content-length hint alone, before reading it", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 200 },
    });

    // `new Request({ body })` sets no content-length, so the hint path is only
    // reachable by declaring one explicitly — and a deployment behind a proxy
    // that sets it is the common case.
    const req = post({ ...userMessage, stream: false });
    req.headers.set("content-length", "999999");

    const res = await handler.POST(req);

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("ignores a content-length that understates the body", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 200 },
    });

    // The hint says 10 bytes but the body is ~4 KiB. A handler that trusted the
    // header would accept this and buffer the whole thing.
    const req = post({ messages: [{ role: "user", content: "x".repeat(4000) }] });
    req.headers.set("content-length", "10");

    const res = await handler.POST(req);

    expect(res.status).toBe(413);
    await handler.dispose();
  });

  it("measures bytes, not characters, so multi-byte bodies cannot slip under", async () => {
    // "é" is 2 bytes. A 100-char body is 200 bytes, so a 150-byte limit must
    // reject it even though `.length` is only 100.
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 150 },
    });

    const res = await handler.POST(post({ messages: [{ role: "user", content: "é".repeat(100) }] }));

    expect(res.status).toBe(413);
    await handler.dispose();
  });

  it("accepts a body at exactly maxBodyBytes", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 4096 },
    });

    const res = await handler.POST(post({ ...userMessage, stream: false }));

    expect(res.status).toBe(200);
    await handler.dispose();
  });

  it("honours a lowered limit on the completion handler", async () => {
    const handler = createCompletionHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 20 },
    });

    const res = await handler.POST(post({ prompt: "x".repeat(200) }));

    expect(res.status).toBe(413);
    await handler.dispose();
  });

  it("rejects more messages than maxMessages allows", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxMessages: 2 },
    });

    const res = await handler.POST(
      post({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "user", content: "c" },
        ],
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("exceeding the limit of 2");
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("rejects more tools than maxTools allows", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxTools: 1 },
    });

    const res = await handler.POST(
      post({ ...userMessage, stream: false, tools: [tool("a"), tool("b")] }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("exceeding the limit of 1");
    await handler.dispose();
  });

  it("clamps body.maxSteps to maxStepsClamp", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxStepsClamp: 3 },
    });

    const seen: Array<number | undefined> = [];
    // `maxSteps` bounds a client-side loop, so it is not a provider field: the
    // observable is the value the loop was actually given.
    const spy = vi
      .spyOn(HilbrasClient.prototype, "streamText")
      .mockImplementation(async function* (params: { maxSteps?: number }) {
        seen.push(params.maxSteps);
        yield { type: "text" as const, text: "" };
        yield { type: "finish" as const, reason: "stop" as const };
      });

    const res = await handler.POST(post({ ...userMessage, maxSteps: 500 }));

    expect(res.status).toBe(200);
    expect(seen).toEqual([3]);
    spy.mockRestore();
    await handler.dispose();
  });

  it("clamps the factory's own maxSteps too, not just the caller's", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      maxSteps: 500,
      limits: { maxStepsClamp: 4 },
    });

    const seen: Array<number | undefined> = [];
    const spy = vi
      .spyOn(HilbrasClient.prototype, "streamText")
      .mockImplementation(async function* (params: { maxSteps?: number }) {
        seen.push(params.maxSteps);
        yield { type: "text" as const, text: "" };
        yield { type: "finish" as const, reason: "stop" as const };
      });

    const res = await handler.POST(post({ ...userMessage }));

    expect(res.status).toBe(200);
    expect(seen).toEqual([4]);
    spy.mockRestore();
    await handler.dispose();
  });

  it("clamps body.maxTokens to maxTokensClamp", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxTokensClamp: 128 },
    });

    await handler.POST(post({ ...userMessage, stream: false, maxTokens: 100_000 }));

    expect((await outgoingBody()).max_tokens).toBe(128);
    await handler.dispose();
  });

  it("clamps temperature into the configured range", async () => {
    const handler = createChatHandler({
      provider: "openai",
      model: "gpt-4o",
      limits: { temperatureClamp: [0.2, 0.8] },
    });

    await handler.POST(post({ ...userMessage, stream: false, temperature: 99 }));
    expect((await outgoingBody(0)).temperature).toBe(0.8);

    await handler.POST(post({ ...userMessage, stream: false, temperature: -50 }));
    expect((await outgoingBody(1)).temperature).toBe(0.2);

    await handler.dispose();
  });

  it("leaves a value inside the clamp range untouched", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });

    await handler.POST(post({ ...userMessage, stream: false, temperature: 0.7, maxTokens: 256 }));

    const body = (await outgoingBody()) as { temperature?: number; max_tokens?: number };
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(256);
    await handler.dispose();
  });

  it("applies limits to the Astro and Remix adapters", async () => {
    const endpoint = createChatEndpoint({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxBodyBytes: 60 },
    });
    const action = createChatAction({
      provider: "openai",
      model: "gpt-4o",
      limits: { maxMessages: 1 },
    });

    const bigBody = post({ messages: [{ role: "user", content: "x".repeat(300) }] });
    expect((await endpoint.POST({ request: bigBody })).status).toBe(413);

    const twoMessages = post({
      messages: [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ],
    });
    expect((await action({ request: twoMessages })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    await endpoint.dispose();
    await action.dispose();
  });

  it("defaults are generous enough that an ordinary request is unaffected", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });

    const res = await handler.POST(
      post({
        messages: Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `m${i}` })),
        stream: false,
        maxTokens: 8000,
        temperature: 1,
      }),
    );

    expect(res.status).toBe(200);
    await handler.dispose();
  });
});

describe("compatibility", () => {
  it("still rejects a missing prompt with 400", async () => {
    const handler = createCompletionHandler({ provider: "openai", model: "gpt-4o" });
    const res = await handler.POST(post({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await handler.dispose();
  });

  it("still rejects malformed JSON with 400", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await handler.POST(post("{not json"));
    expect(res.status).toBe(400);
    await handler.dispose();
  });

  it("still rejects an empty body with 400", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await handler.POST(post("   "));
    expect(res.status).toBe(400);
    await handler.dispose();
  });

  it("still resolves the canonical provider name for a lowercase id", async () => {
    const handler = createChatHandler({ provider: "openai", model: "gpt-4o" });
    const res = await handler.POST(post({ ...userMessage, stream: false }));
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello from provider");
    await handler.dispose();
  });

  it("still honours the factory model on the Astro adapter, which never read body.model", async () => {
    const endpoint = createChatEndpoint({ provider: "openai", model: "gpt-4o" });
    // `gpt-4o-mini` is a real catalog model, so had the adapter honoured
    // `body.model` (as Next.js does) the payload would carry it.
    const res = await endpoint.POST({ request: post({ ...userMessage, model: "gpt-4o-mini", stream: false }) });
    expect(res.status).toBe(200);
    expect((await outgoingBody()).model).toBe("gpt-4o");
    await endpoint.dispose();
  });
});
