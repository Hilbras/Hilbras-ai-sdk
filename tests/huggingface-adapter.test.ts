import { describe, it, expect } from "vitest";
import { HuggingFaceAdapter } from "../src/adapters/huggingface.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "huggingface",
  baseUrl: "https://api-inference.huggingface.co",
  authentication: { type: "bearer", apiKey: "hf_xxxxxxxxxxxx" },
  adapter: "huggingface",
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", contextWindow: 131_072, maxOutputTokens: 16_384, capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
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

describe("HuggingFaceAdapter", () => {
  it("uses OpenAI-compatible chat endpoint by default", async () => {
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

    const adapter = new HuggingFaceAdapter({ provider, transport });
    const chunks = adapter.stream({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    });

    try {
      for await (const _chunk of chunks) { /* drain */ }
    } catch { /* transport returns empty */ }

    expect(capturedUrl).toBe(
      "https://api-inference.huggingface.co/models/meta-llama%2FLlama-3.3-70B-Instruct/v1/chat/completions"
    );
    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("meta-llama/Llama-3.3-70B-Instruct");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.stream).toBe(true);
  });

  it("uses legacy task endpoint when useOpenAICompat is false", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Hi" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const providerNoCompat: ProviderConfig = {
      ...provider,
      extraHeaders: { useOpenAICompat: "false" },
    };
    const adapter = new HuggingFaceAdapter({
      provider: providerNoCompat,
      transport,
      useOpenAICompat: false,
    });
    await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toBe(
      "https://api-inference.huggingface.co/models/meta-llama%2FLlama-3.3-70B-Instruct"
    );
  });

  it("URL-encodes model IDs with special characters", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Hi" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await adapter.complete({
      model: "meta-llama/Llama-3.1-8B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("meta-llama%2FLlama-3.1-8B-Instruct");
  });

  it("non-streaming complete returns content from choices", async () => {
    const transport: Transport = {
      async request() {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello from HF" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    const result = await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result).toBe("Hello from HF");
  });

  it("converts system messages", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Hi" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    });

    const body = JSON.parse(capturedBody);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("You are helpful");
  });

  it("converts tools to OpenAI format", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Done" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
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
    expect(body.tools[0].function.name).toBe("get_weather");
    expect(body.tool_choice).toBe("auto");
  });

  it("passes temperature and maxTokens", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Done" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.7,
      maxTokens: 1024,
    });

    const body = JSON.parse(capturedBody);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(1024);
  });

  it("parses streaming text events", async () => {
    const chunks = [
      sse({ choices: [{ delta: { content: "Hello" } }] }),
      sse({ choices: [{ delta: { content: " world" } }] }),
      sse({ choices: [{ finish_reason: "stop" }] }),
    ];

    const adapter = new HuggingFaceAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      results.push(chunk);
    }

    const textChunks = results.filter((c: any) => c.type === "text");
    expect(textChunks).toHaveLength(2);
    expect((textChunks[0] as any).text).toBe("Hello");
    expect((textChunks[1] as any).text).toBe(" world");
  });

  it("parses streaming tool calls", async () => {
    const chunks = [
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"NYC"}' } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ];

    const adapter = new HuggingFaceAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Weather?" }],
    })) {
      results.push(chunk);
    }

    const toolCalls = results.filter((c: any) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as any).name).toBe("get_weather");
    expect((toolCalls[0] as any).argumentsDelta).toContain("NYC");
    expect((toolCalls[0] as any).done).toBe(true);
  });

  it("parses usage from stream", async () => {
    const chunks = [
      sse({ choices: [{ delta: { content: "Hi" } }] }),
      sse({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    ];

    const adapter = new HuggingFaceAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      results.push(chunk);
    }

    const usageChunks = results.filter((c: any) => c.type === "usage");
    expect(usageChunks).toHaveLength(1);
    expect((usageChunks[0] as any).inputTokens).toBe(10);
    expect((usageChunks[0] as any).outputTokens).toBe(5);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: "Model loading" }), { status: 503 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await expect(
      adapter.complete({
        model: "meta-llama/Llama-3.3-70B-Instruct",
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toThrow(ProviderRequestError);
  });

  it("includes Authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(_url, opts) {
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Hi" } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    await adapter.complete({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedHeaders["Authorization"]).toBe("Bearer hf_xxxxxxxxxxxx");
  });

  it("embeds via task endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify([[0.1, 0.2, 0.3]]),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new HuggingFaceAdapter({ provider, transport });
    const result = await adapter.embed({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      input: "Hello world",
    });

    expect(capturedUrl).toContain("/models/sentence-transformers%2Fall-MiniLM-L6-v2");
    const body = JSON.parse(capturedBody);
    expect(body.inputs).toEqual(["Hello world"]);
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
  });
});
