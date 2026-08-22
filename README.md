<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-97%20passing-brightgreen" alt="tests">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic LLM client SDK for Node, Bun, Deno, and browsers.</strong><br>
  Streaming, tool calling, circuit breaker, retry, reasoning normalization, and more — zero runtime dependencies.
</p>

---

## Why another LLM SDK?

Most LLM SDKs lock you into one provider. This SDK gives you a **single interface** to talk to OpenAI, Anthropic, Google Gemini, Azure OpenAI, Groq, and Ollama — with automatic retries, circuit breakers, streaming, tool-call parsing, and reasoning normalization baked in.

**Zero runtime dependencies.** Runs everywhere: Node 18+, Bun, Deno, browsers, VS Code extensions, CLIs.

## Install

```bash
npm install @hilbras/sdk
```

## Quick Start

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
  adapter: "openai",
  models: [
    { id: "gpt-4.1", contextWindow: 1_048_576, maxOutputTokens: 32_768,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: true, parallelTools: true, systemPrompts: true } },
  ],
});

// Streaming
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-4.1",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

// Non-streaming
const reply = await client.complete({
  provider: "OpenAI",
  model: "gpt-4.1",
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Supported Providers

| Provider | Adapter | Streaming | Tool Calls | Reasoning | Notes |
|----------|---------|-----------|------------|-----------|-------|
| **OpenAI** | `openai` | ✅ | ✅ native + text-embedded | ✅ | GPT-4.1, o3, o4-mini, etc. |
| **Anthropic** | `anthropic` | ✅ | ✅ native | ✅ | Claude Opus 4, Sonnet 4, etc. |
| **Google Gemini** | `google-genai` | ✅ | ✅ native | ✅ | Gemini 2.5 Pro/Flash |
| **Azure OpenAI** | `azure` | ✅ | ✅ native | ✅ | Deployment routing, api-key auth |
| **Groq** | `groq` | ✅ | ✅ text-embedded | ✅ | Ultra-fast inference, Llama 4 |
| **Ollama** | `ollama` | ✅ | ✅ text-embedded | ✅ | Local models, no API key |

## Features

### Tool Calling

Works with providers that support native function calling AND models that emit tool calls as text (Qwen/Hermes-style `<tool_call>` markup):

```typescript
const chunks = client.stream({
  provider: "OpenAI",
  model: "gpt-4.1",
  messages: [{ role: "user", content: "Read /etc/hosts" }],
  tools: [{
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path" } },
        required: ["path"],
      },
    },
  }],
});

for await (const chunk of chunks) {
  if (chunk.type === "tool_call") {
    console.log(`Tool: ${chunk.name}`, JSON.parse(chunk.argumentsDelta));
  }
}
```

### Reasoning / Thinking

Automatically detects and normalizes reasoning content from multiple formats:

- **Native fields:** `reasoning_content`, `thinking` deltas (DeepSeek, Qwen)
- **Tag-based:** `<thinking>...</thinking>`, `<reasoning>...</reasoning>` markup

```typescript
for await (const chunk of client.stream({ ... })) {
  if (chunk.type === "reasoning") {
    console.log("Thinking:", chunk.text);
  } else if (chunk.type === "text") {
    process.stdout.write(chunk.text);
  }
}
```

### Circuit Breaker

Automatically stops hammering a failing provider after 5 consecutive failures, then half-opens to test recovery:

```typescript
import { getCircuitBreakerRegistry } from "@hilbras/sdk";

// Inspect state
const cb = getCircuitBreakerRegistry().getOrCreate("OpenAI");
console.log(cb.state);  // "closed" | "open" | "half_open"
console.log(cb.stats);  // { failureCount, successCount, ... }
```

### Retry with Backoff

Exponential backoff with jitter for 429, 500, 502, 503, 504 errors:

```typescript
import { createRetryConfig } from "@hilbras/sdk";

const retryConfig = createRetryConfig({
  maxRetries: 5,
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
  retryableNetworkErrors: true,
});
```

### Token Counting & Cost Estimation

```typescript
import { estimateTokens, estimateCost, estimateMessageTokens } from "@hilbras/sdk";

estimateTokens("Hello, world!");  // ~4 tokens

const cost = estimateCost(1000, 500, "openai", "gpt-4.1");
// { inputCost: 0.002, outputCost: 0.004, totalCost: 0.006, currency: "USD" }
```

### Prompt Caching

Mark messages for caching (Anthropic, OpenAI):

```typescript
import { cacheSystemMessage, autoCache } from "@hilbras/sdk";

// Cache the system message
const cached = cacheSystemMessage(messages);

// Auto-cache system + first user message
const auto = autoCache(messages);
```

### Graceful Degradation

When a request fails (context overflow, media too large), progressively strip content:

```typescript
import { withDegradation, createDegradationChain } from "@hilbras/sdk";

const { response, level } = await withDegradation(
  transport,
  url,
  messages,
  (msgs) => ({ method: "POST", body: JSON.stringify({ messages: msgs }) }),
);
console.log(`Succeeded at degradation level: ${level}`);
// "normal" → "media-degraded" → "media-stripped" → "history-truncated"
```

### Middleware

Intercept and transform requests:

```typescript
import { composeMiddlewares, authMiddleware, loggingMiddleware, retryMiddleware } from "@hilbras/sdk";

const pipeline = composeMiddlewares(
  loggingMiddleware(console.log),
  authMiddleware(() => getToken()),
  retryMiddleware(3, 1000),
);
```

### Configuration

Layered config with precedence: **runtime > env vars > file > defaults**:

```typescript
import { loadConfig } from "@hilbras/sdk";

const config = loadConfig({
  configPath: "./hilbras.config.json",
  overrides: { temperature: 0.5 },
});
```

Environment variables (prefix `HILBRAS_`):
```
HILBRAS_DEFAULT_PROVIDER=openai
HILBRAS_DEFAULT_MODEL=gpt-4.1
HILBRAS_TEMPERATURE=0.7
HILBRAS_MAX_TOKENS=4096
HILBRAS_LOG_LEVEL=debug
HILBRAS_TIMEOUT=60000
```

## Architecture

```
@hilbras/sdk
├── client/          # HilbrasClient — main entry point
├── adapters/        # Provider-specific wire format converters
│   ├── openai.ts    # OpenAI Chat Completions API
│   ├── anthropic.ts # Anthropic Messages API
│   ├── google-genai.ts  # Google Gemini API
│   ├── azure.ts     # Azure OpenAI (deployment routing)
│   ├── groq.ts      # Groq (OpenAI-compatible, fast inference)
│   ├── ollama.ts    # Ollama (local models)
│   └── text-tool-call-parser.ts  # <tool_call> markup parser
├── transport/       # HTTP abstraction (Fetch, WebSocket)
├── reliability/     # Circuit breaker, retry, backoff, timeout, degradation
├── middleware/       # Request pipeline (auth, logging, caching, rate-limit)
├── tokens/          # Token counting, prompt caching, cost estimation
├── config/          # Layered config, prompt builder
├── credentials/     # Secret resolution
├── reasoning/       # Thinking/reasoning tag normalizer
├── errors/          # Typed error hierarchy
├── logging/         # Redacting logger
├── types/           # Canonical message, tool, stream, model types
└── catalog/         # Built-in model catalog
```

## Subpath Imports

For tree-shaking, import specific modules:

```typescript
import { HilbrasClient } from "@hilbras/sdk";                          // Full SDK
import { OpenAIAdapter } from "@hilbras/sdk/adapters/openai";          // Single adapter
import { estimateTokens } from "@hilbras/sdk/tokens";                  // Token utilities
import { loadConfig } from "@hilbras/sdk/config";                      // Config
import { FetchTransport } from "@hilbras/sdk/transport/fetch";         // Transport
import { CircuitBreaker } from "@hilbras/sdk/reliability/circuit-breaker"; // Reliability
```

## Error Handling

All errors extend `HilbrasSdkError` for easy catching:

```typescript
import {
  HilbrasSdkError,
  ProviderNotFoundError,
  ModelNotFoundError,
  ProviderRequestError,
  CircuitBreakerOpenError,
} from "@hilbras/sdk";

try {
  for await (const chunk of client.stream({ ... })) { ... }
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    console.error(`Provider ${err.providerName} is circuit-broken`);
  } else if (err instanceof ProviderRequestError) {
    console.error(`HTTP ${err.status} from ${err.providerName}: ${err.body}`);
  } else if (err instanceof HilbrasSdkError) {
    console.error(err.message);
  }
}
```

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run tests (97 tests)
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## Tests

97 tests across 11 test files covering:
- All 6 provider adapters (streaming + non-streaming)
- Text-embedded tool call parsing (XML + JSON)
- Circuit breaker state machine
- Retry policies
- Token counting and cost estimation
- Config loading (env, file, overrides)
- Middleware pipeline (auth, logging, retry, cache, rate-limit)
- Graceful degradation chain

## License

MIT
