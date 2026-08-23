<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-676%20passing-brightgreen" alt="tests">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic AI infrastructure SDK.</strong><br>
  One interface. Any provider. Intelligent execution. Zero runtime dependencies.
</p>

---

## Why Hilbras SDK?

Most LLM SDKs just wrap one provider's API. Hilbras SDK is an **AI Execution Engine** — it optimizes, controls, validates, and observes every request, even when you use only one provider.

```text
Application
     │
     ▼
┌───────────────────────────────────────────────┐
│               @hilbras/sdk                    │
│                                               │
│  Model Router          Execution Policies     │
│  Structured Output     Observability Hooks    │
│  Provider Abstraction  Plugin System          │
│  Streaming & Tools     Reasoning Normalizer   │
│  Circuit Breaker       Retry & Backoff        │
│  Token Counting        Cost Estimation        │
│  Prompt Caching        Graceful Degradation   │
│  Middleware Pipeline    Typed Errors           │
└──────────────────────┬────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       OpenAI      Anthropic      Gemini
          │            │            │
        Groq         Ollama       Custom
```

**Zero runtime dependencies.** Runs everywhere: Node 18+, Bun, Deno, browsers, VS Code extensions, CLIs.

---

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

---

# Features

## 🧠 Model Router

**The feature no other SDK has.** Tell Hilbras what you need, it picks the best model across all providers:

```typescript
// Hilbras evaluates all providers and picks the best match
client.stream({ task: "coding", messages, policy: { maxCost: 0.05 } });

// Or access the router directly
const best = client.router.best({ task: "coding", needsTools: true, budget: "medium" });
console.log(best.provider, best.model, best.score, best.reasons);
```

The router filters by capabilities, cost, context window, and speed — then scores by task type. Every decision is explainable:

```typescript
best.reasons
// ["Supports required tools", "Within budget ($0.004 of $0.05)", "Preferred provider (openai)"]

best.candidates
// [{ model: "llama3.1", score: 0, rejectionReason: "Missing required capability: tools" }]
```

**Supported task types:** `coding`, `reasoning`, `analysis`, `writing`, `translation`, `summarization`, `extraction`, `classification`, `general`

## 📋 Structured Output with Auto-Repair

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

**How it works:**
1. Provider receives request with JSON mode enabled
2. Response is extracted (strips markdown fences, finds JSON in text)
3. Validated against your schema using `.safeParse()`
4. If invalid → automatic repair prompt with error details → retry
5. Max repair attempts configurable (default: 2)

Works with **Zod**, **Valibot**, or any `.safeParse()` validator. Zero runtime dependencies — the SDK never imports Zod.

## ⚡ Execution Policies

Control reliability, timeout, retry, backoff, and circuit breaker — globally or per-request:

```typescript
// Named preset
client.stream({ ..., policy: { preset: "production" } });

// Custom policy
client.stream({ ..., policy: { retry: { maxRetries: 5 }, timeout: { requestTimeoutMs: 10_000 } } });

// Preset with overrides
client.stream({ ..., policy: { preset: "maximum", circuitBreaker: { enabled: false } } });
```

| Preset | Retries | Timeout | Circuit Breaker | Use case |
|--------|---------|---------|-----------------|----------|
| `balanced` | 3 | 60s | On (5 failures) | Default — most apps |
| `production` | 5 | 120s | On (5 failures) | Conservative, reliable |
| `fast` | 1 | 15s | On (3 failures) | Latency-sensitive |
| `cheap` | 10 | 300s | Off | Cost > speed |
| `maximum` | 10 | 300s | On (10 failures) | Critical operations |

**SDKConfig integration** — your config now actually works:

```typescript
import { HilbrasClient, loadConfig } from "@hilbras/sdk";

const config = loadConfig({ configPath: "./hilbras.config.json" });
const client = new HilbrasClient({ sdkConfig: config });
// maxRetries, requestTimeoutMs, circuitBreaker* fields are now wired to runtime
```

Priority: `per-request policy > client default > SDKConfig > balanced preset`

## 📡 Observability Hooks

Structured telemetry for every request lifecycle event — connects to OpenTelemetry, Datadog, Grafana, or custom backends:

```typescript
// Request completion with latency and tokens
client.on("request.completed", (event) => {
  console.log(`${event.provider}/${event.model} took ${event.durationMs}ms`);
  console.log(`Tokens: ${event.inputTokens}/${event.outputTokens}`);
});

// Retries
client.on("request.retrying", (event) => {
  console.log(`Attempt ${event.attempt}: retrying after ${event.delayMs}ms (${event.reason})`);
});

// Routing decisions
client.on("routing.resolved", (event) => {
  console.log(`Router picked ${event.model} (score: ${event.score})`);
});

// Circuit breaker
client.on("circuit_breaker.open", (event) => {
  console.log(`Circuit breaker open for ${event.provider}`);
});

// Schema validation
client.on("structured.validate.fail", (e) => console.log(`Schema failed: ${e.error}`));

// Stream first chunk latency
client.on("stream.first_chunk", (e) => console.log(`First chunk: ${e.latencyMs}ms`));
```

| Event | When |
|---|---|
| `request.start` | Request initiated |
| `routing.resolved` | Router picked a model |
| `request.completed` | Success with latency, tokens |
| `request.failed` | Failure after all retries |
| `request.retrying` | Before retry sleep |
| `circuit_breaker.open` | Circuit breaker blocked |
| `structured.validate.pass` | Schema valid |
| `structured.validate.fail` | Schema invalid |
| `stream.first_chunk` | First chunk yielded |

Zero overhead when no listeners attached. Each event includes a `requestId` for correlation.

---

## 🔌 Provider Abstraction

6 built-in adapters, all implementing the `AIProvider` contract:

| Provider | Adapter | Streaming | Tool Calls | Reasoning | Models |
|----------|---------|-----------|------------|-----------|--------|
| **OpenAI** | `openai` | ✅ | ✅ native + text-embedded | ✅ | GPT-5.6 Sol/Terra/Luna, o3, o4-mini |
| **Anthropic** | `anthropic` | ✅ | ✅ native | ✅ | Claude Fable 5, Opus 5, Sonnet 5, Haiku 4.5 |
| **Google Gemini** | `google-genai` | ✅ | ✅ native | ✅ | Gemini 3.7/3.6/3.5 Flash, 3.1 Pro |
| **Azure OpenAI** | `azure` | ✅ | ✅ native | ✅ | GPT-5.6 Sol/Terra, o3 |
| **Groq** | `groq` | ✅ | ✅ text-embedded | ✅ | GPT-OSS 120B, MiniMax M2.7, Qwen 3.6 |
| **Ollama** | `ollama` | ✅ | ✅ text-embedded | ✅ | Llama 4, Qwen 3, DeepSeek R1 |

## 🧩 Plugin System

Register custom providers without modifying the SDK:

```typescript
import type { AIProvider } from "@hilbras/sdk/adapter";

class MyAdapter implements AIProvider {
  readonly id = "my-provider";
  async *stream(params) { /* ... */ }
  async complete(params) { /* ... */ }
}

client.adapterRegistry.register("my-provider", (config) => new MyAdapter(config));
```

Or create a minimal registry with only what you need:

```typescript
import { AdapterRegistry } from "@hilbras/sdk";

const registry = new AdapterRegistry();
registry.register("openai", (config) => new OpenAIAdapter(config));
const client = new HilbrasClient({ adapterRegistry: registry });
```

## 🛠️ Tool Calling

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

## 💭 Reasoning / Thinking

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

## 🛡️ Circuit Breaker

Stops hammering a failing provider, then half-opens to test recovery:

```typescript
import { getCircuitBreakerRegistry } from "@hilbras/sdk";

const cb = getCircuitBreakerRegistry().getOrCreate("OpenAI");
console.log(cb.state);  // "closed" | "open" | "half_open"
```

## 🔄 Retry & Backoff

Exponential backoff with jitter for 429, 500, 502, 503, 504 errors — configurable via execution policies.

## 💰 Token Counting & Cost Estimation

```typescript
import { estimateTokens, estimateCost } from "@hilbras/sdk";

estimateTokens("Hello, world!");  // ~4 tokens

const cost = estimateCost(1000, 500, "openai", "gpt-5.6-sol");
// { inputCost: 0.004, outputCost: 0.01, totalCost: 0.014, currency: "USD" }
```

## 📦 Prompt Caching

Mark messages for provider-level caching (Anthropic, OpenAI):

```typescript
import { cacheSystemMessage, autoCache } from "@hilbras/sdk";

const cached = cacheSystemMessage(messages);
const auto = autoCache(messages);
```

## ⬇️ Graceful Degradation

Progressively strips content when requests fail:

```typescript
import { withDegradation } from "@hilbras/sdk";

const { response, level } = await withDegradation(transport, url, messages, buildRequest);
// "normal" → "media-degraded" → "media-stripped" → "history-truncated"
```

## 🔧 Middleware

Intercept and transform requests:

```typescript
import { composeMiddlewares, authMiddleware, loggingMiddleware, retryMiddleware, rateLimitMiddleware, cacheMiddleware } from "@hilbras/sdk";

const pipeline = composeMiddlewares(
  loggingMiddleware(console.log),
  authMiddleware(() => getToken()),
  retryMiddleware(3, 1000),
);
```

## ❌ Error Handling

All errors extend `HilbrasSdkError`:

```typescript
import { HilbrasSdkError, ProviderRequestError, CircuitBreakerOpenError, ValidationError, ProviderNotFoundError, ModelNotFoundError } from "@hilbras/sdk";

try {
  for await (const chunk of client.stream({ ... })) { ... }
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    console.error(`Provider ${err.providerName} is circuit-broken`);
  } else if (err instanceof ProviderRequestError) {
    console.error(`HTTP ${err.status} from ${err.providerName}: ${err.body}`);
  } else if (err instanceof ValidationError) {
    console.error(`Schema validation failed after ${err.attempts} attempts`);
  }
}
```

## 📁 Configuration

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
HILBRAS_DEFAULT_MODEL=gpt-5.6-sol
HILBRAS_TEMPERATURE=0.7
HILBRAS_MAX_TOKENS=4096
HILBRAS_LOG_LEVEL=debug
HILBRAS_TIMEOUT=60000
```

## 🔐 Credentials

Pluggable credential resolution:

```typescript
import { setCredentialProvider } from "@hilbras/sdk";

setCredentialProvider({
  resolve: async (source) => {
    if (source.type === "environment") return process.env[source.variable];
    return source.apiKey;
  },
});
```

---

## Subpath Imports

```typescript
import { HilbrasClient } from "@hilbras/sdk";                          // Full SDK
import { OpenAIAdapter } from "@hilbras/sdk/adapters/openai";          // Single adapter
import type { AIProvider } from "@hilbras/sdk/adapter";                // Provider contract
import { ModelRouter } from "@hilbras/sdk";                            // Model router
import { estimateTokens } from "@hilbras/sdk/tokens";                  // Token utilities
import { loadConfig } from "@hilbras/sdk/config";                      // Config
import { FetchTransport } from "@hilbras/sdk/transport/fetch";         // Transport
```

## Architecture

```text
@hilbras/sdk
├── client/client.ts          # HilbrasClient — main entry point
│   └── hooks.ts              # Typed event emitter for observability
├── types/
│   ├── adapter.ts            # AIProvider contract
│   ├── router.ts             # TaskRequirement, RoutingResult
│   ├── schema.ts             # SchemaValidator, StructuredOutputConfig
│   ├── policy.ts             # ExecutionPolicy, ResolvedPolicy
│   └── observability.ts      # Hook event types
├── router/
│   └── model-router.ts       # Policy-Based Model Router
├── output/
│   └── structured.ts         # JSON extraction, validation, repair
├── providers/
│   ├── registry.ts           # ProviderRegistry
│   └── adapter-registry.ts   # Plugin system
├── adapters/                 # Provider wire-format converters
│   ├── openai.ts, anthropic.ts, google-genai.ts
│   ├── azure.ts, groq.ts, ollama.ts
│   └── text-tool-call-parser.ts
├── transport/                # HTTP abstraction (Fetch, WebSocket)
├── reliability/              # Circuit breaker, retry, backoff, timeout, degradation, presets
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
npm test             # Run tests (566 tests)
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## 💰 Cost-Aware Execution

Track costs, enforce budgets, and get complete cost visibility:

```typescript
const client = new HilbrasClient({
  budget: {
    sessionBudget: 1.00,       // Max total cost for the session
    perRequestBudget: 0.10,    // Max cost per individual request
    onBudgetWarning: (report) => console.warn(`80% budget used`),
    onBudgetExceeded: (report) => console.error(`Budget exhausted`),
  },
});

// After requests, get the full cost report
const report = client.costReport();
console.log(`Total spent: $${report.totalActual}`);
console.log(`Remaining: $${report.remainingBudget}`);
console.log(`By provider:`, report.byProvider);
```

**How it works:**
- Per-request budget check before execution (rejects if exceeded)
- Session-level cumulative tracking with warning/exceeded callbacks
- Zero overhead when no budget is configured
- Integrates with existing execution policies and fallback

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| [v0.9.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.9.0) | 2026-08-23 | Hard Budget Enforcement, atomic reservations, 676 tests |
| [v0.8.1](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.8.1) | 2026-08-23 | Cost audit: negative token fix, callback safety, 640 tests |
| [v0.8.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.8.0) | 2026-08-23 | Cost-Aware Execution, BudgetTracker, 566 tests |
| [v0.7.1](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.7.1) | 2026-08-23 | Deep audit, 78 audit tests, 500 total, patch certified |
| [v0.7.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.7.0) | 2026-08-23 | Execution optimization, fallback, 9-dimension scoring, 422 tests |
| [v0.6.2](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.6.2) | 2026-08-23 | Provider contract certification, 116 contract tests, 391 total |
| [v0.6.1](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.6.1) | 2026-08-23 | Production audit, bug fix, 275 tests |
| [v0.6.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.6.0) | 2026-08-23 | Intelligent Execution, explain(), 206 tests |
| [v0.5.2](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.5.2) | 2026-08-23 | Observability Hooks, typed lifecycle events, 191 tests |
| [v0.5.1](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.5.1) | 2026-08-23 | Explainable routing, TaskType taxonomy, output→router auto-connect |
| [v0.5.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.5.0) | 2026-08-23 | Model Router, Structured Output with auto-repair |
| [v0.4.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.4.0) | 2026-08-22 | Execution Policies, SDKConfig wiring |
| [v0.3.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.3.0) | 2026-08-22 | AIProvider contract, plugin registry, 2026 model catalog |
| [v0.2.0](https://github.com/Hilbras/Hilbras-ai-sdk/releases/tag/v0.2.0) | 2026-08-22 | All-adapter complete(), timeout enforcement, docs |
| v0.1.0 | 2026-07-21 | Initial release |

See [CHANGELOG.md](CHANGELOG.md) for full details.

## License

MIT
