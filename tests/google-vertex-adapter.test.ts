import { describe, it, expect } from "vitest";
import { VertexAIAdapter } from "../src/adapters/google-vertex.js";
import { ProviderRequestError } from "../src/errors/index.js";
import type { Transport } from "../src/transport/transport.js";
import type { ProviderConfig } from "../src/types/providers.js";

const provider: ProviderConfig = {
  name: "google-vertex",
  baseUrl: "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1",
  authentication: { type: "bearer", apiKey: "ya29.c.b0AXv0zTPz..." },
  adapter: "google-vertex",
  models: [
    { id: "google/gemini-2.5-flash", contextWindow: 1_048_576, maxOutputTokens: 65_536, capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false, parallelTools: false, systemPrompts: true } },
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

describe("VertexAIAdapter", () => {
  it("uses streamGenerateContent endpoint for streaming", async () => {
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

    const adapter = new VertexAIAdapter({ provider, transport });
    const chunks = adapter.stream({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    try {
      for await (const _chunk of chunks) { /* drain */ }
    } catch { /* transport returns empty */ }

    expect(capturedUrl).toContain("streamGenerateContent?alt=sse");
    expect(capturedUrl).toContain("publishers/google/models/gemini-2.5-flash");
    const body = JSON.parse(capturedBody);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
  });

  it("uses generateContent endpoint for non-streaming", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Hello from Vertex" }] } }],
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    const result = await adapter.complete({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("generateContent");
    expect(capturedUrl).not.toContain("streamGenerateContent");
    expect(result).toBe("Hello from Vertex");
  });

  it("extracts project/region/location from baseUrl", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("projects/my-project/locations/us-central1");
  });

  it("supports third-party publishers", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "anthropic/claude-3-5-sonnet@20241022",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("publishers/anthropic/models/claude-3-5-sonnet@20241022");
  });

  it("supports meta publisher for Llama models", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "meta/llama-3.1-405b-instruct-maas",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("publishers/meta/models/llama-3.1-405b-instruct-maas");
  });

  it("converts system messages to systemInstruction", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    });

    const body = JSON.parse(capturedBody);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are helpful" }] });
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
  });

  it("converts tools to functionDeclarations format", async () => {
    let capturedBody = "";
    const transport: Transport = {
      async request(_url, opts) {
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Done" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "google/gemini-2.5-flash",
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
    expect(body.tools[0].functionDeclarations[0].name).toBe("get_weather");
    expect(body.tools[0].functionDeclarations[0].parameters).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
    });
  });

  it("parses streaming text events", async () => {
    const chunks = [
      sse({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] }),
      sse({ candidates: [{ content: { parts: [{ text: " world" }] } }] }),
    ];

    const adapter = new VertexAIAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      results.push(chunk);
    }

    const textChunks = results.filter((c: any) => c.type === "text");
    expect(textChunks).toHaveLength(2);
    expect((textChunks[0] as any).text).toBe("Hello");
    expect((textChunks[1] as any).text).toBe(" world");
  });

  it("parses streaming function calls", async () => {
    const chunks = [
      sse({
        candidates: [{
          content: {
            parts: [{ functionCall: { name: "get_weather", args: { city: "NYC" } } }],
          },
        }],
      }),
    ];

    const adapter = new VertexAIAdapter({ provider, transport: mockTransport(chunks) });
    const results: unknown[] = [];
    for await (const chunk of adapter.stream({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Weather?" }],
    })) {
      results.push(chunk);
    }

    const toolCalls = results.filter((c: any) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as any).name).toBe("get_weather");
    expect((toolCalls[0] as any).argumentsDelta).toBe('{"city":"NYC"}');
    expect((toolCalls[0] as any).done).toBe(true);
  });

  it("throws on non-200 responses", async () => {
    const transport: Transport = {
      async request() {
        return new Response(JSON.stringify({ error: { message: "Permission denied" } }), { status: 403 });
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await expect(
      adapter.complete({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toThrow(ProviderRequestError);
  });

  it("includes Authorization header with Bearer token", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: Transport = {
      async request(_url, opts) {
        capturedHeaders = opts.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    await adapter.complete({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedHeaders["Authorization"]).toMatch(/^Bearer /);
  });

  it("allows overriding project/region via config", async () => {
    let capturedUrl = "";
    const transport: Transport = {
      async request(url) {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({
      provider,
      transport,
      project: "override-project",
      region: "europe-west1",
    });
    await adapter.complete({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toContain("projects/override-project/locations/europe-west1");
    expect(capturedUrl).toContain("europe-west1-aiplatform.googleapis.com");
  });

  it("embeds via predict endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const transport: Transport = {
      async request(url, opts) {
        capturedUrl = url;
        capturedBody = opts.body as string;
        return new Response(
          JSON.stringify({
            predictions: [{ embeddings: { values: [0.1, 0.2, 0.3] } }],
          }),
          { status: 200 }
        );
      },
      async stream() { throw new Error("unused"); },
      abort() {},
    };

    const adapter = new VertexAIAdapter({ provider, transport });
    const result = await adapter.embed({
      model: "google/text-embedding-004",
      input: "Hello world",
    });

    expect(capturedUrl).toContain("publishers/google/models/text-embedding-004:predict");
    const body = JSON.parse(capturedBody);
    expect(body.instances[0].content).toBe("Hello world");
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
  });
});
