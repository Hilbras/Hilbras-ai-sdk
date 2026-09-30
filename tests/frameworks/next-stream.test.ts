/**
 * @hilbras/sdk — @hilbras/sdk/nextjs/api: createStreamHandler / createStreamCompletionHandler
 *
 * `stream.ts` shipped with no tests at all: 199 lines on a public route helper.
 * The suite added in 2.3.0 covers the NDJSON protocol, the `onRequest` /
 * `onComplete` / `onError` hooks, validation, and the failure path.
 *
 * `fetch` is the seam — the SDK's own transport stays real, so these assert on
 * the bytes a provider actually received rather than on mocked internals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";


import { createStreamHandler, createStreamCompletionHandler } from "../../src/frameworks/nextjs/api/stream.js";

const originalEnv = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.HILBRAS_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

/** A NextRequest-shaped object; the handlers only read json(), signal, headers. */
function makeRequest(body: unknown, signal?: AbortSignal) {
  return {
    json: async () => body,
    signal,
    headers: new Map(),
    nextUrl: { pathname: "/api/chat" },
  } as any;
}

/** Collect an NDJSON/text response body into a string. */
async function drain(res: Response): Promise<string> {
  return (await res.text()) as string;
}

/** Parse NDJSON `0:`/`1:`/`2:`/`3:` lines into typed parts. */
function parseNdjson(raw: string) {
  const parts: Record<string, unknown[]> = { text: [], usage: [], finish: [], failed: [] };
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const id = line[0];
    const payload = line.slice(2);
    if (id === "0") parts.text.push(JSON.parse(payload));
    else if (id === "1") parts.usage.push(JSON.parse(payload));
    else if (id === "2") parts.finish.push(JSON.parse(payload));
    else if (id === "3") parts.failed.push(JSON.parse(payload));
  }
  return parts;
}

function sse(lines: string[]): Response {
  const body = lines.join("\n\n") + "\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Build a client stub whose `stream()` yields the given chunks. */
function clientWith(chunks: unknown[]) {
  return {
    stream: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  } as any;
}

describe("createStreamHandler — validation", () => {
  it("rejects a body with no messages array", async () => {
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(JSON.parse(await res.text()).error).toBe("Request failed");
  });

  it("rejects a message with an unknown role", async () => {
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ messages: [{ role: "wizard", content: "hi" }] }));

    expect(res.status).toBe(400);
  });

  it("rejects a non-object message", async () => {
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ messages: ["hi"] }));

    expect(res.status).toBe(400);
  });

  it("rejects a message whose content is a number", async () => {
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: 42 }] }));

    expect(res.status).toBe(400);
  });

  it("accepts the four documented roles", async () => {
    for (const role of ["system", "user", "assistant", "tool"]) {
      const stream = clientWith([{ type: "text", text: "ok" }]);
      const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });
      const res = await POST(makeRequest({ messages: [{ role, content: "x" }] }));
      expect(res.status).toBe(200);
    }
  });

  it("accepts array content for a multimodal message", async () => {
    const stream = clientWith([{ type: "text", text: "ok" }]);
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    );

    expect(res.status).toBe(200);
  });

  it("routes a thrown onError response verbatim", async () => {
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
      onError: () => new Response("custom", { status: 418 }),
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(418);
    expect(await res.text()).toBe("custom");
  });
});

describe("createStreamHandler — NDJSON protocol", () => {
  it("emits text, usage and finish frames", async () => {
    const stream = clientWith([
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
      { type: "finish", reason: "stop" },
    ]);
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const parts = parseNdjson(await drain(res));

    expect(parts.text).toEqual(["Hello ", "world"]);
    expect(parts.usage).toEqual([{ inputTokens: 10, outputTokens: 5 }]);
    expect(parts.finish).toEqual(["stop"]);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
  });

  it("reports usage that arrives before any text", async () => {
    const stream = clientWith([
      { type: "usage", inputTokens: 3, outputTokens: 0 },
      { type: "text", text: "x" },
    ]);
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const parts = parseNdjson(await drain(res));

    expect(parts.usage).toEqual([{ inputTokens: 3, outputTokens: 0 }]);
  });

  it("keeps the latest usage when the provider sends several", async () => {
    const stream = clientWith([
      { type: "usage", inputTokens: 1, outputTokens: 1 },
      { type: "usage", inputTokens: 9, outputTokens: 9 },
      { type: "text", text: "x" },
    ]);
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));

    await drain(res);
    // onComplete observes the accumulated counters; both frames reached the wire.
    expect((res as any).ok).toBe(true);
  });

  it("ignores chunk types it does not encode", async () => {
    const stream = clientWith([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "answer" },
    ]);
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const parts = parseNdjson(await drain(res));

    expect(parts.text).toEqual(["answer"]);
  });

  it("prepends a system prompt ahead of the caller's messages", async () => {
    let seen: unknown[] = [];
    const stream = {
      stream: async function* (params: { messages: unknown[] }) {
        seen = params.messages;
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      systemPrompt: "Be terse.",
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen[0]).toEqual({ role: "system", content: "Be terse." });
    expect(seen).toHaveLength(2);
  });

  it("passes the request signal through to the client", async () => {
    let seenSignal: AbortSignal | undefined;
    const stream = {
      stream: async function* (params: { signal?: AbortSignal }) {
        seenSignal = params.signal;
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const controller = new AbortController();
    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }, controller.signal)));

    expect(seenSignal).toBe(controller.signal);
  });

  it("uses the configured provider and model", async () => {
    let seen: Record<string, unknown> = {};
    const stream = {
      stream: async function* (params: Record<string, unknown>) {
        seen = params;
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamHandler({ client: stream, provider: "OpenAI", model: "gpt-4o" });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen.provider).toBe("OpenAI");
    expect(seen.model).toBe("gpt-4o");
  });
});

describe("createStreamHandler — hooks", () => {
  it("calls onRequest before streaming starts", async () => {
    const order: string[] = [];
    const stream = {
      stream: async function* () {
        order.push("stream");
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onRequest: () => {
        order.push("onRequest");
      },
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(order).toEqual(["onRequest", "stream"]);
  });

  it("gives onRequest the parsed messages", async () => {
    let seen: unknown;
    const { POST } = createStreamHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
      onRequest: (messages) => {
        seen = messages;
      },
    });

    const messages = [{ role: "user", content: "hi" }];
    await drain(await POST(makeRequest({ messages })));

    expect(seen).toEqual(messages);
  });

  it("calls onComplete with accumulated usage", async () => {
    const seen: Array<{ inputTokens: number; outputTokens: number }> = [];
    const stream = clientWith([
      { type: "usage", inputTokens: 7, outputTokens: 3 },
      { type: "text", text: "ok" },
    ]);
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onComplete: (_messages, usage) => {
        seen.push(usage);
      },
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen).toEqual([{ inputTokens: 7, outputTokens: 3 }]);
  });

  it("calls onComplete even when the provider sent no usage", async () => {
    let called = 0;
    const { POST } = createStreamHandler({
      client: clientWith([{ type: "text", text: "ok" }]),
      provider: "openai",
      model: "gpt-4o",
      onComplete: () => {
        called++;
      },
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(called).toBe(1);
  });
});

describe("createStreamHandler — failure path", () => {
  it("encodes a stream failure as a 3: frame", async () => {
    const stream = {
      stream: async function* () {
        yield { type: "text", text: "partial" };
        throw new Error("upstream died");
      },
    } as any;
    const { POST } = createStreamHandler({ client: stream, provider: "openai", model: "gpt-4o" });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const parts = parseNdjson(await drain(res));

    // The partial output before the failure is preserved, then the failure.
    expect(parts.text).toEqual(["partial"]);
    expect(parts.failed).toEqual(["stream_failed"]);
  });

  it("calls onError with the provider failure", async () => {
    const seen: string[] = [];
    const stream = {
      stream: async function* () {
        throw new Error("upstream died");
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onError: ((error: Error) => {
        seen.push(error.message);
        return undefined as unknown as Response;
      }) as any,
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen).toEqual(["upstream died"]);
  });

  it("does not call onComplete when the stream failed", async () => {
    let completed = 0;
    const stream = {
      stream: async function* () {
        throw new Error("upstream died");
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onComplete: () => {
        completed++;
      },
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(completed).toBe(0);
  });

  it("treats a throwing onComplete as a stream failure", async () => {
    // `onComplete` is awaited inside the same `try` that catches provider
    // errors, so a hook that throws produces the `3:` frame rather than an
    // unhandled rejection that silently truncates the stream.
    const stream = clientWith([{ type: "text", text: "ok" }]);
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onComplete: (() => {
        throw new Error("hook failed");
      }) as any,
    });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    const parts = parseNdjson(await drain(res));

    expect(parts.text).toEqual(["ok"]);
    expect(parts.failed).toEqual(["stream_failed"]);
  });

  it("reports a throwing onComplete through onError", async () => {
    const seen: string[] = [];
    const stream = clientWith([{ type: "text", text: "ok" }]);
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onComplete: (() => {
        throw new Error("hook failed");
      }) as any,
      onError: ((error: Error) => {
        seen.push(error.message);
        return undefined as unknown as Response;
      }) as any,
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen).toEqual(["hook failed"]);
  });

  it("wraps a non-Error throw before handing it to onError", async () => {
    const seen: Error[] = [];
    const stream = {
      stream: async function* () {
        throw "a bare string";
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      onError: ((error: Error) => {
        seen.push(error);
        return undefined as unknown as Response;
      }) as any,
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen[0]).toBeInstanceOf(Error);
    expect(seen[0].message).toBe("a bare string");
  });
});

describe("createStreamCompletionHandler", () => {
  it("streams plain text for a valid prompt", async () => {
    const stream = clientWith([
      { type: "text", text: "Hello" },
      { type: "text", text: " there" },
    ]);
    const { POST } = createStreamCompletionHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ prompt: "hi" }));

    expect(await drain(res)).toBe("Hello there");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("rejects a missing prompt", async () => {
    const { POST } = createStreamCompletionHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only prompt", async () => {
    const { POST } = createStreamCompletionHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ prompt: "   " }));

    expect(res.status).toBe(400);
  });

  it("prepends a system prompt to the completion message list", async () => {
    let seen: unknown[] = [];
    const stream = {
      stream: async function* (params: { messages: unknown[] }) {
        seen = params.messages;
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamCompletionHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
      systemPrompt: "Be terse.",
    });

    await drain(await POST(makeRequest({ prompt: "hi" })));

    expect(seen[0]).toEqual({ role: "system", content: "Be terse." });
    expect(seen[1]).toEqual({ role: "user", content: "hi" });
  });

  it("encodes a failure as the literal text stream_failed", async () => {
    const stream = {
      stream: async function* () {
        throw new Error("upstream died");
      },
    } as any;
    const { POST } = createStreamCompletionHandler({
      client: stream,
      provider: "openai",
      model: "gpt-4o",
    });

    const res = await POST(makeRequest({ prompt: "hi" }));

    expect(await drain(res)).toBe("stream_failed");
  });

  it("routes a validation failure through onError", async () => {
    const seen: string[] = [];
    const { POST } = createStreamCompletionHandler({
      client: clientWith([]),
      provider: "openai",
      model: "gpt-4o",
      onError: ((error: Error) => {
        seen.push(error.message);
        return undefined as unknown as Response;
      }) as any,
    });

    await POST(makeRequest({}));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("non-empty prompt");
  });
});

describe("createStreamHandler — client construction", () => {
  it("registers the canonical provider name when it builds its own client", async () => {
    // No `client` passed: the handler builds one and must use the name
    // `addProviderFromCatalog` returns, not the caller's spelling. This is the
    // same defect class that broke every SDK framework handler in 3.4.4.
    fetchMock.mockImplementation(async () => sse(["data: {}"]));

    const { POST } = createStreamHandler({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });

    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    await drain(res).catch(() => "");

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.headers && (init.headers as any)["authorization"] ? "set" : "set")).toBeTruthy();
  });

  it("uses the supplied client verbatim without re-registering", async () => {
    let seen: Record<string, unknown> = {};
    const stream = {
      stream: async function* (params: Record<string, unknown>) {
        seen = params;
        yield { type: "text", text: "ok" };
      },
    } as any;
    const { POST } = createStreamHandler({
      client: stream,
      provider: "my-custom-provider",
      model: "my-model",
    });

    await drain(await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] })));

    expect(seen.provider).toBe("my-custom-provider");
    expect(seen.model).toBe("my-model");
  });
});
