/**
 * @hilbras/sdk — GenericOpenAIAdapter and the eight providers built on it
 *
 * Nine adapter files shipped at 0% coverage. Eight are 20-line subclasses of
 * `GenericOpenAIAdapter` that differ only in id and base URL, so the leverage is
 * in testing the shared class once and asserting the subclasses are wired to it
 * — nine shallow per-file tests would prove less.
 *
 * Behaviours pinned here, all read from the implementation rather than assumed:
 *
 * - `_headers` applies bearer or custom-header auth, merged with `extraHeaders`
 * - `_buildBody` omits `max_tokens` when unset, gates tools on
 *   `supportsNativeTools`, and applies `transformBody`
 * - `extra` fields pass through `assertExtraFieldAllowed`
 * - tool-call deltas accumulate by index across chunks
 * - `reasoning_content` / `thinking` surface as reasoning, not text
 * - a 400 mentioning max_tokens retries without it; any other 400 throws
 * - `complete` and `embed` map usage and errors
 *
 * Note on the class docblock: it claims "text-embedded tool call parsing" and
 * there is no such code path. That claim is recorded in the plan rather than
 * tested, because there is nothing to test.
 */
import { describe, it, expect } from "vitest";
import { GenericOpenAIAdapter } from "../../src/adapters/openai-compatible.js";
import { CerebrasAdapter } from "../../src/adapters/cerebras.js";
import { DeepInfraAdapter } from "../../src/adapters/deepinfra.js";
import { DeepSeekAdapter } from "../../src/adapters/deepseek.js";
import { FireworksAdapter } from "../../src/adapters/fireworks.js";
import { MistralAdapter } from "../../src/adapters/mistral.js";
import { PerplexityAdapter } from "../../src/adapters/perplexity.js";
import { TogetherAdapter } from "../../src/adapters/together.js";
import { XAIAdapter } from "../../src/adapters/xai.js";
import { ProviderRequestError } from "../../src/errors/index.js";
import type { Transport } from "../../src/transport/transport.js";
import type { ProviderConfig } from "../../src/types/providers.js";
import type { StreamChunk } from "../../src/types/streams.js";

const BASE = "https://api.example.com/v1";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "example",
    baseUrl: BASE,
    authentication: { type: "bearer", apiKey: "sk-test" },
    adapter: "openai-compatible",
    models: [{ id: "m", contextWindow: 128_000, capabilities: {
      streaming: true, tools: true, vision: false, reasoning: false,
      structuredOutput: false, parallelTools: false, systemPrompts: true,
    } }],
    ...overrides,
  } as ProviderConfig;
}

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A transport that replays `chunks` as an SSE body.
 *
 * `stream()` consumes `res.body` from `request()`, not `transport.stream()` —
 * reading the implementation rather than assuming the shape from other adapters
 * is what made the first version of this file fail 16 tests.
 */
function streaming(chunks: string[]): Transport {
  const encoder = new TextEncoder();
  const make = () =>
    new ReadableStream<Uint8Array>({
      start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); },
    });
  return {
    async request() { return new Response(make(), { status: 200 }); },
    async stream() { return make(); },
    abort() {},
  };
}

/** A transport recording each request and replaying `responses` in order. */
function scripted(responses: Array<{ status: number; body: string }>): Transport & { calls: Array<{ url: string; body: Record<string, unknown> }> } {
  let i = 0;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  return {
    calls,
    async request(url: string, init?: RequestInit) {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

const adapterOf = (t: Transport, cfg: Partial<ProviderConfig> = {}) =>
  new GenericOpenAIAdapter({ provider: provider(cfg), transport: t });

describe("GenericOpenAIAdapter — headers", () => {
  it("applies bearer auth", () => {
    const a = adapterOf(streaming([]));
    const headers = (a as any)._headers();
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("applies custom-header auth instead of a bearer", () => {
    const a = adapterOf(streaming([]), {
      authentication: { type: "header", name: "x-api-key", value: "abc" },
    } as Partial<ProviderConfig>);
    const headers = (a as any)._headers();
    expect(headers["x-api-key"]).toBe("abc");
    expect(headers.Authorization).toBeUndefined();
  });

  it("merges adapter extraHeaders, and lets a per-call header win", () => {
    const a = new GenericOpenAIAdapter(
      { provider: provider(), transport: streaming([]) },
      { adapterId: "m", extraHeaders: { "x-extra": "1", "Accept": "text/plain" } },
    );
    const headers = (a as any)._headers({ "x-call": "2", "x-extra": "override" });
    expect(headers["x-extra"]).toBe("override");
    expect(headers["x-call"]).toBe("2");
    expect(headers.Accept).toBe("text/plain");
  });

  it("uses the configured id", () => {
    expect(new GenericOpenAIAdapter({ provider: provider(), transport: streaming([]) }, { adapterId: "deepseek" }).id).toBe("deepseek");
    expect(new GenericOpenAIAdapter({ provider: provider(), transport: streaming([]) }).id).toBe("openai-compatible");
  });
});

describe("GenericOpenAIAdapter — request body", () => {
  const build = (a: unknown, p: Record<string, unknown>) => (a as any)._buildBody({
    model: "m", messages: [{ role: "user", content: "hi" }], temperature: 0.7, stream: false, ...p,
  });

  it("omits max_tokens when unset rather than defaulting", () => {
    expect(build(adapterOf(streaming([])), {})).not.toHaveProperty("max_tokens");
    expect(build(adapterOf(streaming([])), { maxTokens: 100 })).toHaveProperty("max_tokens", 100);
  });

  it("omits max_tokens when it is zero", () => {
    expect(build(adapterOf(streaming([])), { maxTokens: 0 })).not.toHaveProperty("max_tokens");
  });

  it("adds stream_options only when streaming", () => {
    expect(build(adapterOf(streaming([])), { stream: true })).toHaveProperty("stream_options", { include_usage: true });
    expect(build(adapterOf(streaming([])), { stream: false })).not.toHaveProperty("stream_options");
  });

  it("includes tools and tool_choice when native tools are supported", () => {
    const body = build(adapterOf(streaming([])), {
      tools: [{ type: "function", function: { name: "f", description: "d", parameters: {} } }],
    });
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([{ type: "function", function: { name: "f", description: "d", parameters: {} } }]);
  });

  it("omits tools entirely when supportsNativeTools is false", () => {
    const a = new GenericOpenAIAdapter(
      { provider: provider(), transport: streaming([]) },
      { adapterId: "x", supportsNativeTools: false },
    );
    const body = build(a, { tools: [{ type: "function", function: { name: "f", description: "d", parameters: {} } }] });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("applies transformBody last", () => {
    const a = new GenericOpenAIAdapter(
      { provider: provider(), transport: streaming([]) },
      { adapterId: "x", transformBody: (b) => ({ ...b, added: true }) },
    );
    expect(build(a, {})).toHaveProperty("added", true);
  });

  it("passes extra fields through the allowlist", () => {
    expect(build(adapterOf(streaming([])), { extra: { top_p: 0.9 } })).toHaveProperty("top_p", 0.9);
  });

  it("refuses an extra field that would override a reserved one", () => {
    // The allowlist is a real contract: without it a caller could replace
    // `model` or `stream` after the adapter built the body. The happy-path
    // `top_p` test above cannot detect its removal.
    expect(() => build(adapterOf(streaming([])), { extra: { model: "attacker-model" } })).toThrow();
    expect(() => build(adapterOf(streaming([])), { extra: { stream: false } })).toThrow();
    expect(() => build(adapterOf(streaming([])), { extra: { messages: [] } })).toThrow();
  });

  it("refuses prototype-polluting extra field names", () => {
    for (const key of ["__proto__", "prototype", "constructor"]) {
      expect(() => build(adapterOf(streaming([])), { extra: { [key]: "x" } })).toThrow();
    }
  });

  it("carries tool_calls and tool_call_id onto the wire", () => {
    const body = (adapterOf(streaming([])) as any)._buildBody({
      model: "m", temperature: 0.7, stream: false,
      messages: [{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }] },
                 { role: "tool", content: "r", tool_call_id: "1" }],
    });
    expect(body.messages[0]).toHaveProperty("tool_calls");
    expect(body.messages[1]).toHaveProperty("tool_call_id", "1");
  });
});

describe("GenericOpenAIAdapter — streaming", () => {
  it("emits text then a finish chunk", async () => {
    const a = adapterOf(streaming([
      sse({ choices: [{ delta: { content: "Hello " } }] }),
      sse({ choices: [{ delta: { content: "world" } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]));
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.filter((c) => c.type === "text").map((c: any) => c.text).join(""))
      .toBe("Hello world");
    expect(chunks.some((c) => c.type === "finish" && (c as any).reason === "stop")).toBe(true);
  });

  it("surfaces reasoning_content as reasoning, not text", async () => {
    const a = adapterOf(streaming([
      sse({ choices: [{ delta: { reasoning_content: "thinking..." } }] }),
      sse({ choices: [{ delta: { content: "answer" } }] }),
      "data: [DONE]\n\n",
    ]));
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.some((c) => c.type === "reasoning")).toBe(true);
    expect(chunks.filter((c) => c.type === "text").map((c: any) => c.text).join("")).toBe("answer");
  });

  it("reads the `thinking` field as reasoning too", async () => {
    const a = adapterOf(streaming([
      sse({ choices: [{ delta: { thinking: "hmm" } }] }),
      "data: [DONE]\n\n",
    ]));
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.some((c) => c.type === "reasoning")).toBe(true);
  });

  it("accumulates tool-call deltas by index across chunks", async () => {
    const a = adapterOf(streaming([
      sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: '{"q":' } }] } }] }),
      sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ]));
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    const call = chunks.find((c) => c.type === "tool_call") as any;
    expect(call).toBeDefined();
    expect(call.name).toBe("search");
    // The adapter parses the accumulated fragments itself and emits them as
    // `argumentsDelta` (ToolCallChunk has no `arguments` field), so the property
    // under test is that the two fragments concatenated rather than replaced.
    expect(JSON.parse(call.argumentsDelta)).toEqual({ q: "hi" });
  });

  it("retries without max_tokens when a 400 blames max_tokens", async () => {
    let attempt = 0;
    const encoder = new TextEncoder();
    const t: Transport = {
      async request() {
        attempt++;
        const body = attempt === 1
          ? "max_tokens is too large for this model"
          : sse({ choices: [{ delta: { content: "ok" } }] }) + "data: [DONE]\n\n";
        return new Response(
          new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(body)); c.close(); } }),
          { status: attempt === 1 ? 400 : 200 },
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    const chunks = await drain(adapterOf(t).stream({
      model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 999_999,
    }));
    expect(attempt).toBe(2);
    expect(chunks.filter((c) => c.type === "text").map((c: any) => c.text).join("")).toBe("ok");
  });

  it("matches a context-length error for degradation", async () => {
    let attempt = 0;
    const encoder = new TextEncoder();
    const t: Transport = {
      async request() {
        attempt++;
        const body = attempt === 1
          ? "maximum context length is 8192 tokens"
          : sse({ choices: [{ delta: { content: "ok" } }] }) + "data: [DONE]\n\n";
        return new Response(
          new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(body)); c.close(); } }),
          { status: attempt === 1 ? 400 : 200 },
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    await drain(adapterOf(t).stream({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 50_000 }));
    expect(attempt).toBe(2);
  });

  it("does not retry a 400 unrelated to max_tokens", async () => {
    let attempt = 0;
    const t: Transport = {
      async request() {
        attempt++;
        return new Response("invalid api key", { status: 400 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };
    await expect(async () => {
      for await (const _ of adapterOf(t).stream({ model: "m", messages: [{ role: "user", content: "hi" }] })) { /* drain */ }
    }).rejects.toBeInstanceOf(ProviderRequestError);
    expect(attempt).toBe(1);
  });

  it("reports usage when the provider sends it", async () => {
    const a = adapterOf(streaming([
      sse({ choices: [{ delta: { content: "x" } }] }),
      sse({ usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } }),
      "data: [DONE]\n\n",
    ]));
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    const usage = chunks.find((c) => c.type === "usage") as any;
    expect(usage).toMatchObject({ inputTokens: 11, outputTokens: 3, totalTokens: 14 });
  });
});

describe("GenericOpenAIAdapter — complete()", () => {
  it("returns the assistant message content", async () => {
    const t = scripted([{ status: 200, body: JSON.stringify({
      choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }) }]);
    // complete() returns the text, not a result object — verified against the
    // implementation rather than assumed from other adapters.
    const result = await adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("done");
  });

  it("returns an empty string when the body is not JSON", async () => {
    const t = scripted([{ status: 200, body: "not json" }]);
    expect(await adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }] })).toBe("");
  });

  it("returns an empty string when there are no choices", async () => {
    const t = scripted([{ status: 200, body: JSON.stringify({ choices: [] }) }]);
    expect(await adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }] })).toBe("");
  });

  it("sends max_tokens on the first attempt", async () => {
    const t = scripted([{ status: 200, body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "x" } }] }) }]);
    await adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 64 });
    expect(t.calls[0].body).toHaveProperty("max_tokens", 64);
  });

  it("throws on a 400 — complete() has no max_tokens degradation", async () => {
    // The degradation block lives in stream() (openai-compatible.ts:176); the
    // docblock lists it under the class as a whole. complete() throws on any
    // non-ok response, so the retry behaviour is deliberately NOT asserted here.
    const t = scripted([{ status: 400, body: "max_tokens is too large for this model" }]);
    await expect(adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 999_999 }))
      .rejects.toBeInstanceOf(ProviderRequestError);
    expect(t.calls).toHaveLength(1);
  });

  it("throws on a 400 that is not about max_tokens", async () => {
    const t = scripted([{ status: 400, body: "invalid api key" }]);
    await expect(adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }] }))
      .rejects.toBeInstanceOf(ProviderRequestError);
    expect(t.calls).toHaveLength(1);
  });

  it("throws a ProviderRequestError carrying the status", async () => {
    const t = scripted([{ status: 429, body: "slow down" }]);
    const err = await adapterOf(t).complete({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderRequestError);
    expect(err.status).toBe(429);
  });
});

describe("GenericOpenAIAdapter — embed()", () => {
  it("posts to /embeddings and maps the response", async () => {
    const t = scripted([{ status: 200, body: JSON.stringify({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      usage: { prompt_tokens: 6, total_tokens: 6 },
    }) }]);
    const result = await adapterOf(t).embed({ model: "e", input: ["a", "b"] });
    expect(t.calls[0].url).toBe(`${BASE}/embeddings`);
    expect(result.embeddings).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(result.usage).toMatchObject({ inputTokens: 6, totalTokens: 6 });
  });

  it("passes dimensions through when given", async () => {
    const t = scripted([{ status: 200, body: JSON.stringify({ data: [{ embedding: [1] }] }) }]);
    await adapterOf(t).embed({ model: "e", input: "a", dimensions: 256 });
    expect(t.calls[0].body).toHaveProperty("dimensions", 256);
  });

  it("throws on a failed embedding request", async () => {
    const t = scripted([{ status: 500, body: "boom" }]);
    await expect(adapterOf(t).embed({ model: "e", input: "a" })).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

describe("the eight OpenAI-compatible providers", () => {
  const providers: Array<[string, any, string]> = [
    ["cerebras", CerebrasAdapter, "https://api.cerebras.ai/v1"],
    ["deepinfra", DeepInfraAdapter, "https://api.deepinfra.com/v1/openai"],
    ["deepseek", DeepSeekAdapter, "https://api.deepseek.com/v1"],
    ["fireworks", FireworksAdapter, "https://api.fireworks.ai/inference/v1"],
    ["mistral", MistralAdapter, "https://api.mistral.ai/v1"],
    ["perplexity", PerplexityAdapter, "https://api.perplexity.ai"],
    ["together", TogetherAdapter, "https://api.together.xyz/v1"],
    ["xai", XAIAdapter, "https://api.x.ai/v1"],
  ];

  it.each(providers)("%s is a GenericOpenAIAdapter with its own id", (_name, Ctor, baseUrl) => {
    const a = new Ctor({ provider: provider({ name: _name, baseUrl }), transport: streaming([]) });
    expect(a).toBeInstanceOf(GenericOpenAIAdapter);
    expect(a.id).toBe(_name);
    expect((a as any)._provider.baseUrl).toBe(baseUrl);
  });

  it.each(providers)("%s streams text through the shared parser", async (_name, Ctor) => {
    const t = streaming([
      sse({ choices: [{ delta: { content: "hi" } }] }),
      "data: [DONE]\n\n",
    ]);
    const a = new Ctor({ provider: provider({ name: _name }), transport: t });
    const chunks = await drain(a.stream({ model: "m", messages: [{ role: "user", content: "x" }] }));
    expect(chunks.filter((c) => c.type === "text").map((c: any) => c.text).join("")).toBe("hi");
  });
});