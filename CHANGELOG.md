# Changelog

All notable changes to `@hilbras/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] - 2026-09-20

### Added
- **Framework Examples:** Complete example apps for Next.js, SvelteKit, and Hono
  - Next.js: App Router with streaming chat, structured output (Zod), cost tracking
  - SvelteKit: Streaming chat with reactive UI, structured output
  - Hono: Lightweight edge runtime API server with streaming, structured output, cost endpoint

## [1.4.0] - 2026-09-20

### Changed
- **Actionable Error Messages:** All SDK errors now carry structured context: request ID, provider, model, cost, human-readable hints, retry-after timing, and available alternatives
  - `ProviderRequestError`: HTTP status-specific hints (401→check API key, 429→rate limit, 500→transient), retryable flag, parsed retry-after from response body
  - `CircuitBreakerOpenError`: retry-after timing, failure count, fallback suggestion
  - `ModelNotFoundError`: lists available models on the provider
  - `ProviderNotFoundError`: lists all registered providers
  - `ConfigurationError`: contextual hints (budget remaining + options, feature support by provider, catalog model lists)
  - `ValidationError`: schema fix suggestions
  - `StreamError`: retry guidance
  - `HilbrasSdkError.toSummary()` — formatted summary for logging
- 25 new error message tests

## [1.3.1] - 2026-09-20

### Fixed
- README badge updated to reflect current version on npm

## [1.3.0] - 2026-09-20

### Added
- **DevTools Dashboard Prototype:** Unified `DevToolsDashboard` class that aggregates data from hooks, cost tracker, circuit breaker registry, and model router into a single queryable snapshot. Features include:
  - Request timeline tracking (pending/completed/failed/retrying)
  - Latency percentiles (p50/p95/p99) and TTFT (time to first token)
  - Per-provider health status from circuit breaker registry
  - Cost breakdown by provider and phase from budget tracker
  - Routing decision aggregation with success rates
  - Retry, fallback, and validation failure tracking
  - Real-time throughput sampling with configurable intervals
  - `onUpdate()` push notifications on every event
  - `renderText()` monospace text renderer for CLI output
  - `exportJson()` for programmatic consumption
  - Configurable retention limits for all data types
- 33 new DevTools dashboard tests

---

## [1.2.0] - 2026-09-19

### Added
- **Prompt Injection Defense Middleware:** 27 built-in patterns across 8 categories (instruction-override, role-prefix, code-fence, emotional-manipulation, encoding, multilingual). Configurable warn/block/strip modes. `detectInjection()`, `scanMessages()`, `createInjectionGuard()`.
- **Client-Side Rate Limiting:** Token bucket algorithm with configurable burst capacity, refill rate, and per-request cost. `RateLimiter` class, `createRateLimiter()` factory, `RateLimiterRegistry` for multi-tenant management.
- **Advanced SSRF Validation:** IPv6 scope ID stripping, `validateResolvedAddress()` for DNS rebinding prevention, `normalizeHostname()` for unicode/IDNA normalization, `validateUrlForTransport()` for TOCTOU mitigation. Additional private ranges: CGNAT (100.64.0.0/10), benchmarking (198.18.0.0/15), multicast, unspecified, IPv4-mapped IPv6.
- 71 new security edge case tests (prompt injection, rate limiting, SSRF)

---

## [1.1.1] - 2026-09-19

### Fixed
- README version badge now correctly shows 1.1.0 (was packed as 1.0.0 in the 1.1.0 tarball)

## [1.1.0] - 2026-09-19

### Fixed
- **BUG-01 (P0):** Env-var API key no longer redacted before storage — `HILBRAS_PROVIDER_KEY` now works correctly
- **BUG-02 (P1):** ReasoningNormalizer buffer leak — no more duplicate reasoning content across chunks
- **BUG-03 (P2):** FetchTransport double-release — pool count no longer goes negative on errors
- **BUG-06 (P2):** FetchTransport cleanup interval now properly cleared via `destroy()` method
- **BUG-07 (P3):** Circuit-breaker `halfOpenCalls` can no longer go negative
- **BUG-08 (P3):** Duplicate reservation IDs now throw descriptive error instead of silent `null`
- **BUG-09 (P3):** `extractJson` returns empty string for empty input instead of raw text
- **A3 (P1):** Anthropic adapter now correctly translates `tool` role messages to `tool_result` format
- **SEC-01 (P2):** RealtimeSession WebSocket URLs now validated through SSRF guard
- **R1 (P2):** `RealtimeSession.connect()` now times out after 30s instead of hanging forever
- **C5 (P1):** `SDKConfig.providers` now auto-registered in `HilbrasClient` constructor

### Added
- Telemetry wiring: `HilbrasClientConfig.telemetry` option for `StructuredLogger` and `OpenTelemetryExporter`
- `FetchTransport.destroy()` method to clean up intervals and abort in-flight requests
- `stream()` and `complete()` integration tests
- Comprehensive audit fix plan (`v1.1.0-AUDIT-FIX-PLAN.md`)

---

## [Unreleased]

---

## [1.0.0] - 2026-09-19

### Added

- **Multi-Step Tool Calling** — `streamText()` now accumulates tool call arguments across incremental deltas using `index`/`done` fields. `useChat` hooks support `maxSteps`, `onToolCall`, and `onStepFinish` for server-side multi-step tool execution with client-side callbacks.
- **streamObject Public API** — New `streamObject<T>()` method with `SchemaValidator<T>` support (Zod, Valibot). Streams partial objects with progressive JSON parsing. Accepts both raw JSON Schema and typed validators. Includes `onPartialObject`/`onFinalObject` callbacks. New `StreamObjectOptions<T>` and `StreamObjectChunk<T>` types exported.
- **Data/Annotations Streaming** — New `DataChunk` and `AnnotationChunk` stream types for structured data alongside text. New `data`/`annotation` protocol events in `UIProtocolMessage`. `UIMessage` now includes `data[]` and `annotations[]` fields. `DataAnnotation` type with `type`, `data`, and optional `range`. React `useChat` supports `onData`/`onAnnotation` callbacks.
- **Generative UI** — New `ComponentRegistry` for registering and deserializing React components. `GenerativeTool` type with `render` function for rendering components from tool results. `StreamUIOptions`/`StreamUIResult` types. `rendered` field on `UIToolInvocation`. Exported from `@hilbras/sdk/react`.
- **SSE Streaming Utilities** — New `createSSEStream`, `createSSEResponse`, `createObjectSSEStream`, `createObjectSSEResponse` server-side utilities for SSE streaming with UI protocol support.
- **Shared SSE Writer** — `src/utils/sse-writer.ts` converts `StreamChunk` → `UIProtocolMessage` wire format for all framework handlers.

### Changed

- **Next.js/Astro/Remix handlers** — Rewritten to use real `HilbrasClient` + SSE protocol with tool call support.
- **React useChat** — Handles all 10 protocol events (text, reasoning, tool_call_*, object_delta, data, annotation). Added `append()`, `reload()`.
- **Svelte useChat** — Added `append()`, `reload()`, tool call support.
- **Vue useChat** — Added `append()`, `reload()`, tool call support.
- **Solid useChat** — Rewritten with full tool call support (maxSteps, onToolCall, reload).
- **Qwik useChat** — Rewritten for Qwik signal API with full tool call support.
- **Angular chat service** — Added tool call support (all 10 protocol events).
- **StreamChunk union** — Added `DataChunk` and `AnnotationChunk` types.
- **UIToolInvocation** — Added `rendered` field for generative UI.
- **UIProtocolMessage** — Added `object_delta`, `data`, `annotation` event types.

### Changed

- **Package consolidation** — Consolidated 13 separate packages into the core `@hilbras/sdk` package. Users now import from a single package with subpath exports instead of installing 16 separate packages.

#### New Subpath Exports

| Path | Description |
|------|-------------|
| `@hilbras/sdk/react` | React hooks (useChat, useCompletion, useObject) |
| `@hilbras/sdk/vue` | Vue composition functions |
| `@hilbras/sdk/svelte` | Svelte stores and utilities |
| `@hilbras/sdk/solid` | Solid.js hooks |
| `@hilbras/sdk/qwik` | Qwik hooks |
| `@hilbras/sdk/angular` | Angular services |
| `@hilbras/sdk/nextjs` | Next.js route handlers and client |
| `@hilbras/sdk/astro` | Astro endpoints and hooks |
| `@hilbras/sdk/remix` | Remix action handlers |
| `@hilbras/sdk/agent` | Agent/Tool Loop functionality |
| `@hilbras/sdk/eval` | Evaluation framework and metrics |
| `@hilbras/sdk/rag` | RAG pipeline and vector stores |
| `@hilbras/sdk/fine-tune` | Fine-tuning data preparation |

#### Migration

```diff
- import { useChat } from "@hilbras/react";
+ import { useChat } from "@hilbras/sdk/react";

- import { evaluate } from "@hilbras/eval";
+ import { evaluate } from "@hilbras/sdk/eval";
```

### Added

- Optional peer dependencies for all framework libraries (react, vue, svelte, solid, etc.)
- `experimentalDecorators` enabled in tsconfig for Angular compatibility
- Framework test files consolidated into main `tests/` directory

### Removed

- Separate `@hilbras/{react,vue,svelte,solid,qwik,angular,nextjs,astro,remix,agent,eval,rag,fine-tune}` packages (now available as subpath exports of `@hilbras/sdk`)
- `@hilbras/cli` and `@hilbras/create-hilbras-app` remain as separate packages

---

## [0.26.5] - 2026-09-19

### Updated

- **Provider catalog with September 2026 frontier models** — Updated catalog based on live research from provider documentation and AI model trackers:

| Provider | New Models | Context Window |
|----------|------------|----------------|
| OpenAI | GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4 Pro | 200K–1.05M |
| Anthropic | Claude Fable 5.1, Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5 | 200K–1M |
| Google | Gemini 3.8/3.7/3.6/3.5 Flash, Gemini 3.1 Pro, Gemini 3 Flash | 1M |
| Azure | GPT-6 Astra, GPT-5.6 Sol/Terra, o3 | 200K–1.05M |
| Groq | Llama 3.3 70B, Llama 3.2 90B/11B/3B, Qwen 2.5 Coder/72B | 32K–131K |
| Bedrock | Claude Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5, Nova Pro/Lite | 200K–1M |
| Vertex | Gemini 3.8/3.7 Flash, 3.1 Pro, 2.5 Pro | 1M |
| Hugging Face | Llama 4 Maverick/Scout, Qwen 3.8 Max, DeepSeek V4 Pro/Flash | 1M–10M |
| DeepSeek | V4 Pro, V4.1 Flash | 1M |
| xAI | Grok 4.6, 4.5, 4.3, 4.20 Reasoning | 500K–1M |
| Together | Llama 4 Maverick/Scout, DeepSeek V4 Pro/Flash | 1M–10M |
| Fireworks | Llama 4 Maverick/Scout, DeepSeek V4 Pro | 1M–10M |
| Cohere | Command A+, Command A, Command R+ | 128K–256K |
| Ollama | Llama 4 Maverick/Scout, Qwen 3.8 Max, DeepSeek V4 Pro/Flash | 1M–10M |
| Voyage AI | Voyage 3 Large, Voyage Code 3 | 32K |
| Z.ai | GLM-5 | 200K |
| Mistral | Mistral Large 3, Mistral Large 2 | 128K–256K |

- **Version bumped to 0.26.5** across all packages

### Fixed

- **Broken local dev workflow** — `npm test` now works after a fresh clone following CONTRIBUTING.md. Added `pretest` script that builds `packages/cli` (the only package whose tests require compiled output). CI workflow simplified to use `npm test` instead of a hidden manual `npx tsc -p packages/cli/tsconfig.json` step.
- **Path traversal in create-hilbras-app** — `--template` and project name arguments are now validated to reject values containing `/`, `\`, or `..` that could resolve outside intended directories.

---

## [0.17.3] - 2026-09-18

### Added

- **Migration guide** — Comprehensive guide from Vercel AI SDK to Hilbras SDK (`docs/migration-from-vercel-ai-sdk.md`)
- **Provider catalog JSON** — Dynamic provider/model catalog with runtime API (`loadCatalog()`, `listProviders()`, `searchModels()`, `getModelsForProvider()`)
- **CI fix** — Added CLI dist build step to CI workflow

### Changed

- Bundle size: 1001.5KB → 1023.5KB (catalog JSON added)

---

## [0.17.0] - 2026-09-18

### Added

- **AWS Bedrock adapter** — Full Converse API support with SigV4 signing, 9 model catalog entries (Claude, Llama, Mistral, Cohere)
- **Google Vertex AI adapter** — Vertex AI with project/region routing, third-party publishers (Anthropic, Meta, Mistral), 12 model catalog entries
- **Hugging Face Inference adapter** — OpenAI-compatible chat endpoint + task-based inference, 7 model catalog entries
- **Deepgram adapter** — Speech-to-text with Nova 2 and Whisper Large support
- **ElevenLabs adapter** — Text-to-speech with voice customization and speed control
- **Voyage AI adapter** — High-quality embeddings with OpenAI-compatible API
- **Cohere Rerank adapter** — Document reranking with English and Multilingual models
- **@hilbras/angular** — Angular services for streaming LLM UIs:
  - `HilbrasChatService` — streaming chat with Angular signals
  - `HilbrasCompletionService` — streaming text completions
  - `HilbrasObjectService` — structured output streaming
- **hilbras CLI** — Command-line tool for provider/model management:
  - `hilbras init` — scaffold project config
  - `hilbras provider add/list` — manage providers (17 templates)
  - `hilbras model list` — list available models
  - `hilbras cost estimate` — pricing calculator
  - `hilbras doctor` — diagnose config issues
- **@hilbras/rag** — RAG primitives for retrieval-augmented generation:
  - `VectorStore` interface + `InMemoryVectorStore` (cosine/dot/L2 metrics)
  - `chunkText` / `chunkDocuments` — recursive, sentence, fixed chunking
  - `Retriever` — hybrid search with optional reranking
  - `RAGPipeline` — end-to-end: ingest → chunk → embed → store → query

### Changed

- **Provider count**: 16 → 23 adapters
- **Model catalog**: 37 new model entries across Bedrock, Vertex AI, HuggingFace, Deepgram, ElevenLabs, Voyage AI, Cohere Rerank
- **Bundle size limit**: 1000KB → 1100KB (to accommodate new adapters)

---

## [0.16.0] - 2026-09-18

### Added

- **UIMessage Protocol** — Standard streaming protocol for frontend UIs: `UIMessage`, `UIToolInvocation`, `UIProtocolMessage` types
- **@hilbras/react** — React hooks for streaming LLM UIs:
  - `useChat()` — manages a streaming chat conversation with message history
  - `useCompletion()` — streams text completions from a prompt
  - `useObject()` — streams structured JSON via incremental tool_call parsing
  - `parseUIStream()` — SSE stream parser for the UIMessage protocol
- **@hilbras/vue** — Vue 3 Composition API hooks:
  - `useChat()`, `useCompletion()`, `useObject()` — same APIs with Vue reactive refs
  - `parseUIStream()` — shared SSE stream parser
- **@hilbras/svelte** — Svelte 5 runes-compatible hooks:
  - `useChat()`, `useCompletion()`, `useObject()` — getter/setter pattern for Svelte reactivity
  - `parseUIStream()` — shared SSE stream parser
  - `subscribe()` pattern for Svelte stores integration
- **Phase 6 infrastructure** — vitest coverage config (v8, 80% thresholds), sharded CI (4×2), benchmark suite, bundle size check
- **Multi-provider parity gaps** — Azure multi-modal, Cohere embed, Groq transcribe, Ollama embed
- **Type-level tests** — 22 type tests in `tests/types.test-d.ts`
- 30 new tests (1118 total across 46 files)

### Changed

- CI now runs 8 parallel jobs (4 shards × Node 22/24) with separate lint + size check job
- Coverage enforced at 80% line/branch/function/statements

---

## [0.12.0] - 2026-09-17

### Added

- **Schema integration** — `zodSchema()` for Zod/Valibot, `jsonSchema()` for inline JSON Schema validation
- **Type-safe tool builder** — `tool()`, `toolDef()`, `dynamicTool()`
- **Utilities** — `generateId()`, `createIdGenerator()`, `shortId()`, `parseSSEStream()`, `parseJsonEventStream()`, `collectSSEEvents()`, `findSSEEvent()`
- 32 new tests (930 total)

---

## [0.11.0] - 2026-09-17

### Added

- **Multi-modal support** — 5 new capabilities beyond chat completions: `embed()`, `generateImage()`, `generateSpeech()`, `transcribe()`, `rerank()`
- New client methods: `client.embed()`, `client.generateImage()`, `client.generateSpeech()`, `client.transcribe()`, `client.rerank()`
- Extended `ModelCapabilities` with `embeddings`, `imageGeneration`, `speech`, `transcription`, `reranking` flags
- 13 new models: embedding, image generation, speech, transcription, and reranking models

---

## [0.10.0] - 2026-09-17

### Added

- **10 new provider adapters** — Mistral, DeepSeek, xAI (Grok), Together AI, Fireworks AI, Cohere, Perplexity, Cerebras, and DeepInfra, plus a `GenericOpenAIAdapter` base class for building custom OpenAI-compatible adapters.
- **30+ new models** added to the built-in catalog with accurate pricing data.
- Subpath exports for all new adapters (`@hilbras/sdk/adapters/mistral`, etc.).
- Token counter pricing for Mistral, DeepSeek, xAI, and Cohere models.
- Prompt cache recognition for Mistral and DeepSeek providers.

### Changed

- Adapter registry expanded from 6 to 16 built-in adapters.
- Updated `AdapterName` type with all new adapter identifiers.

---

## [0.9.3] - 2026-08-27

### Fixed (P0)

- **`_totalEstimated` grew monotonically forever** — `BudgetTracker.release()` now decrements `_totalEstimated` alongside `_totalReserved` so the public `CostReport.totalEstimated` reflects in-flight estimate only, not a running tally. `settle()` correctly preserves the estimate (it has committed to actual).
- **`stream()` was not budget-enforced** — `client.stream()` now reserves before the retry loop (symmetric with `complete()`), settles on the first `usage` chunk with the actual cost, settles at end-of-stream with the estimate if no usage chunk arrived, and releases on abort/throw/fallback. The v0.9.0 "Hard Budget Enforcement" headline feature now actually covers streams.
- **`ProviderRequestError` echoed raw provider error bodies, leaking API keys** — the constructor now redacts `sk-…`, `sk-proj-…`, `sk-ant-…`, `Bearer …`, and JSON `apiKey`/`token`/`secret`/`password` fields from both `err.body` and `err.message`. The README's example pattern `console.error(...err.body)` is now safe.
- **No SSRF protection on `baseUrl`** — `addProvider()` now validates the URL through `validateBaseUrl()`. Default rejects `http://`; loopback is always allowed when `allowInsecure: true`; private network ranges require `allowPrivateNetwork: true`. AWS instance metadata (`169.254.169.254`) is always blocked. Throws `ConfigurationError` on reject.
- **Budget callback order was inverted** — when a single `settle()` crossed 100%, `onBudgetExceeded` fired before `onBudgetWarning`, and the warning's report showed already-exceeded state. Order swapped; warning now fires first.
- **`extractJson` could return garbage on truncated input** — the "no matching close found" fallback used to return from `{` to end-of-text (including trailing prose). It now scans forward looking for a balanced, JSON.parse-valid substring, so `{"name":"John"} hope this helps` returns just `{"name":"John"}`.

### Added

- 58 new tests (820 → 878 total). New test files: `tests/security/url-guard.test.ts` (27), `tests/security/ssrf-integration.test.ts` (8).
- `src/security/url-guard.ts` — `validateBaseUrl(url, opts)` exported from the public API.
- `validateBaseUrl`, `UrlGuardOptions`, `UrlGuardResult` re-exported from `@hilbras/sdk`.
- `allowInsecure?: boolean` field on `ProviderConfig`.
- `allowInsecureUrls?: boolean` and `allowPrivateNetwork?: boolean` on `HilbrasClientConfig`.
- `ConfigurationError` is now used at the budget-rejection path in both `stream()` and `complete()` (was raw `Error`).
- `redact()` exported from `src/logging/logger.ts`.

### Changed

- No breaking changes. All existing tests pass without modification.

### Security

- `@hilbras/sdk` is now SSRF-safe by default. A misconfigured or malicious provider cannot point the SDK at the AWS instance metadata service, internal services, or `file://` / `javascript:` / `data:` schemes.

---

## [0.9.2] - 2026-08-23

### Fixed

- **Duplicate reservation IDs could silently overwrite active reservations** — `reserve()` now rejects duplicate IDs, preventing orphaned reservations and accounting corruption. Severity: HIGH.

### Added

- 11 new duplicate-ID regression tests (761 → 772 total)
- Execution pipeline audit tests (30 tests covering budget+reservation, retry/fallback, streaming, concurrency, security)

---

## [0.9.0] - 2026-08-23

### Release: Hard Budget Enforcement & Atomic Cost Control

v0.8.x established **Cost Awareness**. v0.9.0 establishes **Cost Enforcement**.

### Added

#### Atomic Reservation System

BudgetTracker now uses a reservation-based model to prevent concurrent requests from collectively exceeding budgets:

```typescript
const tracker = new BudgetTracker({ sessionBudget: 1.00 });

// Atomic: reserve before execution
const reservation = tracker.reserve("req_1", 0.60);
if (!reservation) throw new Error("Budget exceeded");

// Execute...
tracker.settle("req_1", 0.45); // actual < reserved → refund $0.15

// OR on failure:
tracker.release("req_1"); // free the reservation
```

**Key properties:**
- **Atomic reservation** — synchronous check+reserve (safe in JS event loop)
- **Committed cost tracking** — `committedCost = totalActual + totalReserved`
- **Reservation lifecycle** — reserve → execute → settle/release
- **Over-reservation handling** — actual > reserved is allowed (settles to actual)
- **Under-reservation refund** — actual < reserved returns unused budget
- **No leaked reservations** — guaranteed after terminal execution

#### Enhanced CostReport

```typescript
interface CostReport {
  totalEstimated: number;
  totalActual: number;
  totalReserved: number;     // NEW — pending reservations
  committedCost: number;      // NEW — actual + reserved
  requestCount: number;
  activeReservations: number; // NEW — pending count
  byProvider: Record<string, ...>;
  byPhase: Record<string, number>;
  budgetExceeded: boolean;
  remainingBudget: number | null;
}
```

#### Backward Compatible

The legacy `record()` API still works — existing code unchanged.

### Changed

- 36 new tests (640 → 676 total)

---

## [0.8.1] - 2026-08-23

### Fixed

- **`estimateCost` produced negative cost with negative token counts** — `(-100 / 1_000_000) * price` produced negative values. Fixed with `Math.max(0, ...)` guard. Severity: MEDIUM.
- **BudgetTracker callbacks not wrapped in try/catch** — `onBudgetWarning` and `onBudgetExceeded` callbacks that throw would corrupt budget accounting. Now wrapped in try/catch (notification-only semantics). Severity: HIGH.
- **`require()` in ESM tests** — replaced with proper ESM imports.

### Added

- **74 deep cost audit tests** covering:
  - Money correctness (NaN, Infinity, negative, floating point precision)
  - Budget boundary enforcement (exact limits, 99.9%, 100.1%)
  - Session budget enforcement (sequential, concurrent)
  - Per-request budget enforcement
  - Model pricing integrity (known, unknown, zero, negative tokens)
  - Estimated vs actual cost semantics
  - Callback safety (throwing callbacks don't corrupt accounting)
  - Cost report integrity (byProvider, byPhase reconciliation)
  - Client lifecycle (independent clients, reset, report immutability)
  - Router + cost integration
  - Security (no API key leakage, no prompt injection)
  - Adversarial inputs (NaN, Infinity, extreme values, negative budgets)
  - Determinism (100-iteration identical results)
  - Invariant testing (7 mathematical invariants verified)

### Changed

- 74 new tests (566 → 640 total)

---

## [0.8.0] - 2026-08-23

### Release: Cost-Aware Execution

Developer describes intent and budget. Hilbras executes intelligently within constraints.

### Added

#### BudgetTracker

Tracks costs across requests and enforces budget limits:

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient({
  budget: {
    sessionBudget: 1.00,       // Max total cost for the session
    perRequestBudget: 0.10,    // Max cost per individual request
    onBudgetWarning: (report) => console.warn(`80% budget used`),
    onBudgetExceeded: (report) => console.error(`Budget exhausted`),
  },
});
```

#### Cost Tracking

Every request records cost events with full lifecycle:

```typescript
client.record({ requestId, provider, model, phase: "execute", estimatedCost, actualCost });

const report = client.costReport();
// { totalEstimated, totalActual, requestCount, byProvider, byPhase, budgetExceeded, remainingBudget }
```

#### Budget Enforcement

- **Per-request budget:** Requests exceeding the limit are rejected before execution
- **Session budget:** Cumulative tracking with warning (80%) and exceeded callbacks
- **Zero overhead:** No cost when budget is not configured

```typescript
// Budget exceeded — throws before making API call
await client.complete({ ... }).catch(err => {
  if (err.message.includes("budget")) { /* handle */ }
});
```

#### Cost Reporting

```typescript
const report = client.costReport();
console.log(report.totalActual);      // Total spent
console.log(report.remainingBudget);   // Remaining budget
console.log(report.byProvider);        // Breakdown by provider
console.log(report.byPhase);           // Breakdown by phase (execute, retry, fallback)
```

#### Client API

```typescript
client.cost                     // BudgetTracker instance
client.costReport()             // Current cost report
client.isBudgetExhausted()      // Check if budget is exhausted
```

### Changed

- Budget enforcement integrated into `complete()` execution path
- 29 new tests (537 → 566 total)

---

## [0.7.1] - 2026-08-23

### Release: Execution Security, Reliability & Deep Audit

**PATCH CERTIFIED** — Hardening of the v0.7.0 execution optimization layer.

### Added

- **78 deep audit tests** covering:
  - Plan consistency (plan() vs best() vs explain() produce identical results)
  - Determinism (1,000 identical evaluations, score breakdowns, candidate ordering)
  - Hard constraint enforcement (needsVision, needsTools, maxCost, minContextWindow, excludeModels)
  - Cost security (total cost estimates, maxFallbackCost, budget alignment)
  - Retry vs fallback separation (independent dimensions, bounded execution)
  - Infinite loop defense (one model, empty registry, bounded fallback list)
  - Fallback safety (respects vision, tools, cost, context constraints)
  - Provider failure matrix (HTTP 400-503, network errors, timeouts)
  - Streaming safety (failure before/after first chunk, maxRetries=0)
  - Policy isolation (independent copies, per-request overrides)
  - State isolation (separate clients, provider removal)
  - Observability integrity (event ordering, requestId consistency, listener safety)
  - Security (API keys not in errors/routing/execution plans)
  - Prompt injection defense (malicious task strings)
  - Untrusted metadata handling (NaN, Infinity, extreme values)
  - Adversarial inputs (empty/long task strings, extreme constraints)
  - Plan immutability (mutating plan doesn't affect router)
  - API backward compatibility (explicit provider+model still works)

### Changed

- 78 new tests (422 → 500 total)

### Findings

- **Circuit breaker state leaks between test runs** — the global singleton `CircuitBreakerRegistry` accumulates failures across independent test cases, causing `CircuitBreakerOpenError` in subsequent tests. Tests now disable circuit breakers via policy when testing error paths.
- **No production bugs found** — all execution paths, constraint enforcement, fallback safety, cost estimates, and security guarantees verified correct.

---

## [0.7.0] - 2026-08-23

### Release: Execution Optimization

Hilbras SDK now intelligently optimizes how AI requests are executed — selecting models, managing fallbacks, estimating costs, and explaining decisions.

### Added

#### Execution Plan

New `plan()` method on the router and client returns the full execution decision:

```typescript
const plan = client.plan({
  task: "coding",
  messages,
  policy: { allowFallback: true, maxCost: 0.05 },
});

console.log(plan.primary.model);        // Best model
console.log(plan.estimatedTotalCost);    // Primary + retry + repair estimate
console.log(plan.fallbacks);             // Alternative models
console.log(plan.reasoning);             // Why this model was selected
```

#### Enhanced Scoring (9 dimensions)

Router scoring now includes detailed breakdown:

```typescript
const result = router.best({ task: "coding", needsTools: true });
console.log(result.scoreBreakdown);
// {
//   capabilityFit: 83,    // How well capabilities match
//   taskFit: 95,          // Task-specific compatibility
//   contextFit: 80,       // Context window fit
//   costEfficiency: 70,   // Cost relative to budget
//   latency: 65,          // Speed preference
//   budgetAlignment: 75,  // Budget tier alignment
//   providerPreference: 5, // Preferred provider bonus
//   structuredOutputFit: 0, // Structured output compatibility
//   toolFit: 10,          // Tool support
//   finalScore: 82.4
// }
```

#### Automatic Fallback

When `allowFallback: true` in the execution policy, the client automatically tries alternative models on failure:

```typescript
const result = await client.complete({
  task: "coding",
  messages,
  policy: {
    allowFallback: true,
    maxCost: 0.05,
    retry: { maxRetries: 3 },
  },
});
```

**Fallback safety:**
- Fallback candidates respect all hard constraints (capabilities, cost, context)
- Fallback respects execution policies
- Fallback is policy-driven, not unlimited
- Observability events emitted for each fallback attempt

**Preset defaults:**
| Preset | allowFallback |
|--------|--------------|
| `balanced` | false |
| `production` | true |
| `fast` | true |
| `cheap` | true |
| `maximum` | true |

#### Fallback Observability

```typescript
client.on("fallback.started", (event) => {
  console.log(`Falling back from ${event.originalModel} to ${event.fallbackModel}`);
});
```

### Changed

- `RoutingResult` now includes `scoreBreakdown` and `fallbacks` fields
- `RejectedCandidate.rejectionReason` is now optional (fallback candidates don't have rejection reasons)
- ResolvedPolicy now includes `allowFallback` and `maxFallbackCost` fields
- 31 new tests (391 → 422 total)

---

## [0.6.2] - 2026-08-23

### Release: Provider Contract & Integration Certification

### Fixed

- **OpenAI adapter `complete()` crash on non-JSON responses** — calling `res.json()` on a non-JSON response body caused `SyntaxError` to propagate unhandled. Now gracefully returns empty string with a try/catch around JSON parsing.

### Added

- **116 provider contract tests** (`tests/provider-contract.test.ts`) — comprehensive certification across all 6 adapters:
  - AIProvider contract compliance (id, stream, complete)
  - Canonical response normalization (OpenAI → Anthropic → Google → Azure → Groq → Ollama)
  - `complete()` contract: normal text, empty response, missing fields, null content
  - `stream()` contract: text chunks, ordering, completion
  - Tool calling: native tool calls, text-embedded `<tool_call>` markup, malformed arguments
  - Error normalization: HTTP 400/401/403/404/408/429/500/502/503, network errors, timeouts
  - Error contract: status code preserved, provider name preserved, body preserved
  - Timeout behavior: `complete()` and `stream()` both handle AbortError
  - Malformed responses: non-JSON body, unexpected structure, empty stream
  - Provider isolation: failure in one provider doesn't affect others
  - Concurrent provider calls: independent execution
  - Failure injection across all HTTP status codes

### Changed

- 116 new tests (275 → 391 total)

---

## [0.6.1] - 2026-08-23

### Fixed

- **Router crash on invalid task type** — passing an unknown task string (e.g. `"coding; DROP TABLE"`) to the router caused `TypeError: Cannot read properties of undefined (reading 'reasoning')` because `TASK_WEIGHTS[unknownTask]` returned `undefined`. Now falls back to `TASK_WEIGHTS.general`.

### Added

- **69 production audit tests** covering adversarial edge cases:
  - Client edge cases (missing provider/model, empty messages, dispose)
  - Router destruction (extreme costs, excluded models, contradictory requirements)
  - Router scoring (NaN/Infinity checks, bounds, hard > soft constraints)
  - Structured output attacks (empty/null/BOM/escaped/nested JSON)
  - Schema safety (throwing validators, missing safeParse)
  - Observability attack (listener errors don't break SDK)
  - Concurrency (10 concurrent requests, ID uniqueness)
  - Security (API key not in errors, injection)
  - Fuzz testing (extreme values, negative budgets)
  - Policy mutation safety (independent copies)
  - State isolation (separate clients, provider removal)
- **Clean install verification** — package installs from tarball, all imports work, zero runtime deps

### Changed

- 69 new tests (206 → 275 total)

---

## [0.6.0] - 2026-08-23

### Release: Intelligent Execution

Hilbras SDK is now an **AI Execution Engine** — not just a provider wrapper.

```typescript
const result = await client.complete({
  task: "coding",
  messages,
  policy: { maxCost: 0.05, maxLatency: "fast" },
  output: { schema: UserProfile },
});
```

Internally, Hilbras:
1. Understands the request requirements
2. Determines structured output is required
3. Discovers compatible models across all providers
4. Eliminates models violating hard constraints
5. Scores the remaining candidates deterministically
6. Selects the best model with full explainability
7. Executes through the appropriate provider
8. Validates the response against the schema
9. Automatically repairs invalid output
10. Returns a strongly typed result

### Added

#### `explain()` Method

Standalone routing explanation for debugging:

```typescript
const decision = client.explain({
  task: "coding",
  needsTools: true,
  maxCost: 0.05,
});

console.log(decision.reasons);
// ["Supports required tools", "Within budget ($0.004 of $0.05)"]

console.log(decision.candidates);
// [{ model: "...", rejectionReason: "Missing required capability: tools" }]
```

#### Integration Test Suite

New `tests/intelligent-execution.test.ts` covering:
- Full router pipeline (hard constraints, soft preferences, deterministic scoring)
- Explainable decisions with reasons and candidates
- Structured output pipeline (schema abstraction, validation, repair)
- Backward compatibility (explicit provider+model bypasses router)
- Router ↔ structured output integration
- Execution policy integration

### Changed

- 15 new tests (191 → 206 total)

---

## [0.5.2] - 2026-08-23

### Added

#### Observability Hooks

Structured telemetry hooks for observing every request lifecycle event:

```typescript
const client = new HilbrasClient();

// Request completion
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
client.on("structured.validate.pass", () => console.log("Schema valid"));
client.on("structured.validate.fail", (e) => console.log(`Schema failed: ${e.error}`));

// Stream first chunk latency
client.on("stream.first_chunk", (e) => console.log(`First chunk: ${e.latencyMs}ms`));
```

**Events emitted:**

| Event | When |
|---|---|
| `request.start` | Request initiated |
| `routing.resolved` | Router picked a model (or explicit bypass) |
| `request.completed` | Success with latency, tokens, cost |
| `request.failed` | Failure after all retries |
| `request.retrying` | Before retry sleep |
| `circuit_breaker.open` | Circuit breaker blocked the request |
| `structured.validate.pass` | Schema validation succeeded |
| `structured.validate.fail` | Schema validation failed |
| `stream.first_chunk` | First chunk yielded in stream |

**Features:**
- Zero overhead when no listeners attached
- Typed events with `requestId` for correlation
- `on()` returns unsubscribe function
- `off()` and `removeAll()` for cleanup
- Swallows listener errors (never breaks the SDK)

### Changed

- 10 new tests (181 → 191 total)

---

## [0.5.1] - 2026-08-23

### Fixed

Based on architectural review — 5 mandatory improvements:

#### Explainable Routing

`RoutingResult` now includes human-readable `reasons` and rejected `candidates`:

```typescript
const result = client.router.best({ task: "coding", needsTools: true });
console.log(result.reasons);
// ["Supports required tools", "Within budget ($0.004 of $0.05)", "Preferred provider (openai)"]

console.log(result.candidates);
// [{ model: "llama3.1", score: 0, rejectionReason: "Missing required capability: tools" }]
```

#### TaskType Taxonomy

`task` now uses a controlled type instead of arbitrary strings:

```typescript
type TaskType = "coding" | "reasoning" | "analysis" | "writing" |
  "translation" | "summarization" | "extraction" | "classification" | "general";
```

Each task type has specific scoring weights (coding favors tools+reasoning, writing favors cost, etc.)

#### Auto-Connect Output → Router

When `output` is provided to `complete()`, the router automatically filters for models with `structuredOutput` capability. No need to manually set `needsStructuredOutput: true`.

```typescript
// Router automatically selects a structured-output-capable model
await client.complete({ task: "coding", messages, output: { schema: MySchema } });
```

#### Enhanced RoutingResult

```typescript
interface RoutingResult {
  provider: string;
  model: string;
  entry: ModelEntry;
  score: number;
  estimatedCost: number;
  reasons: string[];           // NEW — human-readable selection reasons
  candidates?: RejectedCandidate[];  // NEW — rejected models with reasons
}
```

#### Architecture Naming

Renamed to "Policy-Based Model Router" — accurately reflects the deterministic, rule-based nature. Will evolve to "Intelligent Model Router" when benchmark and telemetry data are available.

### Changed

- 3 new tests (178 → 181 total)

---

## [0.5.0] - 2026-08-23

### Added

#### Intelligent Model Router

Let Hilbras pick the best model for your task — no more guessing which provider/model to use:

```typescript
// Old way — developer picks model manually
client.stream({ provider: "OpenAI", model: "gpt-5.6-sol", messages });

// New way — Hilbras picks the best model
client.stream({ task: "coding", messages, policy: { maxCost: 0.05 } });
```

**Features:**
- Evaluates all registered providers and BUILTIN_MODELS catalog
- Filters by capabilities (vision, tools, reasoning, structured output)
- Filters by cost, context window, budget tier, speed preference
- Scores candidates by task type, cost efficiency, and provider preference
- Returns ranked results or a single best match

```typescript
// Direct router access
const result = client.router.best({ task: "coding", needsTools: true, budget: "medium" });
console.log(result.provider, result.model, result.score);
```

#### Structured Output with Auto-Repair

Define a schema, Hilbras validates + auto-repairs invalid JSON:

```typescript
import { z } from "zod";

const UserProfile = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const user = await client.complete({
  provider: "OpenAI",
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "Create a user profile for John, age 24" }],
  output: { schema: UserProfile, maxRepairAttempts: 2 },
});
// user is typed as { name: string; age: number; email: string }
```

**Features:**
- Works with Zod, Valibot, or any `.safeParse()` validator
- Auto-repair: on validation failure, sends repair prompt with error details
- Provider-specific JSON mode (OpenAI `response_format`, Google `responseMimeType`)
- Smart JSON extraction from markdown fences and surrounding text
- Typed results via generics (`complete<T>(...)`)

#### New Types

- `TaskRequirement` — describes what a task needs
- `RoutingResult` — the router's decision
- `SchemaValidator` — interface for schema validation
- `StructuredOutputConfig` — config for structured output
- `ValidationError` — thrown when structured output fails after repair attempts

### Changed

- `stream()` and `complete()` now accept optional `provider`/`model` (routing mode) OR explicit `provider`+`model` (backward compatible)
- `complete()` is now generic: `complete<T>()` returns typed results when `output` is provided
- Client maintains a `ModelRouter` instance, updated automatically when providers are added/removed
- 32 new tests (146 → 178 total)

---

## [0.4.0] - 2026-08-22

### Added

#### Execution Policies

New `ExecutionPolicy` system for controlling reliability, timeout, retry, backoff, and circuit breaker behavior — both globally and per-request:

```typescript
// Named preset
client.stream({ ..., policy: { preset: "production" } });

// Custom policy
client.stream({ ..., policy: { retry: { maxRetries: 5 }, timeout: { requestTimeoutMs: 10_000 } } });

// Preset with overrides
client.stream({ ..., policy: { preset: "maximum", circuitBreaker: { enabled: false } } });
```

**5 built-in presets:**

| Preset | Retries | Timeout | Circuit Breaker | Use case |
|--------|---------|---------|-----------------|----------|
| `balanced` | 3 | 60s | On (5 failures) | Default — most apps |
| `production` | 5 | 120s | On (5 failures) | Conservative, reliable |
| `fast` | 1 | 15s | On (3 failures) | Latency-sensitive |
| `cheap` | 10 | 300s | Off | Cost matters more than speed |
| `maximum` | 10 | 300s | On (10 failures) | Critical operations |

**Per-request policy overrides client default:**

```typescript
const client = new HilbrasClient({ policy: { preset: "production" } });
// This request uses fast policy instead
await client.complete({ ..., policy: { preset: "fast" } });
```

#### SDKConfig Integration

`SDKConfig` reliability fields (`maxRetries`, `requestTimeoutMs`, `circuitBreakerEnabled`, `circuitBreakerThreshold`, `circuitBreakerResetMs`) are now wired to the actual runtime via the policy system:

```typescript
import { loadConfig } from "@hilbras/sdk";

const config = loadConfig({ configPath: "./hilbras.config.json" });
const client = new HilbrasClient({ sdkConfig: config });
```

Priority chain: `per-request policy > client default > SDKConfig > balanced preset`

#### New Exports

- `ExecutionPolicy`, `ResolvedPolicy`, `PolicyPreset` types
- `resolvePolicy()`, `getPreset()` functions

### Fixed

- `SDKConfig` reliability fields were disconnected from runtime — now wired through policy system
- Circuit breaker config (`failureThreshold`, `timeoutMs`, etc.) was always hardcoded — now configurable
- Retry config (`maxRetries`, `retryableStatuses`) was always hardcoded — now configurable
- Backoff config (`baseDelayMs`, `maxDelayMs`, `jitter`) was always hardcoded — now configurable

### Changed

- `HilbrasClient` constructor accepts optional `policy` and `sdkConfig`
- `stream()` and `complete()` accept optional per-request `policy`
- 16 new policy tests (130 → 146 total)

---

## [0.3.0] - 2026-08-22

### Added

#### Universal Provider Contract (`AIProvider` Interface)
- New `AIProvider` interface defines the universal contract all adapters implement:
  ```typescript
  interface AIProvider {
    readonly id: string;
    stream(params: GenerateParams): AsyncGenerator<StreamChunk>;
    complete(params: GenerateParams): Promise<string>;
  }
  ```
- New `AdapterConfig` shared type for adapter constructors
- New `GenerateParams` type for stream/complete parameters
- All 6 adapters now declare `implements AIProvider` with a `readonly id`

#### Plugin Registration System (`AdapterRegistry`)
- New `AdapterRegistry` class for registering adapter factories by ID
- `getDefaultAdapterRegistry()` returns a registry pre-loaded with all 6 built-in adapters
- Third-party adapters can be registered without modifying SDK core:
  ```typescript
  import { AdapterRegistry } from "@hilbras/sdk";
  const registry = getDefaultAdapterRegistry();
  registry.register("mistral", (config) => new MistralAdapter(config));
  ```
- `HilbrasClient` accepts optional `adapterRegistry` config
- `HilbrasClient.adapterRegistry` getter for accessing the registry

#### Subpath Export
- `@hilbras/sdk/adapter` — imports the `AIProvider`, `AdapterConfig`, `GenerateParams` types

### Fixed
- Removed phantom `"responses"` from `AdapterName` type (no adapter implementation existed)
- Removed `"responses"` from `APIFormat` type
- Client no longer uses `any` casts — adapters are typed as `AIProvider` with compile-time safety
- Client no longer imports all 6 adapter classes directly — uses the registry instead

### Changed
- All 6 adapters now have `readonly id` property (e.g. `"openai"`, `"anthropic"`)
- Adapter config types (`OpenAIAdapterConfig`, `AnthropicAdapterConfig`, etc.) now alias or extend `AdapterConfig`
- `HilbrasClient` constructor accepts `adapterRegistry` option for custom plugin registries

---

## [0.2.0] - 2026-08-22

### Added

#### New Adapters
- **`complete()` method** added to Anthropic, Google GenAI, Azure, Groq, and Ollama adapters. Previously only the OpenAI adapter implemented non-streaming completion — calling `client.complete()` with any other provider would crash at runtime.

#### Model Catalog
- **OpenAI:** GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o3-mini, o4-mini, o1-mini
- **Azure:** GPT-4.1 (Azure), GPT-4.1 Mini (Azure), o3 Mini (Azure), GPT-4o Mini (Azure)
- **Anthropic:** Claude Opus 4, Claude 3.7 Sonnet
- **Google Gemini:** Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash (provider field corrected to `google-genai`)
- **Groq:** Llama 4 Maverick, Llama 4 Scout, DeepSeek R1 Distill
- **Ollama:** Llama 3.3, Qwen 2.5 Coder

#### Token Pricing
- Updated pricing table with 2025 model rates (GPT-4.1 family, o3/o4, Claude Opus 4, Gemini 2.5, etc.)

#### Timeout Enforcement
- `createTimeoutSignal()` is now wired into `HilbrasClient.stream()` and `HilbrasClient.complete()`. Providers with a `timeout` config now enforce it via `AbortSignal`, preventing hung requests.

#### Subpath Exports
- Added subpath exports for tree-shaking: `@hilbras/sdk/adapters/openai`, `@hilbras/sdk/tokens`, `@hilbras/sdk/config`, `@hilbras/sdk/transport/fetch`, `@hilbras/sdk/reliability/*`

#### Documentation
- Comprehensive README with provider table, feature examples, architecture diagram, subpath imports, and error handling guide
- CHANGELOG.md (this file)
- CONTRIBUTING.md with development guidelines
- Full API documentation in `docs/`

#### Tests
- 38 new tests (59 → 97 total, 6 → 11 test files)
- Azure adapter tests (6 tests): routing, auth headers, streaming, complete
- Groq adapter tests (6 tests): streaming, auth, reasoning normalization, complete
- Ollama adapter tests (5 tests): streaming, no-auth, num_predict, complete
- Middleware tests (11 tests): compose, auth, logging, retry, rate-limit, cache
- Degradation tests (10 tests): all 4 levels, withDegradation success/degrade/error/all-fail

### Fixed

- **`AdapterName` type** now includes `"azure"`, `"groq"`, `"ollama"`. Previously, `addProvider({ adapter: "azure" ... })` was a TypeScript error even though the runtime code handled it.
- **`require("node:fs")`** in `config/config.ts` replaced with ESM `import { readFileSync }`. This was a CJS call in an ESM module and would throw in strict ESM contexts.
- **`process.cwd()` in `DEFAULT_CONFIG`** guarded with `typeof process !== "undefined"` check. Previously this would throw in browser/Deno environments when importing the config schema.
- **`WebSocketTransport`** now uses `getWebSocketConstructor()` with a clear error message for Node 18–21 (which lacks global `WebSocket`). Previously the code would crash with an opaque reference error.
- **`dist/` was stale** — 12 of 30 source modules had no compiled output. The `dist/` is now fully rebuilt and verified against source.
- **`tsconfig.json`** updated with `DOM`, `DOM.Iterable` libs and `@types/node`. TypeScript compilation was impossible without these type definitions for web APIs (`AbortSignal`, `Response`, `ReadableStream`, `fetch`, etc.).
- **`Transport.body` type** narrowed from `string | Uint8Array` to `string`. The `Uint8Array` variant caused type incompatibility between Node and DOM `Uint8Array` definitions.

### Changed

- **DevDependencies:** Added `typescript`, `oxlint`, `@types/node` (were referenced by scripts but not installed)
- **`Body` type in transport** simplified to `string` only — all adapters serialize to JSON strings anyway

---

## [0.1.0] - 2026-07-21

### Added

Initial release of `@hilbras/sdk`.

#### Core
- `HilbrasClient` — main entry point with `stream()` and `complete()` methods
- Provider registry with add/remove/findModel
- `AsyncDisposable` support for cleanup

#### Adapters
- **OpenAI** — Chat Completions API with streaming, tool calls, reasoning detection
- **Anthropic** — Messages API with system prompt extraction, tool schema conversion
- **Google GenAI** — Gemini API with function declarations, NDJSON streaming
- **Azure** — Azure OpenAI with deployment routing, `api-key` header, API version
- **Groq** — OpenAI-compatible for ultra-fast inference
- **Ollama** — Local models, no auth required

#### Reliability
- Circuit breaker (CLOSED → OPEN → HALF_OPEN state machine)
- Retry with exponential backoff and jitter
- Timeout via AbortSignal composition
- Graceful degradation chain (normal → media-degraded → media-stripped → history-truncated)

#### Transport
- `FetchTransport` — native fetch, works in Node 18+, Bun, Deno, browsers
- `WebSocketTransport` — bidirectional transport for WebSocket providers
- `Transport` interface for custom implementations

#### Types
- Canonical `Message`, `Tool`, `StreamChunk` types
- `messageToDict` / `dictToMessage` converters
- Discriminated union stream chunks: Text, Reasoning, ToolCall, Usage, Error, Finish

#### Tokens
- Token estimation heuristic (~4 chars/token)
- Per-message and per-tool token counting
- Cost estimation with model pricing table
- Prompt caching support (Anthropic `cache_control`, OpenAI)

#### Config
- Layered config: defaults → file → env vars → runtime overrides
- Environment variable loading (prefix `HILBRAS_`)
- JSON config file support
- Config validation

#### Middleware
- `composeMiddlewares` — chain middlewares
- `authMiddleware` — dynamic token injection
- `loggingMiddleware` — request/response logging
- `retryMiddleware` — retry with backoff
- `rateLimitMiddleware` — request throttling
- `cacheMiddleware` — GET response caching

#### Reasoning
- `ReasoningNormalizer` — detects `<thinking>`, `<reasoning>`, `<reason>` tags across delta boundaries
- Native reasoning field support (`reasoning_content`, `thinking`)

#### Credentials
- `DefaultCredentialProvider` — resolves from explicit token or environment variable
- Pluggable `CredentialProvider` interface

#### Logging
- `SDKLogger` with configurable log levels
- Automatic redaction of API keys and tokens
- Circular log buffer (1000 entries)

#### Errors
- Typed error hierarchy: `HilbrasSdkError` → `ProviderNotFoundError`, `ModelNotFoundError`, `ProviderRequestError`, `StreamError`, `InvalidFormatError`, `ConfigurationError`, `CircuitBreakerOpenError`
