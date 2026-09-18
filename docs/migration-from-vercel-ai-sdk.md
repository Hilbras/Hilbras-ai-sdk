# Migration Guide: From Vercel AI SDK to Hilbras SDK

This guide covers migrating from the Vercel AI SDK (`ai` package) to the Hilbras SDK (`@hilbras/sdk`). It covers API mapping, architectural differences, and common patterns.

## Table of Contents

1. [Quick Comparison](#quick-comparison)
2. [Installation](#installation)
3. [Client Setup](#client-setup)
4. [Streaming](#streaming)
5. [Non-Streaming (Generate Text)](#non-streaming)
6. [Tool Calling](#tool-calling)
7. [Structured Output](#structured-output)
8. [Embeddings](#embeddings)
9. [Image Generation](#image-generation)
10. [Speech (TTS)](#speech-tts)
11. [Transcription (STT)](#transcription-stt)
12. [React Hooks](#react-hooks)
13. [Middleware](#middleware)
14. [Error Handling](#error-handling)
15. [Configuration](#configuration)
16. [Key Differences](#key-differences)

---

## Quick Comparison

| Feature | Vercel AI SDK | Hilbras SDK |
|---------|--------------|-------------|
| Package | `ai` | `@hilbras/sdk` |
| Providers | 35+ (separate packages) | 23 (built-in adapters) |
| Streaming | `streamText()` | `client.stream()` |
| Non-streaming | `generateText()` | `client.complete()` |
| Tool calling | Built-in + approval | Built-in + approval |
| Structured output | `generateObject()` | `client.object()` |
| React hooks | `useChat`, `useCompletion`, `useObject` | `useChat`, `useCompletion`, `useObject` |
| Cost tracking | None | Built-in budgets |
| Circuit breaker | None | Built-in per-provider |
| Runtime deps | 3+ | **Zero** |

---

## Installation

**Vercel AI SDK:**
```bash
npm install ai @ai-sdk/openai
```

**Hilbras SDK:**
```bash
npm install @hilbras/sdk
```

No separate provider packages needed — all adapters are built-in.

---

## Client Setup

**Vercel AI SDK:**
```typescript
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

**Hilbras SDK:**
```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

client.addProvider({
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Using the Config File

Hilbras supports `hilbras.config.json` for declarative configuration:

```json
{
  "providers": [
    {
      "name": "openai",
      "adapter": "openai",
      "apiKey": "${OPENAI_API_KEY}"
    }
  ],
  "defaults": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

---

## Streaming

**Vercel AI SDK:**
```typescript
import { streamText } from "ai";

const result = streamText({
  model: openai("gpt-4o"),
  messages: [{ role: "user", content: "Hello" }],
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

**Hilbras SDK:**
```typescript
const stream = client.stream({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

for await (const chunk of stream) {
  if (chunk.type === "text") {
    process.stdout.write(chunk.text);
  }
}
```

### Stream Chunk Types

Vercel uses `textStream` (string-only). Hilbras yields typed chunks:

```typescript
for await (const chunk of stream) {
  switch (chunk.type) {
    case "text":       // Text content
    case "tool_call":  // Tool invocation
    case "reasoning":  // Thinking/reasoning content
    case "metadata":   // Token usage, model info
    case "error":      // Error during streaming
    case "done":       // Stream complete
  }
}
```

---

## Non-Streaming

**Vercel AI SDK:**
```typescript
import { generateText } from "ai";

const result = await generateText({
  model: openai("gpt-4o"),
  messages: [{ role: "user", content: "Hello" }],
});

console.log(result.text);
console.log(result.usage); // { promptTokens, completionTokens }
```

**Hilbras SDK:**
```typescript
const result = await client.complete({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(result.content);
console.log(result.usage); // { promptTokens, completionTokens, totalTokens }
```

---

## Tool Calling

**Vercel AI SDK:**
```typescript
import { generateText } from "ai";

const result = await generateText({
  model: openai("gpt-4o"),
  messages: [{ role: "user", content: "What's the weather in Paris?" }],
  tools: {
    getWeather: {
      description: "Get weather for a location",
      parameters: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => {
        return { temperature: 22, condition: "sunny" };
      },
    },
  },
  maxSteps: 3, // Allow multi-step tool calls
});
```

**Hilbras SDK:**
```typescript
import { defineTool } from "@hilbras/sdk";

const getWeather = defineTool({
  name: "getWeather",
  description: "Get weather for a location",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name" },
    },
    required: ["location"],
  },
  execute: async (params) => {
    return { temperature: 22, condition: "sunny" };
  },
});

const result = await client.complete({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "What's the weather in Paris?" }],
  tools: [getWeather],
  maxSteps: 3,
});
```

### Key Differences

1. **Tool definition**: Vercel uses Zod schemas; Hilbras uses JSON Schema (no runtime dependency)
2. **Tool execution**: Both support automatic execution; Hilbras returns tool calls in `result.toolCalls`
3. **Approval**: Both support `toolCallStreaming` / manual approval patterns

---

## Structured Output

**Vercel AI SDK:**
```typescript
import { generateObject } from "ai";
import { z } from "zod";

const result = await generateObject({
  model: openai("gpt-4o"),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    }),
  }),
  prompt: "Generate a recipe for pasta carbonara",
});

console.log(result.object.recipe);
```

**Hilbras SDK:**
```typescript
const result = await client.object({
  provider: "openai",
  model: "gpt-4o",
  schema: {
    type: "object",
    properties: {
      recipe: {
        type: "object",
        properties: {
          name: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["name", "ingredients", "steps"],
      },
    },
    required: ["recipe"],
  },
  prompt: "Generate a recipe for pasta carbonara",
});

console.log(result.object.recipe);
```

### Key Differences

1. **Schema format**: Vercel uses Zod; Hilbras uses JSON Schema (no runtime dependency)
2. **Auto-repair**: Both support auto-repair for invalid JSON output
3. **Grammar mode**: Hilbras supports JSON mode (provider-specific) for stricter output

---

## Embeddings

**Vercel AI SDK:**
```typescript
import { embed, embedMany } from "ai";

const { embedding } = await embed({
  model: openai.embedding("text-embedding-3-small"),
  value: "Hello world",
});

const { embeddings } = await embedMany({
  model: openai.embedding("text-embedding-3-small"),
  values: ["Hello", "World"],
});
```

**Hilbras SDK:**
```typescript
const result = await client.embed({
  provider: "openai",
  model: "text-embedding-3-small",
  input: "Hello world",
});

console.log(result.embeddings[0]); // number[]

const batch = await client.embed({
  provider: "openai",
  model: "text-embedding-3-small",
  input: ["Hello", "World"],
});

console.log(batch.embeddings); // number[][]
```

---

## Image Generation

**Vercel AI SDK:**
```typescript
import { generateImage } from "ai";

const { image } = await generateImage({
  model: openai.image("dall-e-3"),
  prompt: "A sunset over mountains",
  size: "1024x1024",
});
```

**Hilbras SDK:**
```typescript
const result = await client.image({
  provider: "openai",
  model: "dall-e-3",
  prompt: "A sunset over mountains",
  size: "1024x1024",
});

console.log(result.images[0].url);
```

---

## Speech (TTS)

**Vercel AI SDK:**
```typescript
import { generateSpeech } from "ai";

const { audio } = await generateSpeech({
  model: openai.speech("tts-1"),
  text: "Hello world",
  voice: "alloy",
});
```

**Hilbras SDK:**
```typescript
const result = await client.speech({
  provider: "openai",
  model: "tts-1",
  input: "Hello world",
  voice: "alloy",
});

// result.audio is a Buffer
```

---

## Transcription (STT)

**Vercel AI SDK:**
```typescript
import { transcribe } from "ai";

const { text } = await transcribe({
  model: openai.transcription("whisper-1"),
  audio: audioBuffer,
});
```

**Hilbras SDK:**
```typescript
const result = await client.transcribe({
  provider: "openai",
  model: "whisper-1",
  audio: audioBuffer,
});

console.log(result.text);
```

---

## React Hooks

Both SDKs provide similar React hooks. The API surface is nearly identical.

### useChat

**Vercel AI SDK:**
```typescript
import { useChat } from "@ai-sdk/react";

function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

**Hilbras SDK:**
```typescript
import { useChat } from "@hilbras/react";

function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

### useCompletion

**Vercel AI SDK:**
```typescript
import { useCompletion } from "@ai-sdk/react";

function Completion() {
  const { completion, input, handleInputChange, handleSubmit } = useCompletion({
    api: "/api/completion",
  });

  return (
    <div>
      <div>{completion}</div>
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

**Hilbras SDK:**
```typescript
import { useCompletion } from "@hilbras/react";

function Completion() {
  const { completion, input, handleInputChange, handleSubmit } = useCompletion({
    api: "/api/completion",
  });

  return (
    <div>
      <div>{completion}</div>
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

### useObject

**Vercel AI SDK:**
```typescript
import { useObject } from "@ai-sdk/react";

function RecipeForm() {
  const { object, submit } = useObject({
    api: "/api/generate-recipe",
    schema: recipeSchema,
  });

  return (
    <div>
      <button onClick={() => submit("pasta carbonara")}>Generate</button>
      {object?.recipe && <div>{object.recipe.name}</div>}
    </div>
  );
}
```

**Hilbras SDK:**
```typescript
import { useObject } from "@hilbras/react";

function RecipeForm() {
  const { object, submit } = useObject({
    api: "/api/generate-recipe",
  });

  return (
    <div>
      <button onClick={() => submit("pasta carbonara")}>Generate</button>
      {object?.recipe && <div>{object.recipe.name}</div>}
    </div>
  );
}
```

---

## Middleware

**Vercel AI SDK:**
```typescript
import { wrapLanguageModel } from "ai";

const customModel = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: {
    wrapGenerate: async ({ doGenerate, params }) => {
      console.log("Generating with params:", params);
      const result = await doGenerate();
      console.log("Tokens used:", result.usage);
      return result;
    },
    wrapStream: async ({ doStream, params }) => {
      console.log("Streaming with params:", params);
      return doStream();
    },
  },
});
```

**Hilbras SDK:**
```typescript
// Middleware is transport-level — intercepts all requests
client.use(async (request, next) => {
  console.log(`Request to ${request.provider}: ${request.model}`);
  const start = Date.now();
  const result = await next(request);
  console.log(`Completed in ${Date.now() - start}ms`);
  return result;
});
```

### Key Difference

- **Vercel**: Middleware wraps individual model instances
- **Hilbras**: Middleware intercepts all requests globally (applies to every provider)

---

## Error Handling

**Vercel AI SDK:**
```typescript
import { generateText } from "ai";

try {
  const result = await generateText({
    model: openai("gpt-4o"),
    messages: [{ role: "user", content: "Hello" }],
  });
} catch (error) {
  if (error instanceof APICallError) {
    console.log(error.statusCode);
    console.log(error.responseBody);
  }
}
```

**Hilbras SDK:**
```typescript
import { HilbrasClient, ProviderNotFoundError, CircuitBreakerOpenError } from "@hilbras/sdk";

try {
  const result = await client.complete({
    provider: "openai",
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
  });
} catch (error) {
  if (error instanceof ProviderNotFoundError) {
    console.log("Provider not configured");
  } else if (error instanceof CircuitBreakerOpenError) {
    console.log("Circuit breaker open — provider is failing");
  }
}
```

### Hilbras-Specific Error Types

| Error | Meaning |
|-------|---------|
| `ProviderNotFoundError` | Provider not registered |
| `ModelNotFoundError` | Model not supported by provider |
| `CircuitBreakerOpenError` | Provider circuit breaker is open |
| `ValidationError` | Request validation failed |
| `ConfigurationError` | Invalid configuration |

---

## Configuration

**Vercel AI SDK:**
```typescript
// Environment variables
// OPENAI_API_KEY=sk-...

// Or pass directly
const openai = createOpenAI({ apiKey: "sk-..." });
```

**Hilbras SDK:**
```typescript
// Environment variables
// OPENAI_API_KEY=sk-...
// Hilbras auto-detects standard env vars for each provider

// Or pass directly
client.addProvider({
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-...",
});

// Or use config file (hilbras.config.json)
// Loaded automatically or via loadConfig()
```

---

## Key Differences

### 1. Zero Runtime Dependencies

Vercel requires Zod for structured output. Hilbras uses JSON Schema — no extra dependencies.

### 2. Built-in Reliability

Hilbras includes circuit breaker, retry with backoff, and graceful degradation out of the box:

```typescript
const client = new HilbrasClient({
  policy: {
    retry: { maxRetries: 3 },
    circuitBreaker: { failureThreshold: 5 },
    timeout: { requestTimeoutMs: 30000 },
  },
});
```

### 3. Cost Enforcement

Hilbras can enforce budgets per session or per request:

```typescript
const client = new HilbrasClient({
  budget: {
    sessionBudget: 10.00,       // $10 per session
    perRequestBudget: 1.00,     // $1 per request
  },
});
```

### 4. Model Router

Route requests across providers based on cost, latency, or custom criteria:

```typescript
const result = await client.complete({
  model: "gpt-4o",  // Hilbras routes to the best provider
  messages: [...],
  route: {
    criteria: ["cost", "latency"],
    fallback: ["anthropic:claude-3-sonnet"],
  },
});
```

### 5. SSRF Protection

Hilbras validates all URLs to prevent SSRF attacks — you can't accidentally register a provider pointing to an internal service.

### 6. API Key Redaction

API keys are automatically redacted in error messages and logs.

---

## Migration Checklist

- [ ] Replace `ai` with `@hilbras/sdk`
- [ ] Remove provider packages (e.g., `@ai-sdk/openai`)
- [ ] Update client initialization
- [ ] Replace `streamText()` with `client.stream()`
- [ ] Replace `generateText()` with `client.complete()`
- [ ] Replace `generateObject()` with `client.object()`
- [ ] Update tool definitions from Zod to JSON Schema
- [ ] Update React hooks imports from `@ai-sdk/react` to `@hilbras/react`
- [ ] Test streaming chunks (Hilbras uses typed chunks, not raw strings)
- [ ] Review error handling (Hilbras has more specific error types)
- [ ] Consider enabling cost budgets and circuit breaker for production

---

## Need Help?

- **GitHub Issues**: https://github.com/Hilbras/Hilbras-ai-sdk/issues
- **Examples**: See `examples/` directory for working code samples
