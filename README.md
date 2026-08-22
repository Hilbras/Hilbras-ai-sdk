<p align="center">
  <img src="https://img.shields.io/badge/version-0.5.1-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-181%20passing-brightgreen" alt="tests">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic AI infrastructure SDK.</strong><br>
  One interface. Any provider. Intelligent execution. Zero runtime dependencies.
</p>

---

## Why this SDK?

The market is crowded with LLM SDKs that just wrap provider APIs. Hilbras SDK goes further — it abstracts **model selection, reliability, cost, and provider differences** so your application doesn't have to.

```text
Application
     │
     ▼
┌─────────────────────────────────────────┐
│             @hilbras/sdk                │
│                                         │
│ Universal Provider Contract             │
│ Plugin Registry                         │
│ Streaming & Tool Calling                │
│ Reasoning Normalization                 │
│ Circuit Breaker & Retry                 │
│ Token Counting & Cost Estimation        │
│ Prompt Caching                          │
│ Graceful Degradation                    │
│ Middleware Pipeline                      │
└────────────────────┬────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     OpenAI      Anthropic      Gemini
        │            │            │
      Groq         Ollama       Custom
```

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
    { id: "gpt-5.6-sol", contextWindow: 1_048_576, maxOutputTokens: 131_072,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: true, parallelTools: true, systemPrompts: true } },
  ],
});

// Streaming
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

// Non-streaming
const reply = await client.complete({
  provider: "OpenAI",
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Supported Providers

| Provider | Adapter | Streaming | Tool Calls | Reasoning | Models |
|----------|---------|-----------|------------|-----------|--------|
| **OpenAI** | `openai` | ✅ | ✅ native + text-embedded | ✅ | GPT-5.6 Sol/Terra/Luna, o3, o4-mini |
| **Anthropic** | `anthropic` | ✅ | ✅ native | ✅ | Claude Fable 5, Opus 5, Sonnet 5, Haiku 4.5 |
| **Google Gemini** | `google-genai` | ✅ | ✅ native | ✅ | Gemini 3.7/3.6/3.5 Flash, 3.1 Pro |
| **Azure OpenAI** | `azure` | ✅ | ✅ native | ✅ | GPT-5.6 Sol/Terra, o3 |
| **Groq** | `groq` | ✅ | ✅ text-embedded | ✅ | GPT-OSS 120B, MiniMax M2.7, Qwen 3.6 |
| **Ollama** | `ollama` | ✅ | ✅ text-embedded | ✅ | Llama 4, Qwen 3, DeepSeek R1 |

## Execution Policies

Control reliability, timeout, retry, backoff, and circuit breaker — globally or per-request:

```typescript
// Named preset
client.stream({ ..., policy: { preset: "production" } });

// Custom policy
client.stream({ ..., policy: { retry: { maxRetries: 5 }, timeout: { requestTimeoutMs: 10_000 } } });

// Preset with overrides
client.stream({ ..., policy: { preset: "maximum", circuitBreaker: { enabled: false } } });
```

### Presets

| Preset | Retries | Timeout | Circuit Breaker | Use case |
|--------|---------|---------|-----------------|----------|
| `balanced` | 3 | 60s | On (5 failures) | Default — most apps |
| `production` | 5 | 120s | On (5 failures) | Conservative, reliable |
| `fast` | 1 | 15s | On (3 failures) | Latency-sensitive |
| `cheap` | 10 | 300s | Off | Cost > speed |
| `maximum` | 10 | 300s | On (10 failures) | Critical operations |

### SDKConfig Integration

```typescript
import { HilbrasClient, loadConfig } from "@hilbras/sdk";

const config = loadConfig({ configPath: "./hilbras.config.json" });
const client = new HilbrasClient({ sdkConfig: config });
```

Priority: `per-request policy > client default > SDKConfig > balanced preset`

## Universal Provider Contract

All adapters implement the `AIProvider` interface — the foundation for the plugin system:

```typescript
import type { AIProvider } from "@hilbras/sdk/adapter";

class MyCustomAdapter implements AIProvider {
  readonly id = "my-provider";

  async *stream(params: GenerateParams) {
    // Your provider logic
  }

  async complete(params: GenerateParams): Promise<string> {
    // Your provider logic
  }
}
```

## Plugin System

Register custom providers without modifying the SDK:

```typescript
import { HilbrasClient, getDefaultAdapterRegistry } from "@hilbras/sdk";

const client = new HilbrasClient();

// Register a custom adapter
client.adapterRegistry.register("mistral", (config) => new MistralAdapter(config));

// Use it like any built-in provider
client.addProvider({
  name: "Mistral",
  baseUrl: "https://api.mistral.ai/v1",
  authentication: { type: "bearer", apiKey: "..." },
  adapter: "mistral" as any,
  models: [],
});
```

Or create a minimal registry with only what you need:

```typescript
import { AdapterRegistry, OpenAIAdapter } from "@hilbras/sdk";

const registry = new AdapterRegistry();
registry.register("openai", (config) => new OpenAIAdapter(config));

const client = new HilbrasClient({ adapterRegistry: registry });
```

## Features

### Tool Calling

Works with native function calling AND text-embedded `<tool_call>` markup:

```typescript
const chunks = client.stream({
  provider: "OpenAI",
  model: "gpt-5.6-sol",
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

Automatically detects and normalizes reasoning from native fields and `<thinking>`/`<reasoning>` tags:

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

Stops hammering a failing provider after 5 consecutive failures, then half-opens to test recovery:

```typescript
import { getCircuitBreakerRegistry } from "@hilbras/sdk";

const cb = getCircuitBreakerRegistry().getOrCreate("OpenAI");
console.log(cb.state);  // "closed" | "open" | "half_open"
```

### Token Counting & Cost Estimation

```typescript
import { estimateTokens, estimateCost } from "@hilbras/sdk";

estimateTokens("Hello, world!");  // ~4 tokens

const cost = estimateCost(1000, 500, "openai", "gpt-5.6-sol");
// { inputCost: 0.004, outputCost: 0.01, totalCost: 0.014, currency: "USD" }
```

### Prompt Caching

```typescript
import { cacheSystemMessage, autoCache } from "@hilbras/sdk";

const cached = cacheSystemMessage(messages);
const auto = autoCache(messages);
```

### Graceful Degradation

Progressively strips content when requests fail:

```typescript
import { withDegradation } from "@hilbras/sdk";

const { response, level } = await withDegradation(transport, url, messages, buildRequest);
// "normal" → "media-degraded" → "media-stripped" → "history-truncated"
```

### Middleware

```typescript
import { composeMiddlewares, authMiddleware, loggingMiddleware, retryMiddleware } from "@hilbras/sdk";

const pipeline = composeMiddlewares(
  loggingMiddleware(console.log),
  authMiddleware(() => getToken()),
  retryMiddleware(3, 1000),
);
```

## Subpath Imports

```typescript
import { HilbrasClient } from "@hilbras/sdk";                          // Full SDK
import { OpenAIAdapter } from "@hilbras/sdk/adapters/openai";          // Single adapter
import type { AIProvider } from "@hilbras/sdk/adapter";                // Provider contract
import { estimateTokens } from "@hilbras/sdk/tokens";                  // Token utilities
import { loadConfig } from "@hilbras/sdk/config";                      // Config
import { FetchTransport } from "@hilbras/sdk/transport/fetch";         // Transport
```

## Error Handling

All errors extend `HilbrasSdkError`:

```typescript
import { HilbrasSdkError, ProviderRequestError, CircuitBreakerOpenError } from "@hilbras/sdk";

try {
  for await (const chunk of client.stream({ ... })) { ... }
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    console.error(`Provider ${err.providerName} is circuit-broken`);
  } else if (err instanceof ProviderRequestError) {
    console.error(`HTTP ${err.status} from ${err.providerName}: ${err.body}`);
  }
}
```

## Architecture

```text
@hilbras/sdk
├── types/adapter.ts          # AIProvider contract, AdapterConfig, GenerateParams
├── client/client.ts          # HilbrasClient — main entry point
├── providers/
│   ├── registry.ts           # ProviderRegistry
│   └── adapter-registry.ts   # Plugin system — AdapterRegistry
├── adapters/                 # Provider wire-format converters
│   ├── openai.ts, anthropic.ts, google-genai.ts
│   ├── azure.ts, groq.ts, ollama.ts
│   └── text-tool-call-parser.ts
├── transport/                # HTTP abstraction (Fetch, WebSocket)
├── reliability/              # Circuit breaker, retry, backoff, timeout, degradation
├── middleware/                # Auth, logging, caching, rate-limit
├── tokens/                   # Token counting, prompt caching, cost estimation
├── config/                   # Layered config, prompt builder
├── credentials/              # Secret resolution
├── reasoning/                # Thinking/reasoning tag normalizer
├── errors/                   # Typed error hierarchy
├── logging/                  # Redacting logger
├── types/                    # Canonical message, tool, stream, model types
└── catalog/                  # Built-in model catalog (50+ models)
```

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run tests (130 tests)
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## Model Router

Let Hilbras pick the best model for your task:

```typescript
// Hilbras evaluates all providers and picks the best match
client.stream({ task: "coding", messages, policy: { maxCost: 0.05 } });

// Or access the router directly
const best = client.router.best({ task: "coding", needsTools: true, budget: "medium" });
console.log(best.provider, best.model, best.score);
```

The router filters by capabilities, cost, context window, and speed — then scores by task type.

## Structured Output

Define a schema, Hilbras validates and auto-repairs invalid JSON:

```typescript
import { z } from "zod";

const user = await client.complete({
  provider: "OpenAI",
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "Create a user profile for John, age 24" }],
  output: { schema: z.object({ name: z.string(), age: z.number() }) },
});
// user is typed as { name: string; age: number }
```

Works with Zod, Valibot, or any `.safeParse()` validator. On validation failure, Hilbras automatically sends a repair prompt and retries.

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| [v0.5.1](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.5.1) | 2026-08-23 | Explainable routing, TaskType taxonomy, output→router auto-connect, 181 tests |
| [v0.5.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.5.0) | 2026-08-23 | Model Router, Structured Output with auto-repair, 178 tests |
| [v0.4.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.4.0) | 2026-08-22 | Execution Policies, SDKConfig wiring, 146 tests |
| [v0.3.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.3.0) | 2026-08-22 | AIProvider contract, plugin registry, 2026 model catalog |
| [v0.2.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.2.0) | 2026-08-22 | All-adapter complete(), timeout enforcement, docs |
| v0.1.0 | 2026-07-21 | Initial release |

See [CHANGELOG.md](CHANGELOG.md) for full details.

## License

MIT
