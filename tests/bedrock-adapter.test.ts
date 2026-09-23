import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { BedrockAdapter } from "../src/adapters/bedrock.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "bedrock",
  baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
  authentication: { type: "bearer", apiKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  extraHeaders: {
    "x-aws-access-key-id": "AKIAIOSFODNN7EXAMPLE",
  },
  adapter: "bedrock",
  models: [
    { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", contextWindow: 200_000, maxOutputTokens: 8_192, capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
  ],
};

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockTransport(chunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200 }); },
    async stream() { return stream; },
    abort() {},
  };
}

function mockTransportComplete(body: Record<string, unknown>): Transport {
  return {
    async request() {
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async stream() { throw new Error("unused"); },
    abort() {},
  };
}

describe("BedrockAdapter", () => {
  it("uses converse-stream endpoint for streaming", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        return new Response(null, { status: 200 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    const chunks = adapter.stream({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "Hi" }],
    });

    // Consume the async generator to trigger the request
    try {
      for await (const _chunk of chunks) { /* drain */ }
    } catch { /* transport returns empty */ }

    expect(capturedUrl).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse-stream"
    );
    const body = JSON.parse(capturedBody);
    expect(body.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("uses converse endpoint for non-streaming", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            output: { content: [{ text: "Hello" }] },
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    const result = await adapter.complete({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse"
    );
    expect(result).toBe("Hello");
  });

  it("supports shorthand model names", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("anthropic.claude-3-5-sonnet-20241022-v2:0");
  });

  it("passes full model IDs through unchanged", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "meta.llama3-1-70b-instruct-v1:0",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("meta.llama3-1-70b-instruct-v1:0");
  });

  it("extracts region from baseUrl", async () => {
    const providerUsWest: ProviderConfig = {
      ...provider,
      baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
    };
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider: providerUsWest, transport });
    await adapter.complete({
      model: "claude-haiku",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("us-west-2");
  });

  it("converts system messages to system field", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    });

    const body = JSON.parse(capturedBody);
    expect(body.system).toEqual([{ text: "You are helpful" }]);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("converts tool calls in assistant messages", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Done" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"NYC"}' },
          }],
        },
        {
          role: "tool",
          content: '{"temp":72}',
          tool_call_id: "call_1",
        },
      ],
    });

    const body = JSON.parse(capturedBody);
    expect(body.messages[0].content[0].toolUse).toEqual({
      id: "call_1",
      name: "get_weather",
      input: { city: "NYC" },
    });
    expect(body.messages[1].content[0].toolResult).toEqual({
      toolUseId: "call_1",
      content: [{ text: '{"temp":72}' }],
    });
  });

  it("converts tools to Bedrock toolSpec format", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Done" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Weather?" }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      }],
    });

    const body = JSON.parse(capturedBody);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].toolSpec.name).toBe("get_weather");
    expect(body.tools[0].toolSpec.inputSchema.json).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
    });
  });

  it("passes temperature and maxTokens in inferenceConfig", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Done" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.7,
      maxTokens: 1024,
    });

    const body = JSON.parse(capturedBody);
    expect(body.inferenceConfig).toEqual({ temperature: 0.7, maxTokens: 1024 });
  });

  it("parses streaming text events", async () => {
    const chunks = [
      sse({ $type: "contentBlockStart", contentBlockIndex: 0, start: {} }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { text: "Hello" } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { text: " world" } }),
      sse({ $type: "contentBlockStop", contentBlockIndex: 0 }),
      sse({ $type: "metadata", usage: { inputTokens: 10, outputTokens: 5 } }),
      sse({ $type: "messageStop" }),
    ];

    const adapter = new BedrockAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      results.push(chunk);
    }

    const textChunks = results.filter((c: any) => c.type === "text");
    expect(textChunks).toHaveLength(2);
    expect((textChunks[0] as any).text).toBe("Hello");
    expect((textChunks[1] as any).text).toBe(" world");

    const usageChunks = results.filter((c: any) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect((usageChunks[0] as any).inputTokens).toBe(10);
  });

  it("parses streaming tool calls", async () => {
    const chunks = [
      sse({ $type: "contentBlockStart", contentBlockIndex: 0, start: { toolUse: { toolUseId: "call_1", name: "get_weather" } } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { toolUse: { input: '{"city":' } } }),
      sse({ $type: "contentBlockDelta", contentBlockIndex: 0, delta: { toolUse: { input: '"NYC"}' } } }),
      sse({ $type: "contentBlockStop", contentBlockIndex: 0 }),
      sse({ $type: "messageStop" }),
    ];

    const adapter = new BedrockAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Weather?" }],
    })) {
      results.push(chunk);
    }

    const toolCalls = results.filter((c: any) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(4);
    expect((toolCalls[0] as any).name).toBe("get_weather");
    expect((toolCalls[0] as any).id).toBe("call_1");
    expect((toolCalls[3] as any).done).toBe(true);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ message: "Access Denied" }), { status: 403 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await expect(
      adapter.complete({
        model: "claude-sonnet",
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toThrow(ProviderRequestError);
  });

  it("throws if access key ID is missing", () => {
    const badProvider: ProviderConfig = {
      ...provider,
      extraHeaders: {},
    };
    expect(() => new BedrockAdapter({ provider: badProvider, transport: mockTransport([]) })).toThrow("x-aws-access-key-id");
  });

  it("throws if auth type is not bearer", () => {
    const badProvider: ProviderConfig = {
      ...provider,
      authentication: { type: "none" },
    };
    expect(() => new BedrockAdapter({ provider: badProvider, transport: mockTransport([]) })).toThrow("bearer");
  });

  it("embeds via invoke endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ embedding: [0.1, 0.2, 0.3], inputTextTokenCount: 5 }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    const result = await adapter.embed({
      model: "cohere.embed-english-v3",
      input: "Hello world",
    });

    expect(capturedUrl).toContain("/model/cohere.embed-english-v3/invoke");
    const body = JSON.parse(capturedBody);
    expect(body.inputText).toBe("Hello world");
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(result.usage.inputTokens).toBe(5);
  });

  it("includes Authorization header with SigV4 signature", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedHeaders = opts.headers as Record<string, string>;
        capturedBody = String(opts.body ?? "");
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedHeaders["Authorization"]).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(capturedHeaders["X-Amz-Date"]).toBeDefined();
    expect(capturedHeaders["X-Amz-Content-Sha256"]).toBe(
      createHash("sha256").update(capturedBody).digest("hex"),
    );
  });

  it("includes session token when provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    const providerWithToken: ProviderConfig = {
      ...provider,
      extraHeaders: {
        "x-aws-access-key-id": "AKIAIOSFODNN7EXAMPLE",
        "x-aws-session-token": "FwoGZXIvYXdzEBYaDHqa0AP",
      },
    };
    const transport: Transport = {
      async request(_url, opts) {
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ output: { content: [{ text: "Hi" }] } }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new BedrockAdapter({ provider: providerWithToken, transport });
    await adapter.complete({
      model: "claude-sonnet",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedHeaders["X-Amz-Security-Token"]).toBe("FwoGZXIvYXdzEBYaDHqa0AP");
  });
});
