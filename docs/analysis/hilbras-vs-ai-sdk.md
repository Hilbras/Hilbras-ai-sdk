# Hilbras SDK vs Vercel AI SDK — Full Comparison & Improvement Plan

**Date:** 2026-09-17
**Hilbras SDK:** v0.9.4 (`@hilbras/sdk`)
**Vercel AI SDK:** v7.0.77 (`ai`)

---

## 1. Executive Summary

| Dimension | Hilbras SDK | Vercel AI SDK | Winner |
|---|---|---|---|
| **Philosophy** | Single-package, zero-dep execution engine | Monorepo ecosystem (76 packages) | Different goals |
| **Providers** | 6 built-in adapters | 35+ provider packages | Vercel |
| **Model types** | Language only (chat) | 7 types (language, embedding, image, speech, video, transcription, reranking) | Vercel |
| **UI integrations** | None (headless) | React, Vue, Svelte, Angular hooks | Vercel |
| **Reliability** | Circuit breaker, retry, degradation, middleware | Retry only | **Hilbras** |
| **Cost enforcement** | Atomic reservations, budgets, tracker | None built-in | **Hilbras** |
| **Security** | SSRF guard, API key redaction | Custom lint rule (less strict) | **Hilbras** |
| **Model routing** | Multi-criteria scoring router with explainability | None | **Hilbras** |
| **Runtime deps** | Zero | 3 (core) + 6 (provider-utils) | **Hilbras** |
| **Bundle size** | ~120KB (single package) | ~105ms load (core) | **Hilbras** |
| **Tests** | 898 | ~11,600 | Vercel |
| **CI sophistication** | Basic (build + test + lint) | 13 jobs, sharded, multi-Node, load-time benchmarks | Vercel |
| **Documentation** | Markdown files | Full docs site (ai-sdk.dev) | Vercel |
| **Framework support** | Node 18+, Bun, Deno, edge | Node 22+, Edge, Browser | Comparable |
| **Type safety** | Strict TS, basic types | 68 type test files, generic inference | Vercel |

---

## 2. Feature-by-Feature Comparison

### 2.1 Provider Support

| Feature | Hilbras | Vercel |
|---|---|---|
| OpenAI | Yes (adapter) | Yes (package) |
| Anthropic | Yes (adapter) | Yes (package) |
| Google Gemini | Yes (adapter) | Yes (package) |
| Azure OpenAI | Yes (adapter) | Yes (package) |
| Groq | Yes (adapter) | Yes (package) |
| Ollama | Yes (adapter) | Yes (package) |
| Mistral | No | Yes |
| Cohere | No | Yes |
| DeepSeek | No | Yes |
| Amazon Bedrock | No | Yes |
| xAI (Grok) | No | Yes |
| Fireworks | No | Yes |
| Together AI | No | Yes |
| Perplexity | No | Yes |
| HuggingFace | No | Yes |
| Replicate | No | Yes |
| Cerebras | No | Yes |
| DeepInfra | No | Yes |
| MiniMax | No | Yes |
| Moonshot | No | Yes |
| **Total** | **6** | **35+** |

### 2.2 Model Types

| Type | Hilbras | Vercel |
|---|---|---|
| Language (chat) | Yes | Yes |
| Embeddings | No | Yes |
| Image generation | No | Yes |
| Speech (TTS) | No | Yes |
| Transcription (STT) | No | Yes |
| Video generation | No | Yes |
| Reranking | No | Yes |
| Realtime (audio) | No | Yes |

### 2.3 Core Features

| Feature | Hilbras | Vercel |
|---|---|---|
| Streaming | Yes (async generator) | Yes (async generator + smooth) |
| Non-streaming | Yes (`complete()`) | Yes (`generateText()`) |
| Tool calling | Yes | Yes + approval system |
| Structured output | Yes (with auto-repair) | Yes (`generateObject()`) |
| Reasoning normalization | Yes (`<thinking>` tags) | Yes (configurable effort levels) |
| Middleware | Yes (transport-level) | Yes (`wrapLanguageModel`) |
| Circuit breaker | Yes (per-provider, singleton) | No |
| Retry with backoff | Yes (exponential + jitter) | Yes (basic) |
| Graceful degradation | Yes (content stripping chain) | No |
| Budget/cost tracking | Yes (atomic reservations) | No |
| Model routing | Yes (multi-criteria scoring) | No |
| SSRF protection | Yes (URL validation) | Partial (lint rule) |
| API key redaction | Yes (automatic in errors) | No |
| Prompt caching | Yes (cache control helpers) | Provider-native only |
| Token estimation | Yes (heuristic + pricing) | Provider-reported only |
| Observability hooks | Yes (10 event types) | Yes (OpenTelemetry) |
| Config system | Yes (env + file + runtime) | Provider options only |
| WebSocket transport | Yes | Yes (realtime only) |

### 2.4 Unique to Hilbras

- **Model Router** — Multi-criteria scoring with explainability, fallback candidates, cost estimation
- **Circuit Breaker** — Per-provider failure isolation with half-open recovery
- **Graceful Degradation** — Automatic content stripping on context overflow
- **Budget Enforcement** — Atomic reservation-settle-release lifecycle with session/per-request budgets
- **SSRF Guard** — URL validation blocking private networks, AWS metadata
- **API Key Redaction** — Automatic in all error messages
- **Zero Runtime Deps** — Pure TypeScript, no transitive dependencies
- **Execution Policy Presets** — `balanced`, `production`, `fast`, `cheap`, `maximum`

### 2.5 Unique to Vercel

- **UI Framework Hooks** — `useChat`, `useCompletion`, `useObject`, `useRealtime` for React/Vue/Svelte/Angular
- **Agent System** — `ToolLoopAgent`, `HarnessAgent` for coding agents
- **Multi-modal types** — Embeddings, images, speech, video, transcription, reranking
- **MCP Support** — Model Context Protocol client
- **Tool Approval** — Human-in-the-loop with cryptographic signatures
- **Smooth Streaming** — Word/line/custom chunk detection with CJK support
- **DevTools** — CLI + web viewer for debugging
- **Codemod** — Automated major version migrations
- **Custom Lint Rules** — oxlint plugin enforcing security patterns
- **Load Time Benchmarks** — CI monitors module load time
- **Bundle Size Checks** — CI enforces size thresholds

---

## 3. Architecture Comparison

### Hilbras: Single Package

```
@hilbras/sdk
├── src/
│   ├── client/          (2 files — client + hooks + pipeline)
│   ├── adapters/        (7 files — 6 providers + text parser)
│   ├── router/          (1 file — model router)
│   ├── reliability/     (6 files — circuit breaker, retry, backoff, timeout, presets, degradation)
│   ├── cost/            (2 files — tracker + types)
│   ├── security/        (2 files — url guard + index)
│   ├── config/          (4 files — schema, config, prompts, provider-config)
│   ├── output/          (1 file — structured output)
│   ├── reasoning/       (1 file — normalizer)
│   ├── tokens/          (2 files — counter + prompt cache)
│   ├── transport/       (3 files — transport, fetch, websocket)
│   ├── middleware/       (1 file — middleware system)
│   ├── errors/          (1 file — error hierarchy)
│   ├── logging/         (1 file — logger + redact)
│   ├── providers/       (2 files — registry + adapter registry)
│   ├── credentials/     (1 file — credential provider)
│   ├── catalog/         (1 file — model catalog)
│   └── types/           (11 files — all type definitions)
└── tests/               (34 test files)
```

### Vercel: Monorepo (76 packages)

```
ai-repo/
├── packages/
│   ├── ai/                    (core — generateText, streamText, etc.)
│   ├── provider/              (provider interface specs)
│   ├── provider-utils/        (shared utilities)
│   ├── gateway/               (Vercel AI Gateway)
│   ├── openai/                (provider adapter)
│   ├── anthropic/             (provider adapter)
│   ├── google/                (provider adapter)
│   ├── ... (35+ provider packages)
│   ├── react/                 (useChat, useCompletion, etc.)
│   ├── vue/                   (Vue hooks)
│   ├── svelte/                (Svelte hooks)
│   ├── angular/               (Angular hooks)
│   ├── rsc/                   (React Server Components)
│   ├── harness/               (coding agent abstraction)
│   ├── mcp/                   (Model Context Protocol)
│   ├── workflow/              (workflow agents)
│   ├── otel/                  (OpenTelemetry)
│   ├── devtools/              (developer tools)
│   └── codemod/               (migration tool)
└── tools/
    ├── oxlint-plugin-ai-sdk/  (custom lint rules)
    └── memory-benchmark/      (performance benchmarking)
```

---

## 4. Improvement Plan for Hilbras SDK

### Phase 1: Foundation (v0.10.0) — Provider Expansion

**Goal:** Match Vercel's provider breadth for the language model category.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Add Mistral adapter | 1-2 days | High — popular provider |
| P0 | Add DeepSeek adapter | 1-2 days | High — cost-effective reasoning |
| P0 | Add xAI (Grok) adapter | 1 day | Medium — growing adoption |
| P1 | Add Cohere adapter | 1-2 days | Medium — enterprise RAG |
| P1 | Add Amazon Bedrock adapter | 2-3 days | High — enterprise market |
| P1 | Add Together AI adapter | 1 day | Medium — open-source models |
| P1 | Add Fireworks adapter | 1 day | Medium — fast inference |
| P2 | Add Perplexity adapter | 1 day | Low — search-augmented |
| P2 | Add Cerebras/DeepInfra adapters | 1 day each | Low — niche providers |
| P2 | Add OpenAI-compatible generic adapter | 1 day | High — covers 20+ providers |

**Implementation approach:**
- Create a `GenericOpenAIAdapter` that works with any OpenAI-compatible endpoint
- Use it as the base for simple adapters (Together, Fireworks, DeepInfra, etc.)
- Only write custom adapters for providers with non-OpenAI wire formats (Bedrock, Cohere)

### Phase 2: Multi-Modal (v0.11.0) — Beyond Chat

**Goal:** Expand from language-only to multi-modal model types.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Add `EmbeddingModel` type + `embed()` / `embedMany()` | 3-4 days | High — RAG use cases |
| P1 | Add `ImageModel` type + `generateImage()` | 2-3 days | Medium — creative apps |
| P1 | Add `SpeechModel` type + `generateSpeech()` | 2-3 days | Medium — accessibility |
| P2 | Add `TranscriptionModel` type + `transcribe()` | 2-3 days | Medium — audio apps |
| P2 | Add `RerankingModel` type + `rerank()` | 1-2 days | Medium — search quality |

**Implementation approach:**
- Extend `AIProvider` interface with optional model type methods
- Create `AIProvider` subtypes: `LanguageModel`, `EmbeddingModel`, `ImageModel`, etc.
- Each adapter declares which model types it supports
- Client methods (`embed()`, `generateImage()`) resolve the adapter and delegate

### Phase 3: Developer Experience (v0.12.0) — Type Safety & DX

**Goal:** Match Vercel's type safety and developer experience.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Add generic type inference for `complete<T>()` return type | 2-3 days | High — DX improvement |
| P0 | Add Zod/Valibot schema integration (`zodSchema()`, `jsonSchema()`) | 2 days | High — standard patterns |
| P1 | Add type-level tests (`*.test-d.ts`) | 3-4 days | High — prevent regressions |
| P1 | Add `generateId()` / `createIdGenerator()` utilities | 1 day | Low — convenience |
| P1 | Add `parseJsonEventStream()` utility | 1 day | Low — SSE parsing |
| P2 | Add `tool()` helper with input schema + execute function | 2 days | Medium — cleaner API |
| P2 | Add `dynamicTool()` for runtime-defined tools | 1 day | Low — flexibility |

### Phase 4: Observability & Telemetry (v0.13.0) — Production Readiness

**Goal:** Match Vercel's OpenTelemetry integration and add production observability.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Add OpenTelemetry integration (spans, metrics, traces) | 4-5 days | High — production essential |
| P1 | Add structured JSON logging mode | 2 days | High — log aggregation |
| P1 | Add request/response body logging (with redaction) | 2 days | Medium — debugging |
| P1 | Add token usage aggregation dashboard helper | 2 days | Medium — cost visibility |
| P2 | Add latency histograms per provider/model | 1 day | Medium — performance monitoring |
| P2 | Add error rate tracking with alerting hooks | 1 day | Low — operations |

### Phase 5: Security Hardening (v0.14.0) — Enterprise Grade

**Goal:** Exceed Vercel's security posture.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Add custom oxlint rule `hilbras/require-validate-url` | 2-3 days | High — prevent SSRF bypass |
| P0 | Add OIDC/token-based authentication support | 2-3 days | High — no long-lived secrets |
| P1 | Add request signing (HMAC) for provider authentication | 2 days | Medium — enterprise requirement |
| P1 | Add PII detection and redaction in logs/outputs | 3-4 days | High — GDPR/privacy |
| P2 | Add SOC 2 compliance helpers (audit logging, data retention) | 5+ days | Medium — enterprise sales |

### Phase 6: Testing & CI (v0.17.0) — Quality Parity

**Goal:** Match Vercel's testing sophistication.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P0 | Expand test suite to 2000+ tests | 5-7 days | High — reliability confidence |
| P0 | Add dual-environment testing (Node + Edge) | 2-3 days | High — runtime compatibility |
| P1 | Add sharded CI (4 shards × 3 Node versions) | 1-2 days | Medium — CI speed |
| P1 | Add bundle size checking in CI | 1 day | Medium — prevent bloat |
| P1 | Add load time benchmarking in CI | 1 day | Medium — performance regression |
| P2 | Add MSW-based HTTP mocking for provider tests | 2-3 days | Medium — test isolation |
| P2 | Add Playwright E2E tests | 3-5 days | Low — browser integration |

### Phase 7: Ecosystem (v1.0.0) — Framework Integration

**Goal:** Add UI framework hooks to match Vercel's frontend story.

| Priority | Task | Effort | Impact |
|---|---|---|---|
| P1 | Create `@hilbras/react` with `useChat()` hook | 5-7 days | High — React ecosystem |
| P1 | Create `@hilbras/react` with `useCompletion()` hook | 2-3 days | High — simple completions |
| P2 | Create `@hilbras/vue` with Vue 3 Composition API hooks | 5-7 days | Medium — Vue ecosystem |
| P2 | Create `@hilbras/svelte` with Svelte 5 runes | 5-7 days | Low — Svelte ecosystem |
| P2 | Add `UIMessage` protocol for frontend streaming | 3-4 days | High — needed for hooks |
| P3 | Add `@hilbras/angular` | 5-7 days | Low — Angular ecosystem |

---

## 5. Strategic Recommendations

### 5.1 Where Hilbras Should Stay Unique

These are Hilbras' **competitive advantages** that Vercel does NOT have:

1. **Zero runtime dependencies** — This is Hilbras' killer feature. Never compromise on this.
2. **Circuit breaker** — No other LLM SDK has per-provider failure isolation.
3. **Budget enforcement** — Atomic reservation-settle-release is unique and valuable.
4. **Model routing with explainability** — Multi-criteria scoring with audit trails.
5. **Graceful degradation** — Automatic content stripping on context overflow.
6. **SSRF guard** — URL validation is more secure than Vercel's lint-rule approach.
7. **API key redaction** — Automatic in all error messages.
8. **Single-package simplicity** — No monorepo complexity for users.

### 5.2 Where Hilbras Should Copy Vercel

1. **Provider breadth** — Add 10+ more providers (Phase 1)
2. **Multi-modal model types** — Embeddings, images, speech (Phase 2)
3. **Type safety** — Generic inference, type tests, Zod integration (Phase 3)
4. **OpenTelemetry** — Production observability (Phase 4)
5. **Custom lint rules** — Enforce security patterns (Phase 5)
6. **CI sophistication** — Sharding, bundle checks, load benchmarks (Phase 6)
7. **UI framework hooks** — React/Vue/Svelte (Phase 7)

### 5.3 Where Hilbras Should Innovate Beyond Vercel

1. **Agent system** — Hilbras already has `buildCodingAgentPrompt()`. Extend this into a full agent runtime with tool loops, approval, and sandboxing.
2. **Cost optimization** — Hilbras has budget tracking. Add cost-aware routing that automatically picks the cheapest model that meets quality thresholds.
3. **Degradation chaining** — Hilbras has content degradation. Extend to automatic fallback across providers with quality preservation.
4. **Offline mode** — Support local Ollama with automatic sync when cloud providers are unavailable.
5. **Multi-tenant budgets** — Per-user or per-team budget tracking for SaaS applications.

### 5.4 Priority Matrix

```
                        HIGH IMPACT
                            │
     Phase 1 (Providers)    │    Phase 3 (Type Safety)
     Phase 2 (Multi-modal)  │    Phase 4 (Telemetry)
                            │
   LOW EFFORT ──────────────┼────────────── HIGH EFFORT
                            │
     Phase 5 (Security)     │    Phase 6 (Testing)
     Phase 7 (UI Hooks)     │
                            │
                        LOW IMPACT
```

**Recommended order:** Phase 1 → Phase 3 → Phase 4 → Phase 5 → Phase 2 → Phase 6 → Phase 7

### 5.5 Timeline

| Phase | Version | Target Date | Key Deliverable |
|---|---|---|---|
| Phase 1 | v0.10.0 | 2 weeks | 10+ providers, generic OpenAI adapter |
| Phase 2 | v0.11.0 | 4 weeks | Embeddings, image, speech support |
| Phase 3 | v0.12.0 | 6 weeks | Generic types, Zod integration, type tests |
| Phase 4 | v0.13.0 | 8 weeks | OpenTelemetry, structured logging |
| Phase 5 | v0.14.0 | 10 weeks | Custom lint rules, OIDC, PII redaction |
| Phase 6 | v0.17.0 | 12 weeks | 2000+ tests, sharded CI, benchmarks |
| Phase 7 | v1.0.0 | 16 weeks | React/Vue/Svelte hooks, UIMessage protocol |

---

## 6. Conclusion

Hilbras SDK has **unique strengths** in reliability (circuit breaker, degradation), cost enforcement (budget tracking), security (SSRF guard, redaction), and simplicity (zero deps, single package). These are areas where Vercel has nothing comparable.

Vercel's advantages are **breadth** (35+ providers, 7 model types), **ecosystem** (UI framework hooks, agent system), and **DX polish** (type tests, custom linting, load benchmarks).

The improvement plan prioritizes **provider expansion** (most requested feature), **type safety** (biggest DX gap), and **observability** (production essential), while preserving Hilbras' unique advantages. The goal is not to become Vercel, but to be the **best single-package, zero-dependency LLM SDK** with enterprise-grade reliability, cost control, and security.
