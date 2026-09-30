<p align="center">
  <img src="https://img.shields.io/badge/version-3.4.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/types-strict-blueviolet" alt="types">
  <img src="https://img.shields.io/badge/tests-1797%20passing-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/runtime%20deps-zero-brightgreen" alt="zero deps">
</p>

<h1 align="center">@hilbras/sdk</h1>

<p align="center">
  <strong>Provider-agnostic AI execution engine for TypeScript.</strong><br>
  Streaming, tool calling, structured output, circuit breaker, retry, reasoning normalization, cost enforcement, plugin system, RBAC, SLA monitoring, A/B testing, and SSRF-safe provider registration — for OpenAI, Anthropic, Gemini, Azure, Groq, Ollama, Bedrock, Vertex AI, HuggingFace, Deepgram, ElevenLabs, Voyage AI, and Cohere Rerank. Zero runtime dependencies.
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
│  Plugin System         RBAC Access Control    │
│  SLA Monitoring        A/B Prompt Testing     │
│  Cost Alerts           Audit Logging          │
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

### React (optional)

```bash
npm install @hilbras/react
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

## Configuration

### Per-client tokenizer

By default, token counting uses a heuristic word-based estimator. Pass a
custom tokenizer to scope it to a single client instance:

```typescript
import { HilbrasClient } from "@hilbras/sdk";

// Your BPE / tiktoken / ollama tokenizer
const tokenizer = {
  count(text: string): number {
    return yourTokenizer.encode(text).length;
  },
};

const client = new HilbrasClient({ tokenizer });

// Every request on this client uses your tokenizer
const reply = await client.complete({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

> **v2.5.0+:** The global `setTokenizer()` / `getTokenizer()` singletons are
> deprecated. Use the per-client `tokenizer` config instead to avoid cross-client
> interference.

### Middleware

Wrap the transport with middleware for auth, logging, or custom transforms.
Middleware runs on **every** request (including retries) for the client:

```typescript
import { HilbrasClient } from "@hilbras/sdk";
import { authMiddleware, loggingMiddleware, composeMiddlewares } from "@hilbras/sdk";

const client = new HilbrasClient({
  middleware: composeMiddlewares(
    authMiddleware(() => process.env.API_KEY!),
    loggingMiddleware(console),
  ),
});

// All requests go through both middleware layers
const reply = await client.complete({
  provider: "openai",
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

You can also use `MiddlewareTransport` directly to wrap any transport:

```typescript
import { MiddlewareTransport, FetchTransport } from "@hilbras/sdk";

const transport = new MiddlewareTransport(
  new FetchTransport(),
  composeMiddlewares(authMiddleware(() => "my-key")),
);
```

---

## Configuration

v3.3 adds a typed configuration resolver with explicit precedence and
secret-safe diagnostics:

```typescript
import { HilbrasClient, createRuntimeSource } from "@hilbras/sdk";

const client = new HilbrasClient({
  configSources: [
    createRuntimeSource({ temperature: 0.3, maxRetries: 2 }),
  ],
});

console.log(client.getConfigDiagnostics());
```

See [Configuration](docs/configuration.md) and the [v3.2 migration guide](docs/migration-from-v3.2.md).

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
| **Plugin system** | Lifecycle hooks (onRequest/onResponse/onError) for extensibility | [API Reference](docs/api-reference.md) |
| **RBAC** | Role-based access control with provider/model restrictions and per-role rate limiting | [Security](docs/security.md) |
| **SLA monitoring** | Latency, error rate, and availability tracking with breach alerts | [Observability](docs/observability.md) |
| **Cost alerts** | Configurable threshold alerts via webhook or callback | [Cost & Budget](docs/cost-and-budget.md) |
| **A/B prompt testing** | Compare prompt variants against datasets with built-in metrics | [Eval](docs/eval.md) |
| **Observability** | Typed lifecycle events for OpenTelemetry/Datadog/etc. | [Observability](docs/observability.md) |
| **SSRF safety** | Default-reject `http://`, block AWS metadata, opt-in for local Ollama | [Security](docs/security.md) |
| **Error redaction** | API keys auto-redacted from provider error bodies | [Security](docs/security.md#error-redaction-in-provider-responses) |
| **Reasoning normalization** | Detect & normalize `<thinking>` / `<reasoning>` tags and native fields | [API Reference](docs/api-reference.md) |
| **Per-client tokenizer** | Scoped BPE tokenizer per client instance — no global singletons | [API Reference](docs/api-reference.md) |
| **Configuration resolver** | Typed layered configuration with strict validation and redacted diagnostics | [Configuration](docs/configuration.md) |
| **Authorization enforcement** | RBAC that actually evaluates, enforced tool policy, body-bound request signing with replay protection | [Security](docs/security.md) |
| **Middleware pipeline** | Transport-level middleware: auth headers, logging, custom request/response transforms | [API Reference](docs/api-reference.md) |
| **Agent framework** | ToolLoopAgent, ReActAgent, PlanAndExecuteAgent with approval, budget, cost tracking | [Agent](docs/agent.md) |
| **Evaluation** | LLM output evaluation with built-in metrics (exact_match, similarity, toxicity) | [Eval](docs/eval.md) |
| **React hooks** | `useChat`, `useCompletion`, `useCost` with streaming, abort, retry | [React](#react-hooks) |
| **Framework hooks** | Vue, Svelte, Solid, Qwik, Angular, Next.js, Astro, Remix | [Frameworks](docs/frameworks.md) |
| **RAG primitives** | VectorStore, Retriever, RAGPipeline, chunking | [RAG](docs/rag.md) |
| **Provider catalog** | Runtime provider/model discovery with search | [Catalog](docs/catalog.md) |
| **CLI** | `hilbras` CLI — chat REPL, provider benchmarking, cost reports, dashboard | [CLI](docs/cli.md) |
| **Migration** | Guide from Vercel AI SDK | [Migration](docs/migration-from-vercel-ai-sdk.md) |
| **Fine-tuning** | Export training data in 6 formats, data splitting, quality validation | [Fine-tune](docs/fine-tune.md) |
| **Scaffolding** | `npx create-hilbras-app` project scaffolding | [CLI](docs/cli.md) |
| **Zero runtime deps** | Pure TypeScript, no transitive dependencies | — |

---

## What's New in v3.4.0

**Authorization now enforces.** `config.rbac` was accepted by the configuration
resolver but read by nothing, and even when the RBAC middleware was wired up
manually its permission check was unreachable: it read `provider` from the
request body, which no adapter sends. RBAC now resolves the provider from the
request URL, maps caller identity onto a role, and enforces the result. A
configured `rbac` block is enforced by the client automatically, and a malformed
policy is rejected at construction instead of degrading to "no restrictions".

**Tool policy is enforced.** `allowedTools` and `deniedTools` were declared,
overlap-checked, and then ignored. The client now rejects a request that names a
denied tool, and `ToolLoopAgent` refuses to execute one. See `getToolPolicy()`.

**Request signing binds the body.** The HMAC signature covered the method, path,
and configured headers, but not the request body: the body digest was emitted as
an unsigned header, and `verify()` trusted a received digest header rather than
recomputing it. The new `v2` profile binds the body, the key id, and a nonce,
and recomputes the digest from the received bytes. The `v1` wire format is
frozen and unchanged, so existing verifiers keep working.

**Replay protection.** `ReplayGuard` adds a signed-timestamp window and a
bounded seen-signature cache. `RequestSigner.verifyFresh()` composes the two.

**Middleware and transport fixes.** `composeMiddlewares` used a shared cursor
that permanently exhausted the chain, so any stage after a retry was skipped on
every later attempt — a signature computed at T0 was reused unchanged for
attempts 2..N. Composition now re-enters per attempt. Streaming a non-2xx
response now throws instead of yielding an empty stream, and signed requests no
longer emit both `Content-Type` and `content-type`.

**Compatibility.** No export is removed. `checkPermission`, `RBACRole`,
`RBACConfig`, `RequestSigner`, and `signingMiddleware` keep their signatures.
One intentional behavior change: a malformed `config.rbac` now fails at
construction. See the [v3.3 migration guide](docs/migration-from-v3.3.md).

**Audit.** All 20 audited findings, with a finding-to-test map in
[`HILBRAS-SDK-FULL-AUDIT.md`](HILBRAS-SDK-FULL-AUDIT.md) and
[`SPEC-v3.4.0-security.md`](SPEC-v3.4.0-security.md).

---

## What's New in v3.3.0

**Canonical configuration** — `resolveConfig()` now provides deterministic layered configuration with defaults, file sources, environment sources, and runtime/client values. The client resolves configuration once during construction.

**Validation and diagnostics** — configuration values receive strict numeric, boolean, enum, provider, authentication, and SSRF validation. `getConfigDiagnostics()` reports safe, actionable diagnostics without exposing credentials.

**Secret-safe snapshots** — `getConfigSnapshot()` returns a redacted configuration projection suitable for tooling and logs. The usable resolved configuration is kept separate from the safe view.

**Compatibility** — `loadConfig()`, `createConfig()`, `validateConfig()`, and `sdkConfig` remain supported. See the [v3.2 migration guide](docs/migration-from-v3.2.md) for incremental adoption.

**Documentation and examples** — added a configuration guide, migration guide, API reference section, and runtime/file configuration examples.

See [`CHANGELOG.md`](CHANGELOG.md) and [`HILBRAS-SDK-FULL-AUDIT.md`](HILBRAS-SDK-FULL-AUDIT.md) for the complete release and audit details.

---

## What's New in v3.2.0

**Execution stabilization** — the client now delegates request preparation and provider attempts to an internal execution layer. `RequestContext`, `ExecutionResult`, `RequestExecutor`, and `RequestPipeline` establish explicit logical-request and attempt boundaries without adding public exports or changing the supported `complete()`/`stream()` APIs.

**Reliability correctness** — retry backoff is cancellation-aware, scoped timeout resources are cleaned up, fallback can run after a non-retryable primary failure, fallback cost limits are enforced, and visible stream output cannot be duplicated by a later fallback.

**Streaming and structured output** — streaming, tool loops, and `streamObject()` now share the same execution lifecycle and retain exactly-once budget cleanup, terminal events, and original provider error identity.

**Compatibility boundary** — multimodal budget/pricing semantics remain explicitly deferred rather than silently introducing new billing behavior. See the [execution architecture guide](docs/architecture/execution.md) for the internal boundary and migration decisions.

**Release hygiene** — README, API reference, active documentation, changelog, package metadata, and the lockfile now identify v3.2.0. The root package remains dependency-free and companion packages remain separate.

See [`CHANGELOG.md`](CHANGELOG.md) and [`HILBRAS-SDK-FULL-AUDIT.md`](HILBRAS-SDK-FULL-AUDIT.md) for the complete release and audit details.

---

## What's New in v3.1.0

**Release hardening and correctness** — v3.1.0 is the first post-audit release. It makes the root package reproducibly buildable and publishable, fixes Node ESM catalog loading and export-map gaps, and closes several transport, budget, stream-state, SSRF, redaction, and tool-execution boundaries.

**Package release reliability** — workspace metadata, lockfile state, companion dependency ranges, clean builds, package smoke checks, and npm publication hooks are now consistent. The root package still has zero runtime dependencies.

**Documentation and security guidance** — current examples now use the published subpaths, keep provider credentials on the server, describe the stricter local-network policy, and avoid executing model-selected expressions.

---

## Features introduced in v3.0.0

**Plugin System** — Extend the client with lifecycle hooks:
```typescript
client.use({
  name: "logger",
  onRequest(ctx) { console.log(`→ ${ctx.provider}/${ctx.model}`); },
  onResponse(ctx) { console.log(`✓ ${ctx.durationMs}ms`); },
  onError(ctx) { console.error(`✗ ${ctx.error.message}`); },
});
```

**RBAC** — Role-based access control with per-role provider/model restrictions:
```typescript
const client = new HilbrasClient({
  middleware: createRBACMiddleware({
    roles: {
      viewer: { name: "viewer", allowedProviders: ["openai"], maxTokensPerRequest: 4096 },
      admin: { name: "admin" },
    },
    defaultRole: "viewer",
  }, (ctx) => extractUserId(ctx)),
});
```

**SLA Monitoring** — Track latency, error rate, and availability:
```typescript
const monitor = new SLAMonitor(client, [
  { name: "p95 latency", metric: "latency_p95", threshold: 2000, windowMs: 60_000 },
  { name: "availability", metric: "availability", threshold: 0.99, windowMs: 300_000 },
]);
```

**Cost Alerts** — Get notified when spending crosses thresholds:
```typescript
const { budget, monitor } = createCostAlertBudget({
  sessionBudget: 10.00,
  thresholds: [
    { percent: 50, channel: { type: "callback", callback: (a) => console.log("50%!") } },
    { percent: 75, channel: { type: "webhook", url: "https://hooks.slack.com/..." } },
  ],
});
```

**A/B Prompt Testing** — Compare prompt variants against datasets:
```typescript
const result = await runABTest(client, {
  variants: [
    { name: "concise", systemPrompt: "Answer concisely." },
    { name: "detailed", systemPrompt: "Answer in detail with examples." },
  ],
  dataset: [{ id: "1", input: "What is 2+2?", expected: "4" }],
});
console.log(`Winner: ${result.winner.name}`);
```

**CLI** — New commands: `hilbras chat`, `hilbras bench`, `hilbras costs`, `hilbras dashboard`

---

## React Hooks

First-class React integration via `@hilbras/react`. Zero runtime dependencies beyond React itself.

```bash
npm install @hilbras/react
```

### useChat — Streaming chat

Provider credentials belong on the server. Construct the client in a server
component (or route handler) and pass it to the client-side provider; do not put
an API key in browser props or a client component.

```tsx
// app/page.tsx (server component)
import { HilbrasClient } from "@hilbras/sdk";
import { HilbrasProvider } from "@hilbras/react";
import { Chat } from "./chat";

export default function Page() {
  const client = new HilbrasClient();
  client.addProviderFromCatalog("openai", "gpt-4o", process.env.OPENAI_API_KEY!);
  return <HilbrasProvider client={client}><Chat /></HilbrasProvider>;
}
```

```tsx
// app/chat.tsx (client component)
import { useChat } from "@hilbras/react";

export function Chat() {
  const { messages, input, setInput, handleSubmit, isLoading, stop } = useChat({
    provider: "OpenAI",
    model: "gpt-4o",
    systemPrompt: "You are a helpful assistant.",
  });

  return (
    <div>
      {messages.map((m) => <div key={m.id}>{m.content}</div>)}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isLoading} />
        <button type="submit" disabled={isLoading}>Send</button>
        {isLoading && <button onClick={stop}>Stop</button>}
      </form>
    </div>
  );
}
```

### useCompletion — Text completion

```tsx
import { useCompletion } from "@hilbras/react";

function AutoComplete() {
  const { completion, prompt, setPrompt, complete, isLoading } = useCompletion({
    provider: "openai",
    model: "gpt-4o",
    systemPrompt: "Complete the following text:",
  });

  return (
    <div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button onClick={() => complete()} disabled={isLoading}>Complete</button>
      {completion && <div>{completion}</div>}
    </div>
  );
}
```

### useCost — Real-time cost tracking

```tsx
import { useCost } from "@hilbras/react";

function CostDisplay() {
  const { snapshot, isBudgetLow } = useCost();

  return (
    <div style={{ color: isBudgetLow ? "red" : "green" }}>
      Cost: ${snapshot.totalCost.toFixed(4)} | Tokens: {snapshot.totalTokens}
      {snapshot.remainingBudget != null && ` | Remaining: $${snapshot.remainingBudget.toFixed(2)}`}
    </div>
  );
}
```

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
import { MiddlewareTransport } from "@hilbras/sdk";             // Middleware wrapper
import { validateBaseUrl } from "@hilbras/sdk";                 // SSRF guard

// v3.0.0+: Plugin system, RBAC, SLA, cost alerts, A/B testing
import type { Plugin } from "@hilbras/sdk";                     // Plugin interface
import { createRBACMiddleware } from "@hilbras/sdk";            // RBAC
import { SLAMonitor } from "@hilbras/sdk";                      // SLA monitoring
import { CostAlertMonitor } from "@hilbras/sdk";                // Cost alerts
import { runABTest } from "@hilbras/sdk";                       // A/B testing

// React package
import { useChat, useCompletion, useCost, HilbrasProvider } from "@hilbras/react";

// Framework subpaths from the root package
import { useChat } from "@hilbras/sdk/vue";
import { useChat } from "@hilbras/sdk/svelte";
import { useChat } from "@hilbras/sdk/solid";
import { useChat } from "@hilbras/sdk/qwik";
import { createChatHandler } from "@hilbras/sdk/nextjs";
import { createChatEndpoint } from "@hilbras/sdk/astro";
import { createChatAction } from "@hilbras/sdk/remix";
import { useChat } from "@hilbras/sdk/angular";
import { ToolLoopAgent } from "@hilbras/sdk/agent";
import { evaluate } from "@hilbras/sdk/eval";
import { RAGPipeline } from "@hilbras/sdk/rag";
import { exportTrainingData } from "@hilbras/sdk/fine-tune";
```

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run the root test suite (1611 tests)
npm run test:packages # Build and test companion packages
npm run test:watch   # Watch mode
npm run lint         # Lint with oxlint
```

## License

MIT
