<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-1406%20passing-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/runtime%20deps-zero-brightgreen" alt="zero deps">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic AI execution engine for TypeScript.</strong><br>
  Streaming, tool calling, structured output, circuit breaker, retry, reasoning normalization, cost enforcement, and SSRF-safe provider registration — for OpenAI, Anthropic, Gemini, Azure, Groq, Ollama, Bedrock, Vertex AI, HuggingFace, Deepgram, ElevenLabs, Voyage AI, and Cohere Rerank. Zero runtime dependencies.
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

```bash
npm install @hilbras/sdk
```

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

// One-line setup using built-in catalog (OpenAI, Anthropic, Gemini, Groq, etc.)
client.addProviderFromCatalog("openai", "gpt-4o", process.env.OPENAI_API_KEY!);

// Streaming
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

// Non-streaming
const reply = await client.complete({
  provider: "OpenAI",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

---

## Features at a glance

| Feature | Summary | Docs |
|---|---|---|
| **Provider abstraction** | 23 adapters (OpenAI, Anthropic, Gemini, Azure, Groq, Ollama, Bedrock, Vertex AI, HuggingFace, Deepgram, ElevenLabs, Voyage AI, Cohere Rerank) | [Providers](docs/providers.md) |
| **Streaming** | Async iteration over text/reasoning/tool-call/usage/finish chunks | [Getting Started](docs/getting-started.md#streaming) |
| **Tool calling** | Native function calling + text-embedded `<tool_call>` markup | [Getting Started](docs/getting-started.md#tool-calling) |
| **Structured output** | Schema validation with automatic JSON repair | [API Reference](docs/api-reference.md) |
| **Model routing** | Pick the best model across providers by task, cost, capabilities | [API Reference](docs/api-reference.md#model-router) |
| **Circuit breaker** | Per-provider failure isolation with half-open recovery | [API Reference](docs/api-reference.md#reliability) |
| **Retry & backoff** | Exponential backoff with jitter for 429/5xx/network errors | [API Reference](docs/api-reference.md#reliability) |
| **Cost enforcement** | Atomic reservations, per-request and session budgets, streaming included | [Cost & Budget](docs/cost-and-budget.md) |
| **Observability** | Typed lifecycle events for OpenTelemetry/Datadog/etc. | [Observability](docs/observability.md) |
| **SSRF safety** | Default-reject `http://`, block AWS metadata, opt-in for local Ollama | [Security](docs/security.md) |
| **Error redaction** | API keys auto-redacted from provider error bodies | [Security](docs/security.md#error-redaction-in-provider-responses) |
| **Reasoning normalization** | Detect & normalize `<thinking>` / `<reasoning>` tags and native fields | [API Reference](docs/api-reference.md) |
| **Agent framework** | ToolLoopAgent, ReActAgent, PlanAndExecuteAgent with approval, budget, cost tracking | [Agent](docs/agent.md) |
| **Evaluation** | LLM output evaluation with built-in metrics (exact_match, similarity, toxicity) | [Eval](docs/eval.md) |
| **Framework hooks** | React, Vue, Svelte, Solid, Qwik, Angular, Next.js, Astro, Remix | [Frameworks](docs/frameworks.md) |
| **RAG primitives** | VectorStore, Retriever, RAGPipeline, chunking | [RAG](docs/rag.md) |
| **Provider catalog** | Runtime provider/model discovery with search | [Catalog](docs/catalog.md) |
| **CLI** | `hilbras` CLI for init, provider management, model listing, cost estimation | [CLI](docs/cli.md) |
| **Migration** | Guide from Vercel AI SDK | [Migration](docs/migration-from-vercel-ai-sdk.md) |
| **Fine-tuning** | Export training data in 6 formats, data splitting, quality validation | [Fine-tune](docs/fine-tune.md) |
| **Scaffolding** | `npx create-hilbras-app` project scaffolding | [CLI](docs/cli.md) |
| **Zero runtime deps** | Pure TypeScript, no transitive dependencies | — |

---

## Documentation

- **[Getting Started](docs/getting-started.md)** — install, configure, first request
- **[Providers](docs/providers.md)** — adapter configuration for each provider
- **[Cost & Budget](docs/cost-and-budget.md)** — budget enforcement and the reservation lifecycle
- **[Security](docs/security.md)** — SSRF protection, opt-in flags, error redaction
- **[Observability](docs/observability.md)** — lifecycle events
- **[API Reference](docs/api-reference.md)** — complete type and function reference
- **[Agent Framework](docs/agent.md)** — multi-step agent tools
- **[Evaluation](docs/eval.md)** — LLM output testing
- **[RAG](docs/rag.md)** — retrieval-augmented generation
- **[Frameworks](docs/frameworks.md)** — React, Vue, Svelte, Solid, Angular hooks
- **[Catalog](docs/catalog.md)** — provider/model discovery
- **[CLI](docs/cli.md)** — command-line tools
- **[Migration](docs/migration-from-vercel-ai-sdk.md)** — from Vercel AI SDK
- **[Fine-tuning](docs/fine-tune.md)** — training data export and validation
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

// Packages
import { useChat } from "@hilbras/react";          // React hooks
import { useChat } from "@hilbras/vue";            // Vue composables
import { useChat } from "@hilbras/svelte";         // Svelte stores
import { useChat } from "@hilbras/solid";          // Solid signals
import { useChat } from "@hilbras/qwik";            // Qwik signals
import { useChat } from "@hilbras/nextjs";          // Next.js
import { createChatEndpoint } from "@hilbras/astro"; // Astro
import { createChatAction } from "@hilbras/remix";  // Remix
import { useChat } from "@hilbras/angular";        // Angular signals
import { ToolLoopAgent } from "@hilbras/agent";    // Agent framework
import { evaluate } from "@hilbras/eval";          // Evaluation
import { RAGPipeline } from "@hilbras/rag";        // RAG
import { exportTrainingData } from "@hilbras/fine-tune";  // Fine-tuning
```

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run 1278 tests
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## License

MIT
