/**
 * @hilbras/sdk — Type-level tests
 *
 * Compile-time type safety verification using Vitest's expectTypeOf.
 * These tests verify that the SDK's public API has correct type inference.
 */

import { describe, it, expectTypeOf } from "vitest";
import {
  HilbrasClient,
  tool,
  toolDef,
  dynamicTool,
  generateId,
  createIdGenerator,
  shortId,
  zodSchema,
  jsonSchema,
  extractJson,
  parseJsonEventStream,
  resolvePolicy,
  getPreset,
} from "../src/index.js";
import type {
  Message,
  StreamChunk,
  TextChunk,
  ReasoningChunk,
  ToolCallChunk,
  UsageChunk,
  Tool,
  ProviderConfig,
  Model,
  EmbeddingParams,
  EmbeddingResult,
  ImageParams,
  ImageResult,
  SpeechParams,
  SpeechResult,
  TranscriptionParams,
  TranscriptionResult,
  RerankParams,
  RerankResult,
  DefinedTool,
  ParameterSchema,
  SchemaValidator,
  StructuredOutputConfig,
  SSEEvent,
} from "../src/index.js";
import type { AIProvider, GenerateParams } from "../src/index.js";

// ─── Client Types ───────────────────────────────────────────────────────────

describe("Client types", () => {
  it("HilbrasClient is a class with expected methods", () => {
    const client = new HilbrasClient();
    expectTypeOf(client.complete).toBeFunction();
    expectTypeOf(client.stream).toBeFunction();
    expectTypeOf(client.embed).toBeFunction();
    expectTypeOf(client.generateImage).toBeFunction();
    expectTypeOf(client.generateSpeech).toBeFunction();
    expectTypeOf(client.transcribe).toBeFunction();
    expectTypeOf(client.rerank).toBeFunction();
    expectTypeOf(client.addProvider).toBeFunction();
    expectTypeOf(client.removeProvider).toBeFunction();
    expectTypeOf(client.getProvider).toBeFunction();
    expectTypeOf(client.on).toBeFunction();
    expectTypeOf(client.off).toBeFunction();
    expectTypeOf(client.dispose).toBeFunction();
  });

  it("complete() without provider is typed as Promise<string>", () => {
    const client = new HilbrasClient();
    type CompleteReturn = ReturnType<typeof client.complete>;
    expectTypeOf<CompleteReturn>().resolves.toBeString();
  });
});

// ─── Tool Builder Types ─────────────────────────────────────────────────────

describe("Tool builder types", () => {
  it("tool() returns DefinedTool with typed input/output", () => {
    const myTool = tool({
      name: "get_weather",
      description: "Get weather",
      parameters: {
        location: { type: "string", description: "City" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["location"],
      execute: async (input) => {
        return { temp: 22, condition: "sunny" as string };
      },
    });

    expectTypeOf(myTool).toMatchObjectType<DefinedTool>();
    expectTypeOf(myTool.definition).toMatchObjectType<Tool>();
    expectTypeOf(myTool.execute).toBeFunction();
    expectTypeOf(myTool.inputSchema).toMatchObjectType<ParameterSchema>();
    expectTypeOf(myTool.required).toEqualTypeOf<string[]>();
  });

  it("toolDef() returns Tool (definition only)", () => {
    const def = toolDef({
      name: "search",
      description: "Search",
      parameters: { query: { type: "string" } },
      required: ["query"],
    });
    expectTypeOf(def).toMatchObjectType<Tool>();
  });

  it("dynamicTool() returns Tool | DefinedTool", () => {
    const result = dynamicTool({
      name: "test",
      description: "test",
      parameters: { type: "object", properties: {}, required: [] },
    });
    // Could be either Tool or DefinedTool depending on execute
    expectTypeOf(result).toMatchObjectType<Tool>();
  });
});

// ─── Multi-Modal Types ──────────────────────────────────────────────────────

describe("Multi-modal types", () => {
  it("EmbeddingResult has correct shape", () => {
    const result: EmbeddingResult = {
      embeddings: [[0.1, 0.2]],
      usage: { inputTokens: 10, totalTokens: 10 },
    };
    expectTypeOf(result.embeddings).toEqualTypeOf<number[][]>();
    expectTypeOf(result.usage.inputTokens).toBeNumber();
  });

  it("ImageResult has correct shape", () => {
    const result: ImageResult = {
      images: [{ url: "https://example.com/img.png", revisedPrompt: "a cat" }],
    };
    expectTypeOf(result.images).toEqualTypeOf<Array<{ url?: string; b64Json?: string; revisedPrompt?: string }>>();
  });

  it("SpeechResult has correct shape", () => {
    const result: SpeechResult = {
      audio: new Uint8Array(),
      format: "mp3",
    };
    expectTypeOf(result.audio).toEqualTypeOf<Uint8Array>();
  });

  it("TranscriptionResult has correct shape", () => {
    const result: TranscriptionResult = {
      text: "hello",
      language: "en",
      duration: 10,
      segments: [{ start: 0, end: 10, text: "hello" }],
    };
    expectTypeOf(result.text).toBeString();
    expectTypeOf(result.segments).toEqualTypeOf<Array<{ start: number; end: number; text: string }>>();
  });

  it("RerankResult has correct shape", () => {
    const result: RerankResult = {
      results: [{ index: 0, relevanceScore: 0.95, document: "doc" }],
      usage: { inputTokens: 20, totalTokens: 20 },
    };
    expectTypeOf(result.results).toEqualTypeOf<Array<{ index: number; relevanceScore: number; document?: string }>>();
  });
});

// ─── Stream Chunk Types ─────────────────────────────────────────────────────

describe("Stream chunk types", () => {
  it("StreamChunk is a union of chunk types", () => {
    const textChunk: TextChunk = { type: "text", text: "hello" };
    const reasoningChunk: ReasoningChunk = { type: "reasoning", text: "thinking" };
    const toolCallChunk: ToolCallChunk = { type: "tool_call", id: "1", name: "fn", argumentsDelta: "{}", done: true };
    const usageChunk: UsageChunk = { type: "usage", inputTokens: 10, outputTokens: 5, totalTokens: 15 };

    expectTypeOf(textChunk.type).toEqualTypeOf<"text">();
    expectTypeOf(reasoningChunk.type).toEqualTypeOf<"reasoning">();
    expectTypeOf(toolCallChunk.type).toEqualTypeOf<"tool_call">();
    expectTypeOf(usageChunk.type).toEqualTypeOf<"usage">();
  });
});

// ─── Provider Types ─────────────────────────────────────────────────────────

describe("Provider types", () => {
  it("ProviderConfig has required fields", () => {
    const config: ProviderConfig = {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      authentication: { type: "bearer", apiKey: "sk-test" },
      adapter: "openai",
      models: [{ id: "gpt-4o", contextWindow: 128000, capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } }],
    };
    expectTypeOf(config.name).toBeString();
    expectTypeOf(config.baseUrl).toBeString();
    expectTypeOf(config.authentication).toMatchObjectType<{ type: string; apiKey: string }>();
  });

  it("AIProvider interface has expected methods", () => {
    // This is a compile-time check — if AIProvider shape changes, this will fail
    type ProviderShape = {
      readonly id: string;
      stream(params: GenerateParams): AsyncGenerator<StreamChunk>;
      complete(params: GenerateParams): Promise<string>;
    };
    expectTypeOf<AIProvider>().toMatchObjectType<ProviderShape>();
  });
});

// ─── Schema Helper Types ────────────────────────────────────────────────────

describe("Schema helper types", () => {
  it("jsonSchema() returns StructuredOutputConfig", () => {
    const config = jsonSchema<{ name: string; age: number }>({
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    });
    expectTypeOf(config).toMatchObjectType<StructuredOutputConfig<{ name: string; age: number }>>();
  });

  it("zodSchema() accepts any SchemaValidator", () => {
    // Mock a Zod-like schema validator
    const mockValidator: SchemaValidator<{ name: string }> = {
      safeParse: (data: unknown) => ({ success: true, data: data as { name: string } }),
    };
    const config = zodSchema<{ name: string }>(mockValidator);
    expectTypeOf(config).toMatchObjectType<StructuredOutputConfig<{ name: string }>>();
  });
});

// ─── Utility Types ──────────────────────────────────────────────────────────

describe("Utility types", () => {
  it("generateId returns string", () => {
    const id = generateId();
    expectTypeOf(id).toBeString();
  });

  it("shortId returns string", () => {
    const id = shortId();
    expectTypeOf(id).toBeString();
  });

  it("createIdGenerator returns () => string", () => {
    const gen = createIdGenerator("req");
    expectTypeOf(gen).toBeFunction();
    const id = gen();
    expectTypeOf(id).toBeString();
  });

  it("extractJson returns string", () => {
    const result = extractJson('{"a": 1}');
    expectTypeOf(result).toBeString();
  });
});

// ─── SSE Types ──────────────────────────────────────────────────────────────

describe("SSE types", () => {
  it("SSEEvent has expected shape", () => {
    const event: SSEEvent = { event: "message", data: "hello" };
    expectTypeOf(event.event).toBeString();
    expectTypeOf(event.data).toBeString();
  });
});

// ─── Reliability Types ──────────────────────────────────────────────────────

describe("Reliability types", () => {
  it("resolvePolicy returns ResolvedPolicy", () => {
    const policy = resolvePolicy({ preset: "production" });
    expectTypeOf(policy).toHaveProperty("retry");
    expectTypeOf(policy).toHaveProperty("circuitBreaker");
  });

  it("getPreset returns ExecutionPolicy", () => {
    const preset = getPreset("balanced");
    expectTypeOf(preset).toHaveProperty("retry");
  });
});
