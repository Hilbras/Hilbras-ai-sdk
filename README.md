<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.3-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-878%20passing-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/runtime%20deps-zero-brightgreen" alt="zero deps">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic AI execution engine for TypeScript.</strong><br>
  Streaming, tool calling, structured output, circuit breaker, retry, reasoning normalization, cost enforcement, and SSRF-safe provider registration — for OpenAI, Anthropic, Gemini, Azure, Groq, and Ollama. Zero runtime dependencies.
</p>

---

## Why @hilbras/sdk?

Most LLM SDKs just wrap one provider's API. `@hilbras/sdk` is an **AI
Execution Engine** that optimizes, controls, validates, and observes every
request, even when you use only one provider.

```text
Application
     │
     ▼
┌───────────────────────────────────────────────┐
│              @hilbras/sdk                     │
│                                               │
│  Model Router          Execution Policies     │
│  Structured Output     Observability Hooks    │
│  Provider Abstraction  SSRF-safe Registration │
│  Streaming & Tools     Reasoning Normalizer   │
│  Circuit Breaker       Retry & Backoff        │
│  Token Counting        Cost Enforcement       │
│  Prompt Caching        Auto-Repair Output     │
│  Middleware Pipeline   Typed Errors           │
└──────────────────────┬────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       OpenAI      Anthropic      Gemini
          │            │            │
        Groq         Ollama       Azure
```

**Zero runtime dependencies.** Runs everywhere: Node 18+, Bun, Deno, browsers, VS Code extensions, CLIs, edge runtimes.

---

## Install

```bash
npm install @hilbras/sdk
```

## Quick start

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
  adapter: "openai",
  models: [
    { id: "gpt-5.6", contextWindow: 1_048_576, maxOutputTokens: 131_072,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: true, parallelTools: true, systemPrompts: true } },
  ],
});

// Streaming
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-5.6",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

// Non-streaming
const reply = await client.complete({
  provider: "OpenAI",
  model: "gpt-5.6",
  messages: [{ role: "user", content: "Hello!" }],
});
```

---

## Features at a glance

| Feature | Summary | Docs |
|---|---|---|
| **Provider abstraction** | 6 built-in adapters (OpenAI, Anthropic, Gemini, Azure, Groq, Ollama) | [Providers](docs/providers.md) |
| **Streaming** | Async iteration over text/reasoning/tool-call/usage/finish chunks | [Getting Started](docs/getting-started.md#streaming) |
| **Tool calling** | Native function calling + text-embedded `<tool_call>` markup | [Getting Started](docs/getting-started.md#tool-calling) |
| **Structured output** | Zod/Valibot schemas with automatic JSON repair | [API Reference](docs/api-reference.md) |
| **Model routing** | Pick the best model across providers by task, cost, capabilities | [API Reference](docs/api-reference.md#model-router) |
| **Circuit breaker** | Per-provider failure isolation with half-open recovery | [API Reference](docs/api-reference.md#reliability) |
| **Retry & backoff** | Exponential backoff with jitter for 429/5xx/network errors | [API Reference](docs/api-reference.md#reliability) |
| **Cost enforcement** | Atomic reservations, per-request and session budgets, streaming included | [Cost & Budget](docs/cost-and-budget.md) |
| **Observability** | Typed lifecycle events for OpenTelemetry/Datadog/etc. | [Observability](docs/observability.md) |
| **SSRF safety** | Default-reject `http://`, block AWS metadata, opt-in for local Ollama | [Security](docs/security.md) |
| **Error redaction** | API keys auto-redacted from provider error bodies | [Security](docs/security.md#error-redaction-in-provider-responses) |
| **Reasoning normalization** | Detect & normalize `<thinking>` / `<reasoning>` tags and native fields | [API Reference](docs/api-reference.md) |
| **Zero runtime deps** | Pure TypeScript, no transitive dependencies | — |

---

## Documentation

- **[Getting Started](docs/getting-started.md)** — install, configure, first request
- **[Providers](docs/providers.md)** — adapter configuration for each provider
- **[Cost & Budget](docs/cost-and-budget.md)** — budget enforcement and the reservation lifecycle
- **[Security](docs/security.md)** — SSRF protection, opt-in flags, error redaction
- **[Observability](docs/observability.md)** — lifecycle events
- **[API Reference](docs/api-reference.md)** — complete type and function reference
- **[CHANGELOG](CHANGELOG.md)** — version history

## Subpath imports

```typescript
import { HilbrasClient } from "@hilbras/sdk";                   // Full SDK
import { OpenAIAdapter } from "@hilbras/sdk/adapters/openai";   // Single adapter
import type { AIProvider } from "@hilbras/sdk/adapter";         // Provider contract
import { estimateTokens } from "@hilbras/sdk/tokens";           // Token utilities
import { loadConfig } from "@hilbras/sdk/config";               // Config
import { FetchTransport } from "@hilbras/sdk/transport/fetch";  // Transport
import { validateBaseUrl } from "@hilbras/sdk";                 // SSRF guard
```

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run 878 tests
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## License

MIT
