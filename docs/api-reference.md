# API Reference

Complete reference for all public types, functions, and classes exported by `@hilbras/sdk`.

## Table of Contents

- [Client](#client)
- [Types](#types)
- [Adapters](#adapters)
- [Transport](#transport)
- [Reliability](#reliability)
- [Middleware](#middleware)
- [Tokens](#tokens)
- [Config](#config)
- [Credentials](#credentials)
- [Reasoning](#reasoning)
- [Errors](#errors)
- [Logging](#logging)
- [Catalog](#catalog)

---

## Client

### `HilbrasClient`

The main entry point. Manages providers, adapters, and the reliability pipeline.

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient({ transport?: Transport });
```

#### `client.addProvider(config: ProviderConfig): void`

Register a provider. Automatically creates the appropriate adapter based on `config.adapter`.

#### `client.removeProvider(name: string): void`

Unregister a provider and dispose its adapter.

#### `client.getProvider(name: string): ProviderConfig | undefined`

Look up a provider by name.

#### `client.listProviders(): ProviderConfig[]`

List all registered providers.

#### `client.findModel(modelId: string): { provider, model } | null`

Search all registered providers for a model by ID.

#### `client.stream(params): AsyncGenerator<StreamChunk>`

Stream a chat completion. Retries on transient failures with exponential backoff.

**Params:**
```typescript
{
  provider: string;          // Provider name
  model: string;             // Model ID
  messages: Array<Record<string, unknown> | Message>;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  extra?: Record<string, unknown>;  // Provider-specific params
  signal?: AbortSignal;
}
```

**Yields:** `TextChunk | ReasoningChunk | ToolCallChunk | UsageChunk | ErrorChunk | FinishChunk`

#### `client.complete(params): Promise<string>`

Non-streaming chat completion. Same params as `stream()`, returns the full text response.

#### `client.dispose(): Promise<void>`

Abort in-flight requests, clear providers and adapters. Also available via `await using client`.

---

## Types

### `Message`

```typescript
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
```

### `Tool`

```typescript
interface Tool {
  type: "function";
  function: ToolFunction;
}

interface ToolFunction {
  name: string;
  description: string;
  parameters: ToolParameters;
}

interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required: string[];
}
```

### `StreamChunk` (Discriminated Union)

```typescript
type StreamChunk =
  | TextChunk          // { type: "text", text: string }
  | ReasoningChunk     // { type: "reasoning", text: string }
  | ToolCallChunk      // { type: "tool_call", id, name?, argumentsDelta?, index?, done? }
  | UsageChunk         // { type: "usage", inputTokens, outputTokens, totalTokens }
  | ErrorChunk         // { type: "error", message, retryable }
  | FinishChunk;       // { type: "finish", reason }
```

### `ProviderConfig`

```typescript
interface ProviderConfig {
  name: string;
  baseUrl: string;
  authentication: Authentication;
  models: Model[];
  adapter: AdapterName;
  timeout?: number;          // ms, enforced via AbortSignal
  extraHeaders?: Record<string, string>;
}
```

### `AdapterName`

```typescript
type AdapterName = "openai" | "anthropic" | "responses" | "google-genai" | "azure" | "groq" | "ollama";
```

### `Model`

```typescript
interface Model {
  id: string;
  contextWindow: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
}

interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  parallelTools: boolean;
  systemPrompts: boolean;
}
```

### Helper Functions

- `messageToDict(msg: Message): Record<string, unknown>` — Convert Message to API-ready dict
- `dictToMessage(raw: Record<string, unknown>): Message` — Convert dict to Message
- `chunk.text(text)` / `chunk.reasoning(text)` / `chunk.toolCall(id, name, args)` / `chunk.usage(input, output)` / `chunk.error(msg)` — Stream chunk constructors

---

## Adapters

All adapters implement the same interface:

```typescript
{
  stream(params: StreamParams): AsyncGenerator<StreamChunk>;
  complete(params: CompleteParams): Promise<string>;
}
```

### `OpenAIAdapter`

Handles the OpenAI Chat Completions API and any OpenAI-compatible provider.

- Detects native tool call deltas (`tool_calls` in response)
- Falls back to text-embedded tool call parsing (`<tool_call>` markup)
- Retries without `max_tokens` if provider rejects it as too large
- Normalizes reasoning via `ReasoningNormalizer`

### `AnthropicAdapter`

Handles the Anthropic Messages API.

- Extracts system prompt to top-level `system` field (not a message)
- Converts tools to `input_schema` format
- Uses `x-api-key` header instead of `Authorization: Bearer`
- Parses `content_block_start`, `content_block_delta`, `content_block_stop` events

### `GoogleGenAIAdapter`

Handles Google Gemini (Vertex AI / AI Studio) API.

- System instruction as top-level `systemInstruction` field
- Maps `assistant` role to `model` role
- Tool calls via `functionCall` parts
- SSE streaming with `alt=sse` query parameter

### `AzureAdapter`

Handles Azure OpenAI deployments.

- Routes through `/openai/deployments/{deployment}/chat/completions`
- Uses `api-key` header instead of `Authorization: Bearer`
- Requires `api-version` query parameter (default: `2024-10-21-preview`)

### `GroqAdapter`

OpenAI-compatible adapter for Groq's fast inference.

- Bearer token auth (like OpenAI)
- No native tool calling — uses text-embedded `<tool_call>` parsing
- Supports reasoning tag detection

### `OllamaAdapter`

OpenAI-compatible adapter for Ollama local models.

- No API key required
- Uses `options.num_predict` for max tokens
- Passes through to OpenAI-compatible `/v1/chat/completions`

### `TextToolCallParser`

Parses `<tool_call>` blocks from content stream. Supports:

1. **XML variant:** `<function=NAME><parameter=KEY>VALUE