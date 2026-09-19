# HILBRAS SDK — DEEP CODEBASE AUDIT

**Repository:** `/run/media/gin/01DD24D06510A4D0/Hilbras.product/SDK`
**Package:** `@hilbras/sdk` v0.26.6
**Audit type:** Repository-wide static analysis and architectural audit
**Date:** 2026-09-19
**Method:** Static inspection only. No project files were modified, created, deleted, renamed, or reformatted. This document is the sole artifact written (it is the requested deliverable).

> **Note on this file:** An earlier attempt to write this report failed because the full document exceeded the single-call payload limit, so nothing was written to disk. It was then written in sections. This header marks the completed document.

---

## Executive Summary

`@hilbras/sdk` v0.26.6 is a single-package, zero-runtime-dependency TypeScript SDK providing a provider-agnostic LLM client with 23 adapters, a policy-based model router, reservation-based budget enforcement, SSRF-safe provider registration, structured-output auto-repair, and a typed observability event surface. The repository holds 154 source files under `src/`, 68 test files under `tests/`, plus a CLI package, a scaffolding package, two showcase apps, docs, and an ADR process.

**Actual architectural state.** The module-level organization is sound: `types` → `transport` → `adapters` → `reliability` → `client`, with `security`, `telemetry`, and `features` as satellites. The public contract (`AIProvider`) is clean and the adapter registry genuinely delivers the "plugin without core changes" promise. Reliability behavior (retry, backoff, circuit breaker, timeout) and cost enforcement (atomic reservation lifecycle) are real, implemented, and tested.

The structural problems are concentrated, not diffuse:

1. **A 1,217-line client god-file** (`src/client/client.ts`) that still owns the retry loop, the fallback loop, message normalization, budget orchestration, and event emission, despite `src/client/pipeline.ts` having been introduced specifically to extract these concerns.
2. **A large unwired public surface.** At least 15 exported subsystems (`credentials/`, `middleware/`, `devtools/`, `telemetry/*`, `security/*` beyond the URL guard, `reliability/degradation.ts`) have zero internal consumers. They are exported, documented, and tested, but never invoked by the SDK core.
3. **Two confirmed defects with functional impact** — an environment-variable API-key redaction bug that makes env-configured providers non-functional, and a `ReasoningNormalizer` buffer-accumulation bug that can misclassify user text as chain-of-thought reasoning.
4. **Stub and partial implementations** presented in docs as features — `MCPClient`, `RealtimeSession`, and the fine-tune quality/split helpers.
5. **The two most important methods in the SDK — `HilbrasClient.stream()` and `complete()` — have no direct tests.** The extracted `pipeline.ts` is tested in isolation; the loops that call it are not.

The test suite is otherwise thorough and the security posture is genuinely strong. This is a codebase that is *close* to its own stated goals; the gap is integration and consolidation rather than redesign.
## 1. Repository Discovery

### Repository Map

```text
Hilbras.product/SDK/
├── .github/                  CI/CD configuration
├── architecture/             ADR process (0001 accepted; no subsystem ADRs yet)
├── benchmarks/               Performance benchmark harness
├── docs/                     20+ Markdown docs + docs/analysis/ (prior audit reports)
├── docs-site/                Single-file docs site (index.html)
├── packages/
│   ├── cli/                  `hilbras` CLI — provider/model/cost/doctor commands
│   ── create-hilbras-app/   Scaffolding CLI + 3 templates
├── showcase/                 cli-chat, code-assistant example apps
├── src/                      154 source files (the SDK itself)
├── tests/                    68 test files
├── tools/                    check-size.mjs, check-validate-url.mjs
├── dist/                     Compiled output (present on disk)
├── package.json              @hilbras/sdk, zero runtime deps
├── tsconfig.json             strict, experimentalDecorators: true
└── vitest.config.ts
```

### Directory Responsibilities (verified against implementation, not names)

| Directory | Verified responsibility | Classification |
|---|---|---|
| `src/adapters/` | 23 provider adapters + a shared text-tool-call parser | Core |
| `src/catalog/` | `BUILTIN_MODELS` (TS) + `provider-catalog.json` (JSON) — **two parallel catalogs** | Core |
| `src/client/` | `HilbrasClient` (1,217 lines), `RequestPipeline` (353), `ClientHooks` (69) | Core |
| `src/config/` | `SDKConfig` loader (env/file/overrides), `ProviderConfig` canonical home, prompt builder | Infrastructure |
| `src/cost/` | `BudgetTracker` reservation lifecycle + cost types | Core |
| `src/credentials/` | `DefaultCredentialProvider` singleton — **no internal consumer** | Dead |
| `src/devtools/` | `DevTools` request-inspector — **no internal consumer** | Interface (unwired) |
| `src/errors/` | 9-class typed error hierarchy; `redact` applied in `ProviderRequestError` | Core |
| `src/features/agent/` | `ToolLoopAgent`, `ReActAgent`, `PlanAndExecuteAgent` | Application |
| `src/features/eval/` | `evaluate()` + 6 metrics including `llmJudge` | Application |
| `src/features/fine-tune/` | `formatters` / `split` / `quality` — data prep only, no API calls | Application (partial) |
| `src/features/rag/` | `InMemoryVectorStore`, chunker, retriever, pipeline | Application (partial) |
| `src/frameworks/` | 9 framework integrations (React, Vue, Svelte, Solid, Qwik, Angular, Next.js, Astro, Remix) | Interface |
| `src/index.ts` | Public barrel — ~80+ exports | Core |
| `src/logging/` | `SDKLogger` + `redact()`. **Only `redact` has consumers**; `sdkLogger` is dead | Infrastructure |
| `src/mcp/` | `MCPClient` — **stub: `callTool` returns a hardcoded string** | Partial |
| `src/middleware/` | 5 middleware factories — **no internal consumer** | Dead |
| `src/output/` | `extractJson`, `validateOutput`, repair-prompt builders, JSON-mode params | Core |
| `src/providers/` | `ProviderRegistry` + `AdapterRegistry` (the 23-entry factory map) | Core |
| `src/realtime/` | `RealtimeSession` — WebSocket, OpenAI event shape only | Partial |
| `src/reasoning/` | `ReasoningNormalizer` (stateful tag stripper) | Core |
| `src/reliability/` | circuit-breaker, retry, backoff, timeout, presets, degradation | Core |
| `src/router/` | `ModelRouter` — deterministic policy scoring over `BUILTIN_MODELS` | Core |
| `src/security/` | url-guard (wired), pii-guard, audit-logger, request-signer (**last 3 unwired**) | Infrastructure |
| `src/telemetry/` | opentelemetry, structured-logger, dashboard, body-logger — **all 4 unwired** | Infrastructure (unwired) |
| `src/tokens/` | `estimateTokens` heuristics, `estimateCost` pricing table, `prompt-cache` | Core |
| `src/transport/` | `Transport` contract, `FetchTransport` (wired), `WebSocketTransport` | Core |
| `src/types/` | 12 type modules; `providers.ts` re-exports `ProviderConfig` from config | Core |
| `src/utils/` | `id.ts`, `sse.ts`, `sse-writer.ts` | Core |
| `packages/cli/` | 5 commands; own duplicated pricing table | Tool |
| `packages/create-hilbras-app/` | Scaffolding; `validate.ts` guards template/project names | Tool |

### Notable discovery

`docs/analysis/` already contains prior audits (`hilbras-sdk.md`, `comparison.md`, `ai-main.md`) written against **v0.9.3**. The package is now **v0.26.6** — a 17-minor-version gap. Those documents are stale and should not be treated as current (see §20).

---
## 2. Architecture Reconstruction

### Reconstructed layers

```text
┌─ APPLICATION ──────────────────────────────────────────────────┐
│ Frameworks (9)   Agent (3 patterns)   Eval   RAG   Fine-tune   │
└───────────────────────────┬────────────────────────────────────┘
┌─ SDK CORE ────────────────┴────────────────────────────────────┐
│ HilbrasClient ── RequestPipeline ── ClientHooks                 │
│ ProviderRegistry · AdapterRegistry · ModelRouter · BudgetTracker│
│ StructuredOutput (output/) · Multi-modal surface                │
└───────────────────────────┬────────────────────────────────────┘
┌─ INFRASTRUCTURE ──────────┴────────────────────────────────────┐
│ Transport · Reliability · Security · Telemetry · Tokens · Errors│
└───────────────────────────┬────────────────────────────────────
┌─ ADAPTERS ────────────────┴────────────────────────────────────┐
│ 23 adapters; GenericOpenAIAdapter is the base for 12+ of them   │
└───────────────────────────┬────────────────────────────────────┘
                        External provider APIs
```

### Verified runtime boundaries

- **No process boundary.** The SDK is a library. The CLI (`packages/cli`) and scaffolding tool (`packages/create-hilbras-app`) are the only separate processes, and neither imports the SDK — both are self-contained (see §16).
- **Adapter boundary is the real abstraction.** Every non-chat capability is an *optional method* on `AIProvider` (`embed?`, `generateImage?`, `generateSpeech?`, `transcribe?`, `rerank?`). `HilbrasClient` feature-detects and throws `ConfigurationError` when absent. This is the cleanest boundary in the codebase.
- **Transport boundary is HTTP-shaped.** `Transport.request()` returns a full `Response`; `Transport.stream()` returns `ReadableStream<Uint8Array>`. Adapters do their own SSE parsing. There is no SSE abstraction in the transport layer.
- **Event boundary is `ClientHooks`.** A `Map<string, Set<listener>>` with try/catch swallowing listener errors. Emitted only from the client and pipeline.

### Data flow: streaming request (reconstructed)

```text
client.stream(params)
 1. resolve provider        → ProviderRegistry.getOrThrow
 2. resolve adapter         → AdapterRegistry.create(id, {provider, transport})
 3. resolvePolicy(policy)   → ResolvedPolicy (preset + field overrides)
 4. circuitBreaker.isAvailable() → CircuitBreakerOpenError if open
 5. _normalizeMessages()    → Message[]
 6. createRetryConfig()     → RetryConfig
 7. createTimeoutSignal()   → AbortSignal (parent signal linked)
 8. budgetTracker.estimate() then .reserve(requestId, est)
     → ConfigurationError if reservation refused
 9. RETRY LOOP (maxRetries+1):
      pipeline.runOnce(...) → adapter.stream(...) → AsyncGenerator<StreamChunk>
      consume chunks; accumulate usage
      success → circuitBreaker.recordSuccess(); budget.settle(); emit completed
      failure → classify(status/network) → circuitBreaker.recordFailure()
                retryable && attempts left → calculateBackoff(); sleep(); continue
10. FALLBACK LOOP (if policy.allowFallback) — try alternate candidates
11. yield StreamChunk to caller
```

### Data flow: event / observability

```text
client.emit(...) ──► ClientHooks ──► subscriber listeners
                                      ├─ DevTools            (manual wiring)
                                      ├─ StructuredLogger    (manual: instrumentClient)
                                      ├─ UsageDashboard      (manual: instrumentClient)
                                      ├─ OpenTelemetryExport (manual: instrumentClient)
                                      └─ AuditLogger         (NOT bridged to hooks at all)
```

The three telemetry consumers that expose `instrumentClient(client)` require an **explicit one-line call by the user**. They are not enabled by client construction. `AuditLogger` has no hook bridge at all.

---
### Where implementation diverges from intended design

| Intended | Actual | Evidence |
|---|---|---|
| `pipeline.ts` centralizes the reliability lifecycle | It centralizes only a *single attempt*. Retry loop + fallback loop remain in `stream()` and `complete()` | `pipeline.ts` header comment states the retry and fallback loops "stay in the client" |
| `SDKConfig` is the configuration system | `SDKConfig` is never consumed by `HilbrasClient`; `HilbrasClientConfig` is a separate overlapping type | `config/config.ts` exports `loadConfig`; `client.ts:52-72` declares its own config |
| Credentials resolve through `CredentialProvider` | Credentials are read directly off `provider.authentication` in each adapter's `_headers()` | `adapters/openai.ts:47-60`; `credentials/provider.ts` has no consumer |
| Middleware wraps the transport | `FetchTransport` never invokes middleware | `middleware/middleware.ts` defines `composeMiddlewares`; no call site |
| Degradation chain protects against payload-size errors | `withDegradation` is never called by client or adapters | `reliability/degradation.ts` |
| Telemetry observes the client automatically | Requires manual `instrumentClient()` per consumer | three separate `instrumentClient` implementations |

### Dependency direction

Intended: `Interface → Application → Core → Infrastructure`.

Observed violations:

- **Cycle:** `src/features/agent/tool-loop.ts:14` imports `from "../../index.js"` while `src/index.ts` reaches back into the client graph. Type-only, so it erases at build time, but it is a real cycle in the source graph.
- **Upward reach:** adapters depend on `reliability/normalizer.ts` (`ReasoningNormalizer`). It is consumed by every adapter but lives in the reliability layer — it belongs beside `types/streams.ts`.
- **Platform coupling:** `src/security/request-signer.ts:24` imports `node:crypto`; `src/config/config.ts:20` imports `node:fs` — despite edge-runtime claims.
- **Hidden fan-in:** `redact` from `logging/logger.ts` is imported by `errors/`, `telemetry/structured-logger.ts`, and `telemetry/body-logger.ts`. `logging` is a base utility layer, not a leaf.

---
## 3. Component Inventory

| Component | Location | Class | Public interface | Tested | Production-ready |
|---|---|---|---|---|---|
| `HilbrasClient` | `client/client.ts` (1217 L) | **Core** | `stream`/`complete`/`embed`/`generateImage`/`generateSpeech`/`transcribe`/`rerank`/`streamText`/`streamObject`/`addProvider`/`on`/`dispose` | Indirect only | Yes, with caveats |
| `RequestPipeline` | `client/pipeline.ts` (353 L) | **Core** | `runStreamAttempt`, `runCompleteAttempt`, `recordFailure` | Yes | Yes |
| `ClientHooks` | `client/hooks.ts` (69 L) | **Core** | `on`/`off`/`removeAll`/`emit`/`listenerCount` | via observability | Yes |
| `ProviderRegistry` | `providers/registry.ts` | **Core** | `add`/`remove`/`get`/`getOrThrow`/`list`/`findModel`/`clear` | Yes | Yes |
| `AdapterRegistry` | `providers/adapter-registry.ts` | **Core** | `register`/`create`/`has`/`list`/`remove`/`size` | Yes | Yes |
| `ModelRouter` | `router/model-router.ts` | **Core** | `evaluate`/`updateProviders`/`addModels` | Yes | Yes |
| `BudgetTracker` | `cost/tracker.ts` | **Core** | `estimate`/`reserve`/`settle`/`release`/`record`/`report`/`reset` | Yes (4 files) | Yes; `record()` deprecated |
| `FetchTransport` | `transport/fetch.ts` | **Core** | `request`/`stream`/`abort`/`getPoolStats` | Yes | Yes; one pool-count defect (§6) |
| `WebSocketTransport` | `transport/websocket.ts` | **Experimental** | `request`/`stream`/`abort` | No | No — needs polyfill on Node <22 |
| `OpenAIAdapter` | `adapters/openai.ts` | **Core** | `AIProvider` + embed/image/speech/transcribe | Yes | Yes |
| `AnthropicAdapter` | `adapters/anthropic.ts` | **Core** | `AIProvider` | Yes | Yes |
| `GenericOpenAIAdapter` | `adapters/openai-compatible.ts` | **Core** | `AIProvider` + embed | Yes | Yes — base for 12+ adapters |
| 21 thin adapters | `adapters/*.ts` | **Core** | wrap generic or dedicated | Yes, one file each | Yes |
| `TextToolCallParser` | `adapters/text-tool-call-parser.ts` | **Core** | internal to adapters | via adapters | Yes |
| `ReasoningNormalizer` | `reasoning/normalizer.ts` | **Core** | `feedText`/`native`/`looksLikeReasoningTag`/`reset` | via adapters | Defect present (§6) |

| `CircuitBreaker` + registry | `reliability/circuit-breaker.ts` | **Core** | `isAvailable`/`recordSuccess`/`recordFailure`/`reset`/`stats` | Yes (2 files) | Yes |
| `retry` / `backoff` / `timeout` | `reliability/*` | **Core** | pure functions | Yes | Yes |
| `resolvePolicy` | `reliability/presets.ts` | **Core** | 5 named presets | Yes | Yes |
| `createDegradationChain` | `reliability/degradation.ts` | **Dead** | `withDegradation` | Yes | Not wired |
| `validateBaseUrl` | `security/url-guard.ts` | **Core** | `validateBaseUrl` | Yes (3 files) | Yes — strongest module |
| `redactPii` / `detectPii` | `security/pii-guard.ts` | **Infrastructure** | `redactPii`/`detectPii`/`createPiiRedactor` | Yes | Implemented, unwired |
| `AuditLogger` | `security/audit-logger.ts` | **Infrastructure** | `logAuth`/`logDataAccess`/`logConfigChange`/`logSecurity`/`get*` | No direct test | Implemented, unwired |
| `RequestSigner` | `security/request-signer.ts` | **Infrastructure** | `sign`/`verify` | No direct test | Unwired; Node-only |
| `DevTools` | `devtools/index.ts` | **Interface** | `onRequestStart`/`onRequestComplete`/`getMetrics`/`export` | Yes | Implemented, unwired |
| `OpenTelemetryExporter` | `telemetry/opentelemetry.ts` | **Infrastructure** | `recordRequest`/`recordError`/`recordRetry`/`instrumentClient` | Yes | Unwired; uses `require()` |
| `StructuredLogger` | `telemetry/structured-logger.ts` | **Infrastructure** | `log`/`logRequest`/`logError`/`instrumentClient` | Yes | Unwired |
| `UsageDashboard` | `telemetry/dashboard.ts` | **Infrastructure** | `recordRequest`/`summary`/`byProvider`/`byModel` | Yes | Unwired |
| `BodyLogger` | `telemetry/body-logger.ts` | **Infrastructure** | `logRequest`/`logResponse`/`logError`/`getEntries` | Yes | Unwired |
| `SDKLogger` (`sdkLogger`) | `logging/logger.ts` | **Dead** | `setLevel`/`log`/`getEntries`/`clear` | No | Unused — only `redact` is live |
| `MCPClient` | `mcp/index.ts` | **Partial** | `connect`/`callTool`/`readResource`/`getToolsAsHilbras` | Yes (tests stub) | No — stubbed bodies |
| `RealtimeSession` | `realtime/index.ts` | **Partial** | `connect`/`sendAudio`/`sendText`/`sendToolResult`/`on`/`close` | Yes | No — OpenAI shape only |
| `ToolLoopAgent` | `features/agent/tool-loop.ts` | **Application** | `run(prompt)` | Yes | Yes |
| `ReActAgent` | `features/agent/react.ts` | **Application** | `run(prompt)` | Yes | Yes |
| `PlanAndExecuteAgent` | `features/agent/plan-and-execute.ts` | **Application** | `run(prompt)` | Yes | Yes; `replanOnFailure` advisory only |
| `evaluate` + 6 metrics | `features/eval/` | **Application** | `evaluate`, metric fns | Yes | Yes |
| `InMemoryVectorStore` | `features/rag/` | **Application** | `add`/`search`/`delete` | Yes | Yes but O(n) |
| fine-tune helpers | `features/fine-tune/` | **Application** | `exportTrainingData`/`splitData`/`validate*` | Yes | Yes — data prep only |
| 9 framework modules | `frameworks/*` | **Interface** | `useChat`/`useCompletion`/`useObject`, route handlers | 9 files | Yes; APIs not uniform |
| Middleware factories (5) | `middleware/middleware.ts` | **Dead** | `auth`/`logging`/`retry`/`rateLimit`/`cache` + `compose` | Yes | Unwired |
| `DefaultCredentialProvider` | `credentials/provider.ts` | **Dead** | `resolve`, get/set singleton | **No test** | Unwired |
| `hilbras` CLI | `packages/cli/src/cli.ts` | **Tool** | 5 commands | No test | Yes, minimal |
| `create-hilbras-app` | `packages/create-hilbras-app/` | **Tool** | CLI + `validate.ts` | Yes | Yes |

### Duplicated / overlapping components

- **Two model catalogs:** `catalog/models.ts` (`BUILTIN_MODELS`, used by `ModelRouter`) and `catalog/provider-catalog.json` (used by `loadCatalog`/`searchModels`). No synchronization mechanism exists between them.
- **Two pricing tables:** `tokens/counter.ts:166-199` (`PRICING`) and `packages/cli/src/cli.ts:64+` (`MODEL_PRICING`). Different values for the same models in some cases.
- **Two `ProviderConfig` definitions:** canonical in `config/provider-config.ts`, re-exported by `types/providers.ts`. A legacy flat-`apiKey` + `format` shape is described as removed in the file header, but older docs still reference it.
- **Three `instrumentClient` implementations:** `opentelemetry.ts`, `structured-logger.ts`, `dashboard.ts` — each independently subscribes to the same hook events with slightly different typings (`(e: any)` in dashboard).

---
## 4. Dependency Graph Analysis

### Adapter-layer note

`packages/cli/src/cli.ts` and `packages/create-hilbras-app/` **do not import `@hilbras/sdk` at all**. The CLI re-declares provider templates and pricing locally. This is intentional decoupling (no install-time SDK dependency) but it makes the CLI a *parallel* provider registry that can drift from the SDK's.

### Internal dependency edges (verified by import inspection)

```text
index.ts ──► client/client, providers/*, router/*, output/*, types/*,
             errors/*, cost/*, tokens/*, catalog/*, adapters/*, mcp/*,
             realtime/*, devtools/*, security/*, credentials/*, telemetry/*,
             middleware/*, transport/*, reliability/*, config/*

client/client.ts ──► providers/registry, providers/adapter-registry,
                     transport/fetch, reliability/{circuit-breaker,retry,
                     backoff,timeout,presets}, security/url-guard,
                     router/model-router, output/structured,
                     client/{hooks,pipeline}, cost/tracker, tokens/counter,
                     catalog/index, types/*

client/pipeline.ts ──► reliability/{presets,circuit-breaker,retry,timeout},
                       cost/tracker, tokens/counter, errors/*

adapters/*.ts ──► transport/transport (type), reasoning/normalizer,
                  types/*, errors/*, adapters/text-tool-call-parser
                  (no adapter imports the client — inversion is correct)

telemetry/* ──► logging/logger (redact), types/observability
security/{pii,audit} ──► logging/logger (redact)
errors/index ──► logging/logger (redact)
```

### Findings

| # | Finding | Priority | Confidence |
|---|---|---|---|
| D1 | `features/agent/tool-loop.ts` imports the root barrel, creating a source-graph cycle | P3 | Confirmed |
| D2 | `ReasoningNormalizer` lives in `reliability/` but is a `types/streams` concern consumed by every adapter — misplaced layer | P3 | Confirmed |
| D3 | `security/request-signer.ts` (`node:crypto`) and `config/config.ts` (`node:fs`) break advertised edge/browser portability of the barrel, since `index.ts` re-exports both | P2 | Confirmed |
| D4 | `redact` from `logging/` is a hidden hub dependency of `errors/` and two `telemetry/` modules — `logging` is not a leaf | P3 | Confirmed |
| D5 | `HilbrasClient.streamText` builds tool-result messages itself rather than reusing a helper — orchestration knowledge duplicated in the client | P2 | Confirmed |
| D6 | `catalog/models.ts` and `catalog/provider-catalog.json` are unreconciled parallel sources of truth | P2 | Confirmed |
| D7 | CLI maintains a parallel provider/pricing registry independent of the SDK | P3 | Confirmed |

### Cycle detail (D1)

```typescript
// src/features/agent/tool-loop.ts:14
import type { HilbrasClient, Tool } from "../../index.js";
```

Because it is `import type`, TypeScript erases it — there is no runtime cycle. But the agent feature is not independently consumable and build-order reasoning becomes fragile. Fix: import from `../../client/client.js` directly.

---
## 5. Code Flow and Execution Analysis

### Startup / initialization

```text
new HilbrasClient(config?)
 ├─ this._registry   = new ProviderRegistry()          // always new
 ├─ this._adapters   = new AdapterRegistry()           // from config or getDefaultAdapterRegistry()
 ├─ this._transport  = config.transport ?? new FetchTransport()
 ├─ this._budget     = new BudgetTracker(config.budget)
 ├─ this._hooks      = new ClientHooks()
 └─ this._router     = new ModelRouter()

FetchTransport constructor:
 └─ if (typeof setInterval !== "undefined")
      setInterval(() => this._cleanupPools(), this._idleTimeout)   // never cleared
```

### Multi-modal flow (`_runMultiModal`)

```text
client.embed / generateImage / generateSpeech / transcribe / rerank
 └─ _getAdapter(provider) → feature-detect (adapter.embed != null, etc.)
 └─ _runMultiModal(requestId, provider, model, phase, fn, userSignal)
      ├─ estimate cost
      ├─ reserve budget
      ├─ await fn(timeoutSignal)
      ├─ settle / release
      └─ emit request.completed / request.failed
```

### High-level flows

- **`streamText`** (`client.ts:1011-1132`): iterative `stream()` calls with tool execution between steps. Tool-call IDs are synthesized as ``call_${step}_${i}``; the matching tool-result message uses ``call_${step}_${toolCalls.indexOf(tc)}``. The two formulas agree today but are computed independently and would silently diverge if the array were filtered or reordered. **P3, Confirmed.**
- **`streamObject`** (`client.ts:1151-1204`): injects a JSON system instruction, forces `response_format: {type:"json_object"}`, then does best-effort partial-JSON extraction (`/\{[\s\S]*$/` plus a `+ "}"` retry) and yields `{}` when parsing fails. It **bypasses `validateOutput`/`processStructuredOutput` entirely** — no schema validation, no auto-repair, no `ValidationError`. **P1, Confirmed.**
- **`dispose()`** (`client.ts:1208-1212`): clears adapters and registry and aborts transport. It does **not** remove hook listeners, does **not** clear the transport interval, and does **not** reset the global circuit-breaker registry.

### Unreached / under-reached logic

| Logic | Status | Evidence |
|---|---|---|
| `withDegradation` | Never called anywhere | `reliability/degradation.ts` |
| `middleware/*` (5 factories) | Never called | `middleware/middleware.ts` |
| `credentials/provider.ts` | Never called | no import site |
| `sdkLogger.log(...)` | Never called | `logging/logger.ts` |
| `AuditLogger.logAccount*` | Never called | `security/audit-logger.ts` |
| `RequestSigner` / `signingMiddleware` | Never called | `security/request-signer.ts` |
| Telemetry `instrumentClient` | Only if user calls it | 3 modules |
| `MCPClient` real protocol | Not implemented | `mcp/index.ts` |

---
## 6. Bug Detection

### BUG-01 — Environment-variable API key is redacted before being stored (P0)

```
Finding:       Provider API keys loaded from HILBRAS_PROVIDER_KEY are replaced
               with the literal string "[REDACTED]" before being placed into the
               provider's authentication field, making the provider unusable.
Location:      src/config/config.ts:79
Category:      Correctness / configuration
Priority:      P0 — Critical
Evidence:      config.providers = [{
                 name: providerName || "default",
                 baseUrl: providerUrl,
                 authentication: { type: "bearer", apiKey: redact(providerKey) },
                 models: [],
                 adapter: inferredAdapter,
                 allowInsecure: providerUrl.startsWith("http://"),
               }];
               `redact` (src/logging/logger.ts:41) is a log-sanitisation helper
               that replaces secrets with "[REDACTED]".
Why it matters: `redact` is designed for OUTPUT sanitisation, not credential
               storage. Applying it here discards the real key.
Failure:       Export HILBRAS_PROVIDER_URL + HILBRAS_PROVIDER_KEY, call
               loadConfig(), build a client, issue any request → the adapter
               sends `Authorization: Bearer [REDACTED]` and receives HTTP 401.
Impact:        The documented zero-code env-var configuration path is
               non-functional for every authenticated provider.
Recommended:   Store the raw key and redact only at log/emit sites:
               authentication: { type: "bearer", apiKey: providerKey }
Confidence:    Confirmed (static code path). Runtime reproduction not performed
               in this audit — see Limitations.
```

### BUG-02 — ReasoningNormalizer leaks accumulated text across chunks (P1)

```
Finding:       feedText() returns null for non-reasoning text but never clears
               its buffer, so unrelated text accumulates and can later be
               misclassified as reasoning.
Location:      src/reasoning/normalizer.ts:27-56
Category:      Correctness / streaming
Priority:      P1 — High
Evidence:      feedText(text) {
                 this._buffer += text;
                 if (!this._inTag) {
                   for (const pat of TAG_PATTERNS) {
                     if (pat.test(this._buffer)) { /* ...sets _inTag... */ }
                   }
                   return null;        // <-- buffer NOT cleared
                 }
                 if (/<\/(?:thinking|reasoning|reason)>/i.test(this._buffer)) { ... }
                 return { type: "reasoning", text: this._buffer };
               }
Why it matters: The buffer is only reset on tag entry/exit or via reset().
               Plain chunks keep appending. A later chunk containing a
               tag-opening sequence is tested against the ENTIRE buffer, so
               preceding user-visible text is stripped and re-emitted as
               reasoning.
Failure:       Chunk 1 = "Hello " → buffer = "Hello ", returns null.
               Chunk 2 = "<thinking>" → buffer = "Hello <thinking>" matches
               TAG_PATTERNS[0]; buffer becomes "Hello "; function returns
               { type: "reasoning", text: "Hello " }.
Impact:        Content loss and misrouted content in any stream mixing prose
               with reasoning tags. Adapters build one normalizer per adapter
               instance (not per request), so buffered state also persists
               across successive requests on a reused adapter.
Recommended:   On a non-match outside a tag, clear the buffer (or hand the
               buffered text back so the caller yields it as text). Scope the
               tag test to the incoming fragment, and call reset() at the start
               of each stream() call.
Confidence:    Confirmed (static); the misclassification follows directly from
               the control flow.
```

---
### BUG-03 — FetchTransport double-releases connection slots on error (P2)

```
Finding:       request() releases the acquired connection slot both in the inner
               requestFn finally block and again in the outer catch.
Location:      src/transport/fetch.ts:114-148
Category:      Concurrency / resource accounting
Priority:      P2 — Medium
Evidence:      const requestFn = async (): Promise<Response> => {
                 try { ... return await fetch(...); }
                 finally {
                   this._controllers.delete(controller);
                   this._release(origin);            // release #1
                 }
               };
               try {
                 const promise = requestFn();
                 ...
                 return await promise;
               } catch (error) {
                 this._release(origin);              // release #2
                 throw error;
               }
Why it matters: _release decrements entry.count and deletes the pool entry once
               count <= 0. A network failure runs the finally (decrement) and then
               the catch (decrement again), driving count below zero or evicting a
               pool entry other in-flight requests still hold.
Failure:        Two concurrent requests to one origin; one fails with a network
               error → its slot is released twice → the pool forgets one live
               request → the 6-per-origin cap is effectively exceeded.
Impact:        Connection accounting drifts; the documented per-origin cap is not
               reliably enforced under failure.
Recommended:   Drop the release in the outer catch. The inner finally already
               guarantees exactly one release on every path.
Confidence:    Confirmed (static); impact depends on failure frequency.
```

### BUG-04 — `streamObject` bypasses schema validation and auto-repair (P1)

```
Finding:       streamObject performs ad-hoc partial-JSON parsing and never
               invokes the structured-output validation/repair pipeline.
Location:      src/client/client.ts:1151-1204 (vs src/output/structured.ts)
Category:      Correctness / API contract
Priority:      P1 — High
Evidence:      const partial = JSON.parse(accumulatedText);      // best effort
               ...
               const match = accumulatedText.match(/\{[\s\S]*$/);
               const partial = JSON.parse(match[0] + "}");        // guesswork
               ...
               yield { type: "object_delta", partialObject: {} as Partial<T> };
               The signature advertises `schema: Record<string, unknown>` but the
               schema is only stringified into a system instruction; it is never
               used for validation. validateOutput/processStructuredOutput are
               not imported by streamObject.
Why it matters: The method is named and documented as "structured output" but
               provides none of the module's guarantees (validation, ValidationError,
               maxRepairAttempts, repair prompts). Callers receive empty `{}`
               partials with no signal that parsing failed.
Failure:        Model returns prose or malformed JSON → stream yields
               { partialObject: {} } repeatedly and resolves with no error.
Impact:        Silent incorrect results; the documented structured-output
               contract does not hold for the streaming path.
Recommended:   Route streamObject through extractJson + schema validation, emit a
               ValidationError (or a typed error chunk) on failure, and honour
               StructuredOutputConfig. Align the `schema` parameter type with
               SchemaValidator<T>.
Confidence:    Confirmed (static).
```

### BUG-05 — `setTokenizer` is a process-global mutable override (P2)

```
Finding:       A single module-level slot holds the active tokenizer for the
               entire process, with no per-client scoping.
Location:      src/tokens/counter.ts:24, 37-39
Category:      Concurrency / multi-tenancy
Priority:      P2 — Medium
Evidence:      let _customTokenizer: Tokenizer | null = null;
               export function setTokenizer(tokenizer: Tokenizer | null) {
                 _customTokenizer = tokenizer;
               }
Why it matters: Budget estimation and router cost scoring both flow through
               estimateTokens. In a multi-tenant server, one tenant calling
               setTokenizer changes token accounting for every other tenant and
               every other HilbrasClient in the process.
Failure:        Tenant A sets a tiktoken-based tokenizer → Tenant B's budget
               reservations silently change basis mid-flight.
Impact:        Cross-tenant interference in budget enforcement; non-deterministic
               cost estimates.
Recommended:   Allow a tokenizer on HilbrasClientConfig / BudgetTracker, keeping
               the global as an explicit process-wide default only.
Confidence:    Confirmed (static).
```

---
### BUG-06 — `FetchTransport` interval is never cleared (P2)

```
Finding:       The constructor starts a setInterval for pool cleanup, but no
               dispose()/clearInterval path exists, and HilbrasClient.dispose()
               does not clear it.
Location:      src/transport/fetch.ts:41-45; src/client/client.ts:1208-1212
Category:      Resource leak
Priority:      P2 — Medium
Evidence:      if (typeof setInterval !== "undefined") {
                 setInterval(() => this._cleanupPools(), this._idleTimeout);
               }                                    // handle discarded
               async dispose(): Promise<void> {
                 this._transport.abort();            // abort() does not clear timers
                 this._adapters.clear();
                 this._registry.clear();
               }
Why it matters: Every FetchTransport instance leaves a permanent timer. Each
               timer keeps a closure over the transport, preventing GC even after
               dispose(). In test suites or serverless cold/warm cycles that
               construct many clients, timers accumulate.
Failure:        Construct 1,000 clients over the process lifetime → 1,000 live
               intervals, each holding a reference to a transport and its pools.
Impact:        Memory retention and steady background CPU wakeups; in Node this
               also keeps the event loop alive and can prevent clean process exit.
Recommended:   Store the timer handle and clear it in abort()/a new dispose(),
               and call that from HilbrasClient.dispose().
Confidence:    Confirmed (static).
```

### BUG-07 — Circuit-breaker half-open counter can go negative in stats (P3)

```
Finding:       recordFailure() decrements _halfOpenCalls and transitions to
               "open"; the "open" transition does not reset the counter.
Location:      src/reliability/circuit-breaker.ts:101-132
Category:      State consistency / observability
Priority:      P3 — Low
Evidence:      if (this._state === "half_open") {
                 this._halfOpenCalls--;        // can go negative
                 this._transitionTo("open");
               }
               ...
               private _transitionTo(state) {
                 if (state === "closed")       { ...; this._halfOpenCalls = 0; }
                 else if (state === "half_open") { this._successCount = 0;
                                                   this._halfOpenCalls = 0; }
                 // "open" resets nothing
               }
Why it matters: The counter is reset on the next entry to half_open, so the
               impact is bounded to the window between the failure and the next
               probe. However, isAvailable() correctly uses the same counter, and
               a negative value during that window means any concurrent probe is
               admitted. Stats reporting shows the negative value.
Failure:        Half-open with halfOpenMaxCalls=1: probe fails → counter 1→0,
               state "open". Concurrent caller observes isAvailable() while the
               breaker is open only if the timeout has elapsed.
Impact:        Cosmetic stats inaccuracy; narrow window of extra admission.
Recommended:   Reset _halfOpenCalls in the "open" transition (or clamp at zero).
Confidence:    Confirmed as a state inconsistency; real-world impact assessed Low.
```

### BUG-08 — Duplicate requestId silently rejected as "budget exceeded" (P3)

```
Finding:       reserve() returns null for a duplicate requestId, and callers
               surface that as a budget error, not an ID collision.
Location:      src/cost/tracker.ts:81; src/client/pipeline.ts (reserve consumers)
Category:      Error reporting
Priority:      P3 — Low
Evidence:      if (this._reservations.has(requestId)) return null;   // tracker.ts
               if (!initialReservation) {
                 throw new ConfigurationError(
                   `Budget reservation rejected — estimated cost $... would exceed budget`);
               }
Why it matters: Two distinct causes (budget refusal, duplicate id) collapse into
               one misleading message. Debugging a duplicate-id bug leads the
               developer to inspect budgets instead of ID generation.
Impact:        Misleading diagnostics; no functional data corruption.
Recommended:   Return a discriminated result ({ ok:false, reason:"duplicate_id" |
               "budget_exceeded" }) or throw a distinct error.
Confidence:    Confirmed (static).
```

### BUG-09 — `extractJson` may return the raw non-JSON text (P3)

```
Finding:       When no balanced JSON substring parses, extractJson returns the
               entire original text rather than signalling failure.
Location:      src/output/structured.ts:127-141
Category:      Error handling
Priority:      P3 — Low
Evidence:      for (let end = start + 1; end < text.length; end++) { ... }
               return text;   // no JSON found — returns prose/partial markdown
Why it matters: The caller (validateOutput) then runs JSON.parse on arbitrary
               prose, producing a parse error whose message may be less
               actionable than a direct "no JSON found" signal. The inline
               comment claims this yields a clearer error; that is asserted, not
               demonstrated.
Impact:        Poorer diagnostics only; validateOutput still throws ValidationError.
Recommended:   Return null/throw a typed "no JSON found" so validateOutput can
               report a specific reason.
Confidence:    Confirmed (static).
```

---
## 7. Dead Code Analysis

Two categories must be separated here, because conflating them is the most common false positive in audits of this shape.

**Category A — genuinely dead (no consumer anywhere, including tests and docs examples):**

| Item | Location | Verdict |
|---|---|---|
| `sdkLogger` | `logging/logger.ts:95` | **Definitely dead.** Imported at `client.ts:29` but never invoked. No test references it. |
| `chunk` factory object | `types/streams.ts:67-78` | **Definitely dead internally.** Re-exported by `index.ts:20`; zero call sites in `src/`. Published API surface, but no documented usage. |
| `createDegradationChain` / `withDegradation` | `reliability/degradation.ts` | **Definitely dead.** Tested, never called by client or adapters. |
| 5 identical `*AdapterConfig` aliases | `adapters/{openai,anthropic,google-genai,groq,ollama}.ts` | **Duplicate/noise.** All equal `AdapterConfig`. Only `AzureAdapterConfig` is structurally distinct. |
| `AuthAuditEntry.logAccount*` accessors | `security/audit-logger.ts` | **Dead by absence of consumer** — the whole AuditLogger has no runtime user. |

**Category B — exported-but-unwired public API (intentional surface, zero internal consumers).** These are *not* dead in the "should be deleted" sense; they are components that were built and shipped but never integrated. That distinction is the finding:

`credentials/provider.ts` · `middleware/middleware.ts` · `devtools/index.ts` · `telemetry/opentelemetry.ts` · `telemetry/structured-logger.ts` · `telemetry/dashboard.ts` · `telemetry/body-logger.ts` · `security/pii-guard.ts` · `security/audit-logger.ts` · `security/request-signer.ts` · `transport/websocket.ts` · `mcp/index.ts` · `realtime/index.ts`

**Dynamic-loading check (rule 7).** Before declaring the above unused, the following dynamic mechanisms were searched:

- `src/telemetry/opentelemetry.ts:70` uses `require("@opentelemetry/api")` — a *third-party* dynamic load, not a loader for SDK modules. No SDK module is loaded dynamically anywhere in `src/`.
- The only registry-driven loading is `AdapterRegistry.create(id)` (`providers/adapter-registry.ts:57`), which dispatches to a **statically imported** factory map. All 23 adapters are statically imported at `adapter-registry.ts:15-37`.
- `package.json` declares a large `exports` map (~40 subpaths). Subpath consumers outside this repo cannot be verified statically. **Therefore every Category B entry is marked "no *in-repo* consumer", not "unused" — external consumers are Unverified.**

**Registry check (rule 8) — the 23 adapters:** all 23 are registered in `getDefaultAdapterRegistry()` and reachable via the `adapter` field of `ProviderConfig`. None are dead. The `AdapterName` union in `types/providers.ts:20-26` and the registry keys in `adapter-registry.ts:100-124` agree, verified entry by entry.

---

## 8. Incomplete and Partially Implemented Features

| Feature | Location | What exists | What is missing |
|---|---|---|---|
| **MCP client** | `mcp/index.ts` | Types, connection map, `getToolsAsHilbras()` name-prefixing | `connect()` sets `connected:true` without any transport; `callTool()` returns `` { result: `Called ${toolName} on ${serverName}` } ``; `readResource()` returns `{ contents: [{ uri, text: "" }] }`. No JSON-RPC, no stdio/SSE transport, despite `MCPServerConfig` advertising `transport: "stdio" \| "sse"`, `command`, `args`, `url`. |
| **Realtime session** | `realtime/index.ts` | WebSocket open/send/close, OpenAI event mapping | `_getBaseUrl()` returns Google and xAI URLs but `_handleMessage()` only understands OpenAI event names. No reconnection. `connect()` resolves via a 50 ms polling interval with no timeout — if the socket never opens, the promise never settles/rejects. |
| **RAG** | `features/rag/` | `InMemoryVectorStore`, chunker, retriever, pipeline | Only an in-memory, unindexed store. No persistence, no external vector DB adapter, no ANN index. |
| **Fine-tune** | `features/fine-tune/` | 6 export formats, split, quality validation | No provider API integration — it is a data-prep utility only. Docs describe it as a "fine-tuning" feature. |
| **`streamObject`** | `client.ts:1151-1204` | Partial-JSON streaming | No schema validation, no repair (BUG-04). |
| **CLI `provider add`** | `packages/cli/src/cli.ts` | Writes config entry | No validation, no connectivity check, no key prompt. `doctor` only checks `process.env` presence. |
| **`PlanAndExecuteAgent.replanOnFailure`** | `features/agent/plan-and-execute.ts:196-201` | Pushes a message into `execMessages` | No actual re-planning call. The flag's documented behavior ("re-plan after a failed step") is not implemented; the pushed message is appended but the plan array is never recomputed. |
| **`addProviderFromCatalog`** | `client/client.ts` | Delegates to catalog | Depends on `provider-catalog.json`, which is a second source of truth unreconciled with `BUILTIN_MODELS` (D6). |

**No `TODO`/`FIXME`/`XXX` markers exist in `src/` or `tests/`** — verified by regex sweep. The incompleteness is therefore *undocumented in code*, which is precisely why the docs-vs-reality gap (§20) matters. One stray "placeholder" comment exists at `frameworks/nextjs/server.ts:74-75` ("In a real implementation, this would use the actual SDK client / For now, return a placeholder that demonstrates the API").

---
## 9. API and Contract Analysis

### Confirmed contract mismatches

| # | Mismatch | Evidence | Priority |
|---|---|---|---|
| A1 | `streamObject` is typed and documented as structured output but performs no validation | `client.ts:1151` (`schema: Record<string, unknown>`) vs `types/schema.ts` (`SchemaValidator<T>`) | P1 |
| A2 | `Message.content` is `string \| ContentPart[] \| null`, but `AnthropicAdapter._buildBody` concatenates it as a string | `adapters/anthropic.ts:64` — `systemPrompt += (systemPrompt ? "\n\n" : "") + m.content`. Array content yields `[object Object]` rather than `extractText()` output. | P1 |
| A3 | `AnthropicAdapter` forwards tool messages verbatim, but Anthropic has no `tool` role and requires `tool_use` / `tool_result` content blocks | `adapters/anthropic.ts:78-81` emits `{role: m.role, content: m.content}` for every non-system message, so a `role:"tool"` message with `tool_call_id` is sent as-is. Meanwhile lines 84-90 *do* translate tool *definitions* to `input_schema`. Tool loops through this adapter are therefore asymmetric: definitions are converted, results are not. | P1 |
| A4 | `checkHostSafety` returns the sentinel string `"private"` and the caller compares it by value | `security/url-guard.ts:155-168` returns `"private"`; line 222 tests `danger === "private"`. A value-vs-type conflation (a discriminated result would be safer). | P3 |
| A5 | Three `instrumentClient` signatures disagree | `telemetry/opentelemetry.ts:212` (`(e: HookEvent) => void`), `telemetry/structured-logger.ts:197` (same), `telemetry/dashboard.ts:208` (`(e: any) => void`) | P3 |
| A6 | Framework hooks re-declare option types instead of sharing one contract | `types/ui-protocol.ts` defines `UseChatOptions`/`UseChatState`/`UseChatActions`, but each of the 9 `frameworks/*` modules defines shape-specific variants | P2 |

### Frontend  protocol ⇄ backend expectation

```text
UIProtocolMessage              (types/ui-protocol.ts:48-56)
  ↓ expected by
frameworks/*/use-chat.ts        (per-framework stream parser)
  ↓ fed by
Next.js / Astro / Remix route handlers
  (frameworks/nextjs/route-handlers.ts, frameworks/astro/endpoints.ts,
   frameworks/remix/actions.ts)
  ↓ should call
HilbrasClient.stream()
  ↓
Adapter
```

The protocol itself is well-defined (`message_start`, `text_delta`, `reasoning_delta`, `tool_call_start|delta|end`, `message_end`, `error`) and `utils/sse-writer.ts` exists to emit it. The concrete gap found: `frameworks/nextjs/server.ts:74-75` carries an explicit comment —

```
// In a real implementation, this would use the actual SDK client
// For now, return a placeholder that demonstrates the API
```

— so at least one server-side integration is a demonstration stub. **Unverified:** whether the other route handlers construct a real client, since that flows through consumer code outside this repository. Verifying it would require inspecting a downstream app or the `showcase/` apps end to end.

---
## 10. Security Audit

### Confirmed strengths

`security/url-guard.ts` is the strongest module in the repository. It was read in full and it does what its header claims:

- Rejects every non-`http(s)` scheme (`file:`, `data:`, `blob:`, `javascript:`, `ws:`), lines 198-203.
- Requires explicit opt-in for `http://` via `allowInsecure`, lines 206-211.
- Allows loopback / `*.local` unconditionally, lines 216-218.
- Blocks link-local `169.254.0.0/16` **even when `allowInsecure` is set** — closing the cloud-metadata hole, lines 149-152.
- Gates RFC1918 ranges behind a *separate* `allowPrivateNetwork` flag, lines 222-230.
- Normalises hex / octal / decimal IP obfuscation before checking, lines 42-89.
- Applies hostname safety checks to **both** http and https, documented at lines 11-14 and implemented at 220-233.
- Declares DNS-rebinding **out of scope** rather than implying coverage, lines 20-21.

`ProviderRequestError` redacts the body before storing *and* before rendering the message (`errors/index.ts:45-49`), closing the "README tells you to `console.error(err.body)`" leak path. The comment states this rationale explicitly.

### Confirmed vulnerability / trust-boundary gap

**SEC-01 — `RealtimeSession` WebSocket URLs bypass the SSRF guard.**

```
Finding:       RealtimeSession builds a WebSocket URL from unvalidated config with
               no call to validateBaseUrl (and no ws/wss-aware equivalent).
Location:      src/realtime/index.ts:48-49, 114-121
Category:      Trust boundary / SSRF
Priority:      P2 — Medium
Evidence:      const baseUrl = this._config.baseUrl ?? this._getBaseUrl();
               this._ws = new WebSocket(`${baseUrl}?model=${this._config.model}`);
               When config.baseUrl is supplied it is used verbatim. validateBaseUrl
               is imported only by client/client.ts, config/config.ts and
               security/index.ts — never by realtime/.
Why it matters: Every other outbound URL in the SDK passes a guard; this one does
               not. The existing guard cannot be reused as-is because it rejects
               ws:/wss: schemes outright, so the two subsystems are unreconciled.
Failure:        A caller who derives baseUrl from untrusted input (e.g. a tenant
               config or a URL parameter) can direct the socket at an arbitrary host.
Impact:        Outbound connection to an attacker-chosen or internal endpoint,
               bypassing the SDK's stated SSRF posture.
Recommended:   Add a WebSocket-aware validation path (allow ws/wss, reuse the
               private-range and link-local checks) and call it in connect().
Confidence:    Confirmed (static).
```

### Re-examined and downgraded (avoiding a false positive)

**SEC-02 — `HILBRAS_PROVIDER_URL` is passed `allowInsecure: true` unconditionally.**
`config/config.ts:63-83` calls the guard with `allowInsecure: true` for the env-supplied URL. A shallow read concludes "panic". Tracing it through the guard: `allowPrivateNetwork` is **not** passed, so RFC1918 hosts still hit the `danger === "private"` branch and are rejected (lines 222-230), and link-local is blocked unconditionally (149-152). The guard holds. This is a **hardening note, not a vulnerability** — the unconditional `allowInsecure` is broader than the stated intent. **Priority P3. Confidence: Confirmed.**

### Potential risks

| Risk | Location | Assessment |
|---|---|---|
| `require("@opentelemetry/api")` | `telemetry/opentelemetry.ts:70` | Loads third-party code on the module path; breaks under strict ESM. **P2.** Prefer lazy `await import()` behind an opt-in. |
| `node:crypto` and `node:fs` inside barrel-exported modules | `security/request-signer.ts:24`, `config/config.ts:20` | Contradicts the edge/browser portability claim because `index.ts` re-exports both. **P2.** |
| `eval()` in a JSDoc example | `types/tool-builder.ts:69` | Documentation only, not executable. **P3.** |
| Key-shaped literals in tests | `tests/*` | Placeholders (`sk-test…`, `hf_xxxxxxxxxxxx`). Notably the `redact` patterns *do* match them, which is evidence the patterns work. **Not a finding.** |
| Secrets in error bodies | `errors/index.ts:45-49` | Already mitigated by redaction. **Not a finding.** |

### Hardening recommendations

1. Add a WebSocket-aware URL guard and use it in `RealtimeSession.connect()`.
2. Replace `require()` with lazy `await import()` in the OTel exporter.
3. Move Node-only modules out of the root barrel (or behind subpath exports) so `index.ts` stays runtime-neutral.
4. Wire `redactPii` into the logging/telemetry path — implemented, tested, unused.

---
## 11. Performance Analysis

No benchmark numbers are asserted here. The `benchmarks/` directory and `tests/benchmarks/performance.bench.ts` exist; running them would be required to quantify anything. What follows is static structural analysis.

| # | Issue | Location | Bottleneck / impact |
|---|---|---|---|
| P1 | RAG retrieval is a linear scan | `features/rag/in-memory-store.ts` | O(n) per search over every stored vector. Growth is linear in corpus size; no index, no ANN. **Future scalability risk** rather than a current problem. |
| P2 | Router scores every catalog entry on every decision | `router/model-router.ts:74-83` + `BUILTIN_MODELS` (~180 entries) | O(models) per routing call, with `_estimateCost` per entry. ~180 iterations is trivial today; grows linearly with the catalog. |
| P3 | `estimateTokens` is a per-character loop | `tokens/counter.ts:69-79` | Six counters incremented per character, plus a division-based recomputation. Called from budget estimation and router scoring. For large prompts this is the hot path. A single regex/tally pass would be materially cheaper. |
| P4 | `FetchTransport` polls for a connection slot | `transport/fetch.ts:106-108` | `while (!this._acquire(origin)) await sleep(10)` — a 10 ms spin. Under saturation this adds up to 10 ms latency granularity per wait and wakes the event loop repeatedly instead of using a queue + signal. |
| P5 | Duplicate catalog data | `catalog/models.ts` + `catalog/provider-catalog.json` | Both are bundled; the JSON is parsed at module load. Duplication inflates bundle size and risks drift. |
| P6 | 23 adapters statically imported into the registry | `providers/adapter-registry.ts:15-37` | Importing `@hilbras/sdk` root pulls in every adapter, including heavy ones (bedrock, vertex). Subpath exports exist, but the barrel is not tree-shakeable for consumers who import root. The package ships a `check-size.mjs` tool, suggesting the authors are aware. |
| P7 | `UsageDashboard.byProvider()` / `byModel()` rebuild Maps and re-sort per call | `telemetry/dashboard.ts:143-200` | O(n log n) per query over up to `maxRecords` (default 10,000) records, with no memoisation. Repeated dashboard polling is O(n log n) each time. Unwired, so currently dormant. |
| P8 | `setInterval` per transport | `transport/fetch.ts:42-44` | Steady background wakeups per client instance (see BUG-06). |

**Current vs future.** P1, P2, P5, P6 are future/structural. P3, P4, P8 are present-day but low-magnitude. Nothing here suggests a rewrite; P1 and P3 are the two that would change behaviour at scale.

---

## 12. Reliability and Failure Analysis

| Scenario | Observed behaviour | Assessment |
|---|---|---|
| Network failure | Retried if `retryableNetworkErrors`; classified via `shouldRetryNetworkError` | Correct and configurable |
| 429 / 500 / 502 / 503 / 504 | Retried with exponential backoff + jitter | Correct |
| 400 / 401 / 403 / 404 | Not retried | Correct |
| Circuit open | `CircuitBreakerOpenError` thrown before any request | Correct |
| Budget exhausted | `ConfigurationError` thrown before request | Correct, but see BUG-08 (message conflation) |
| Provider / model missing | Typed `ProviderNotFoundError` / `ModelNotFoundError` | Correct |
| Structured output invalid | Repair loop, then `ValidationError` | Correct — **but only on the non-streaming path** (BUG-04 excludes `streamObject`) |
| Stream interrupted | Error propagates; budget reservation released in `finally` | Correct — `pipeline.ts:252-266` releases in both `catch` and `finally`, guarded by an `reservationActive` flag |
| Timeout | `createTimeoutSignal` aborts and clears its timer | Correct — parent signal linked, `{once:true}` on both listeners |
| WebSocket drop | `disconnected` event emitted | No reconnection; caller must reconnect |
| `connect()` never opens | Promise from `RealtimeSession.connect()` polls `_connected` forever | **Reliability defect:** no timeout, no rejection. If the socket fails silently the awaiting caller hangs indefinitely. |
| Provider processed a request that then timed out | Retry re-sends the POST | No idempotency key. Duplicate execution is possible for non-idempotent provider operations. |

**Unbounded work.** The `cheap` and `maximum` presets permit `maxRetries: 10` with `maxDelayMs` up to 120,000 ms (`reliability/presets.ts:59-76`). Worst-case single-request wall time is therefore very large. This is documented behaviour, not a bug, but it is a retry-storm surface if many requests fail simultaneously — there is no global concurrency gate or jitter-beyond-backoff coordination across requests.

---
## 13. Testing Audit

**No coverage percentage is stated.** Coverage data was not produced (`npm run test:coverage` was not executed — it would write artifacts). What follows is a structural audit of *what is tested*, derived from the file inventory and by reading representative test files.

### Shape of the suite

- 68 test files in `tests/`, flat (no mirroring of `src/` structure except `tests/security/`, `tests/client/`, `tests/transport/`, `tests/tools/`).
- One test file per adapter (e.g. `openai-adapter.test.ts`, `anthropic-adapter.test.ts`, … ~18 of them).
- Four dedicated cost/budget files: `reservation-budget`, `reservation-audit`, `cost-audit`, `financial-integrity`.
- Three security files plus `security-hardening.test.ts`.
- Framework tests: one per framework (react/vue/svelte/solid/qwik/angular/nextjs/astro/remix).
- Type-level tests in `tests/types.test-d.ts`.
- Benchmark file: `tests/benchmarks/performance.bench.ts`.
- Historical audit files by name: `v0.7.1-deep-audit.test.ts`, `production-audit.test.ts`, `execution-pipeline-audit.test.ts`, `circuit-breaker-audit.test.ts`.

### Well-covered

`security/url-guard.ts` (3 files), `cost/tracker.ts` (4 files), `reliability/circuit-breaker.ts` (2 files), `client/pipeline.ts` (dedicated file), each adapter in isolation, `router`, `tokens`, `tool-builder`, `structured-output`, `config`, `policy`, `middleware`, `degradation`, `agent`, `eval`, `rag`, `fine-tune`, `multi-modal`, `mcp`, `realtime`, `telemetry`, framework hooks.

### Critical untested paths

| Untested | Why it matters |
|---|---|
| `HilbrasClient.stream()` | The primary entry point. Tested only *indirectly* through `pipeline.ts`. The retry loop, fallback loop, budget reserve/settle orchestration, and event emission inside `stream()` are not directly exercised. |
| `HilbrasClient.complete()` | Same as above. |
| Fallback loop | `policy.allowFallback` behaviour has no dedicated test that was found. Fallback is a headline feature (`production`/`fast`/`cheap`/`maximum` presets all set `allowFallback: true`). |
| `streamText()` | Multi-step tool calling has no test file. |
| `streamObject()` | No test. This is the method carrying BUG-04. |
| `dispose()` | No test that cleanup actually releases resources. |
| `credentials/provider.ts` | **Zero tests** — the only `src/` module with no coverage at all. |
| Concurrent budget reservations | The atomicity claim in `cost/tracker.ts:73-75` ("synchronous — no await between check and reserve") is asserted in a comment; no test drives concurrent reserve/settle interleavings. |
| `ReasoningNormalizer` multi-chunk sequences | Tests cover adapter streams, but no test asserts that prose followed by a reasoning tag stays as prose — exactly the BUG-02 case. |

### Test-quality observations

- Mock `Transport` implementations across adapter tests use `async stream() { throw new Error("unused"); }` — fine, but it means `Transport.stream()` is exercised in very few places.
- Test files named `*-audit.test.ts` appear to encode past audit findings as regression tests. That is a genuine strength: the six v0.9.3 P0 fixes are presumably pinned. It also means the file names carry history and should not be cleaned up.
- **Unverified:** whether any test actually runs a full `stream()` against a mocked transport end to end. Stating this as a gap requires reading every client-level test; the absence of a `client.test.ts` is strong evidence but not proof.

---

## 14. Configuration and Environment Analysis

### Layering (as implemented)

```text
DEFAULT_CONFIG  →  file config  →  environment variables  →  runtime overrides
   (schema.ts)     (if path given)      (HILBRAS_*)          (loadConfig overrides)
```

`deepMerge` merges plain objects recursively; arrays are replaced wholesale, `undefined` values are skipped.

### Environment variables consumed

`HILBRAS_DEFAULT_PROVIDER`, `HILBRAS_DEFAULT_MODEL`, `HILBRAS_TEMPERATURE`, `HILBRAS_MAX_TOKENS`, `HILBRAS_STREAM`, `HILBRAS_LOG_LEVEL`, `HILBRAS_TIMEOUT`, `HILBRAS_MAX_RETRIES`, `HILBRAS_PROMPT_CACHING`, plus the provider triple `HILBRAS_PROVIDER_URL` / `HILBRAS_PROVIDER_KEY` / `HILBRAS_PROVIDER_NAME`.

### Findings

| # | Finding | Priority | Confidence |
|---|---|---|---|
| C1 | `HILBRAS_PROVIDER_KEY` is redacted before storage (BUG-01) | P0 | Confirmed |
| C2 | `loadFromFile` swallows every error and returns `{}` — a malformed `hilbras.config.json` is silently ignored, and the app proceeds on defaults | P2 | Confirmed |
| C3 | `loadFromFile` does `JSON.parse` then casts to `Partial<SDKConfig>` with no shape validation; a mistyped key silently no-ops | P2 | Confirmed |
| C4 | `validateConfig` exists but is **never called** by `loadConfig` — loading and validating are separate opt-in steps | P2 | Confirmed |
| C5 | `SDKConfig` (from `config/schema.ts`) is never consumed by `HilbrasClient`, which defines a disjoint `HilbrasClientConfig` (`client.ts:52-72`). The `HILBRAS_*` env vars therefore do not configure the client at all. | P1 | Confirmed |
| C6 | `HILBRAS_PROVIDER_NAME` defaults to the literal `"default"` while the README example uses `provider: "OpenAI"` — no normalization between catalog name, config name and display name | P3 | Confirmed |
| C7 | `inferAdapter` guesses from URL substrings; a custom gateway containing "groq" in its path would be misrouted | P3 | Confirmed |
| C8 | Env vars on `HilbrasClientConfig` (transport, adapterRegistry, policy, budget, allowInsecureUrls, allowPrivateNetwork) have no `HILBRAS_*` equivalents — asymmetry between the two config systems | P3 | Confirmed |

**C5 is the most consequential config finding after BUG-01.** The repository contains a complete, documented, tested configuration loader that the main client does not use. Either the client should accept a loaded `SDKConfig`, or the loader should produce a `HilbrasClientConfig`. Today a user who follows the env-var documentation will configure nothing that the client reads.

---
## 15. Integration Opportunities

The dominant integration story here is **not** "component A and B should talk" — it is **"components that already exist are not connected to the client that should drive them."** Those come first because they are the highest-value, lowest-risk work.

### Tier 1 — Wire existing infrastructure into the client

| A | B | Existing interface to reuse | Missing piece | Benefit | Risk | Timing |
|---|---|---|---|---|---|---|
| `ClientHooks` | `StructuredLogger` | `instrumentClient(client)` already accepts `{on}` | One call in the `HilbrasClient` constructor, or a `telemetry?:` config field | Production JSON logs with zero user code | Low | **Immediate** |
| `ClientHooks` | `OpenTelemetryExporter` | same | same | OTel spans/metrics out of the box | Low (fix `require` first) | **Immediate** |
| `ClientHooks` | `UsageDashboard` | same | same | Latency/token aggregates | Low | **Immediate** |
| `ClientHooks` | `AuditLogger` | **none** — no hook bridge exists | A small `instrumentClient` on AuditLogger | SOC 2 audit trail becomes real | Medium | **Near** |
| `HilbrasClientConfig` | `SDKConfig` | overlapping fields | Map loader output → client config (C5) | Env-var config starts working | Medium (API decision) | **Near** |
| adapter `_headers()` | `CredentialProvider` | `resolve(source)` already exists | Pass a resolver through `AdapterConfig` | Secrets stop being duplicated per adapter | Medium | **Near** |

### Tier 2 — Wire existing features into existing cores

| A | B | Rationale | Timing |
|---|---|---|---|
| `MCPClient` (once real) | `features/agent` | MCP's value is tool discovery; agents are the consumer. `getToolsAsHilbras()` already emits agent-shaped tools. | After MCP is implemented |
| `BudgetTracker` | `features/agent` | Agents track `totalCost` locally and compare against a plain `budget` number. The tracker already enforces reservations. | Near |
| `reliability/degradation` | `RequestPipeline` | The chain already handles 413/400 by stripping media. Written, tested, never invoked. | Near |
| `security/pii-guard` | `logging` / `telemetry` | `redact` covers keys; PII handling exists but is unwired. | Near |
| `ModelRouter` | `features/agent` | Agents hardcode one model per config; the router could pick per step. | Deferred — no evidence of demand |
| `features/rag` | `features/agent` | Natural RAG-as-tool for agents. | Deferred |
| `security/request-signer` | `AdapterRegistry` | Signature middleware exists and is unused. | Deferred — niche |

**Do not** wire `middleware/*` into `FetchTransport` merely because both exist. The `retry`/`rateLimit` factories would duplicate logic already implemented better in `reliability/`. Either delete `middleware/` or repurpose it as a user-facing transport wrapper — not as an internal layer.

---

## 16. Duplication and Consolidation

| Duplicate | Intentional? | Recommendation |
|---|---|---|
| `ProviderConfig` in two files | **Intentional** — explicit backward-compat re-export, documented in the file header | Leave as-is |
| `PRICING` (`tokens/counter.ts`) vs `MODEL_PRICING` (`packages/cli/src/cli.ts`) | Accidental | Consolidate or generate both from one source. The CLI deliberately has no SDK dependency, so generation is the honest fix. |
| `BUILTIN_MODELS` (`catalog/models.ts`) vs `provider-catalog.json` | Accidental | Generate the JSON from the TS (or the reverse) in a build step |
| 5 identical `*AdapterConfig` aliases | Accidental noise | Delete; keep only `AzureAdapterConfig` |
| `stream()` / `complete()` pipelines in `client.ts` | Accidental (partially addressed by `pipeline.ts`) | Finish the extraction — move the retry and fallback loops into `pipeline.ts` |
| 3 × `instrumentClient` | Accidental | Extract a shared `HookSubscriber` helper |
| `RetryConfig` defaults in `retry.ts` and restated in every preset | Partially intentional (presets may differ) | Acceptable; note presets restate rather than derive |
| Mock `Transport` re-written in ~18 adapter test files | Accidental | Extract `tests/helpers/mock-transport.ts` |

**Rule-of-three signal:** `instrumentClient` appearing a third time (`dashboard.ts`) is the clearest consolidation cue in the codebase.

---
## 17. Architectural Smells

| Smell | Evidence | Severity |
|---|---|---|
| **God file** | `client/client.ts` — 1,217 lines. `stream()` ≈210 lines, `complete()` ≈207 lines. Owns provider resolution, policy resolution, circuit-breaker checks, retry, fallback, budget reserve/settle, event emission, message normalization, all five multi-modal methods, `streamText`, `streamObject`, `dispose`. | High |
| **Repetition** | Retry loop written twice (stream/complete); fallback loop written twice; `instrumentClient` written three times. | High |
| **Repeated orchestration** | Both `stream()` and `complete()` re-derive provider, policy, retry, timeout, and budget context before entering their loops. | High |
| **Hidden global state** | `getCircuitBreakerRegistry()` singleton (`circuit-breaker.ts:170-175`); `_customTokenizer` (`counter.ts:24`); `_default` credential provider (`credentials/provider.ts:33`). | Medium |
| **Business logic in the client** | `streamText` composes assistant/tool messages and synthesizes call IDs — orchestration belonging to the agent feature, not a transport client. | Medium |
| **Unbounded public surface** | `src/index.ts` exports ~80+ symbols including every adapter, security module, and telemetry module; `package.json` adds ~40 subpaths. The API is far larger than the documented feature set. | Medium |
| **Inconsistent boundaries** | Security and telemetry are fully built and entirely disconnected; the boundary they were designed for does not exist yet. | Medium |
| **Leaky abstraction** | `Transport` promises HTTP, but `FetchTransport` adds connection pooling, request coalescing, and spin-waiting — three concerns the interface does not express. | Medium |
| **Layer violation** | `ReasoningNormalizer` (a stream-type concern) lives in `reliability/` yet is imported by every adapter. | Low |
| **Source cycle** | `features/agent/tool-loop.ts:14` → `../../index.js`. | Low |
| **Dead abstraction** | `Transport.abort()` is specified as "abort any in-flight requests"; the two implementations satisfy it differently and the interface cannot express either contract precisely. | Low |

---

## 18. Maintainability Analysis

**Strengths.** Naming is consistent (`_privateField`, `create*` factories, `is*/has*` predicates). Every `src/` module has a header comment stating its purpose. Zero `TODO`/`FIXME`/`XXX` markers — the codebase carries no debt markers, which is unusual and good. The `architecture/` ADR process is real, and the single ADR present is well written. Error classes expose structured context as public readonly fields.

**Weaknesses that will bite as Hilbras grows:**

1. **Module organization vs. risk.** The code that changes most often (`client.ts`) is the largest file. Reliability changes (the v0.9.3 budget work and SSRF wiring, both referenced in inline comments) had to be applied in more than one place inside it.
2. **Two config systems** (C5) mean every new option must be added twice — or silently applies to only one of them.
3. **Unwired modules rot.** 13 exported modules have no runtime consumer. They will drift from core type changes without any test failing, because their tests pass against their own types.
4. **Type-safety erosion at the edges.** `dashboard.ts:208` uses `(e: any)`; `mcp/index.ts:101` casts `inputSchema as Record<string, unknown>`; `realtime/index.ts` uses `_ws: any` and `(globalThis as any).WebSocket`.
5. **Abstraction quality is uneven.** `url-guard.ts` and `cost/tracker.ts` are exemplary — narrow, well-documented, defensive. `client.ts` is the opposite: broad, orchestration-heavy, and where all integration bugs will land.
6. **Extensibility is good at the adapter layer, poor at the client layer.** Adding a provider is clean and documented. Adding a cross-cutting concern (a new observability sink) means editing `client.ts`.
7. **Refactorability is constrained by the public surface.** Because `index.ts` re-exports everything, reorganizing modules is a potentially breaking change.

---
## 19. Scalability Analysis

Distinguishing **current problem** from **future scalability risk**:

| Dimension | Current problem? | Future risk | Note |
|---|---|---|---|
| More providers | No | Low | `AdapterRegistry` is a Map; O(1) registration. 23 → 50 is a non-event. |
| More models | No | Medium | Router iterates the full catalog per decision. ~180 entries today; linear growth. |
| More users / concurrent tasks | Partially | Medium | 6 connections per origin, spin-wait acquisition (P4), and a **global** circuit-breaker registry shared by all clients. Per-tenant isolation does not exist. |
| More autonomous workers | No | Medium | Agents have no global concurrency gate and no shared budget accounting with `BudgetTracker`. N agents × M steps is N×M uncoordinated provider calls. |
| More tools | No | Low | Tool lists are per-request arrays. |
| More memory / knowledge | No | **High** | RAG is an unindexed in-memory array: O(n) per query, fully resident in process memory. |
| More scheduled jobs | N/A | Low | No scheduler exists in the SDK. |
| More events | No | Low | `ClientHooks` is a per-type Set; listener count is bounded by the caller. |
| More plugins | No | Low–Medium | Adapter registration *is* the plugin mechanism, and it is clean. |
| More browser sessions | No | Low | `RealtimeSession` is per-instance; no shared registry. |

**Architectural bottleneck that becomes serious later.** The combination of a *global* circuit-breaker registry, a *global* tokenizer, and a *process-wide* singleton credential provider means the SDK is single-tenant by construction. Any move to multi-tenant serverless hosting requires scoping all three to a client instance. That is a design decision, not a bug fix — better made deliberately than discovered under load.

**Secondary bottleneck.** `FetchTransport`'s per-origin cap of 6 with 10 ms spin-wait acquisition becomes the throughput ceiling for high-concurrency single-origin workloads — which is the common case (one provider, many parallel requests).

---

## 20. Documentation vs Reality

### Documented but not implemented (or only stubbed)

| Claim | Where documented | Reality |
|---|---|---|
| MCP client integration | `README.md` feature table; `src/index.ts:212-213` export | `mcp/index.ts` is a stub (see §8) |
| Realtime voice/video | `src/index.ts:215-217`; `realtime.test.ts` exists | OpenAI event shape only; no reconnection; no timeout on `connect()` |
| Fine-tuning | `docs/fine-tune.md`; README feature table | Data formatting/validation only — no provider API calls |
| Telemetry / observability "built in" | `docs/observability.md`, telemetry modules | Requires manual `instrumentClient()` per sink; `AuditLogger` has no bridge at all |
| Middleware pipeline | README architecture diagram lists "Middleware Pipeline" | `middleware/` is never invoked |
| Credential management | `credentials/provider.ts` with a full JSDoc header | Never called by the SDK |
| Graceful degradation | `degradation.ts` header describes a Kimi-style ladder | Never invoked |
| `SDKConfig` / env-var configuration | `config/config.ts` header documents precedence | The client does not consume `SDKConfig` (C5) |

### Implemented but undocumented

- `streamText()` and `streamObject()` — documented in JSDoc only; absent from the README feature table and `docs/api-reference.md`.
- `HilbrasClientConfig.budget`, `.allowInsecureUrls`, `.allowPrivateNetwork` — the security flags are covered in `docs/security.md`, but the multi-modal methods (`embed`, `generateImage`, `generateSpeech`, `transcribe`, `rerank`) are not enumerated in the README feature table despite being fully implemented.
- `setTokenizer()` — public, documented in JSDoc, no README mention.

### Stale documentation (confirmed)

1. **`docs/analysis/hilbras-sdk.md` and `docs/analysis/comparison.md`** describe **v0.9.3**. The package is **v0.26.6**. These are prior-audit artifacts. They are internally dated and their quantitative claims (51 source files, ~3,300 lines, 30 test files, 878 tests) no longer match the repository (154 source files, 68 test files). **They should be labelled with their version or moved out of `docs/`.**
2. **`README.md:6`** badge claims "tests-1406%20passing". **Unverified** — the suite was not executed during this audit. The same README body (`:171`) says "Run 1278 tests", contradicting the badge by 128. At least one of the two numbers is stale.
3. **ADR 0001** states the codebase was "51-file, 878-test at v0.9.3". Correct as a historical statement, but readers will assume it reflects today.
4. **`architecture/README.md:9`** promises "Long-form design docs for the major subsystems (cost/budget, reliability pipeline, security, model routing)". None exist — only the meta-ADR.

### Documentation that is accurate and useful

`docs/security.md`, `docs/cost-and-budget.md` (including the explicit `@deprecated` note on `record()`), and `docs/migration-from-vercel-ai-sdk.md` are consistent with the code as written.

---
## 21. Architectural Opportunities

Ordered by value-to-risk, not by ambition.

**1. Stop the config rot (highest value / low risk).**
Fix BUG-01, then decide the relationship between `SDKConfig` and `HilbrasClientConfig`. Either the client accepts a loaded `SDKConfig`, or the loader emits a `HilbrasClientConfig`. Doing nothing guarantees the two surfaces drift forever.

**2. Finish the pipeline extraction (high value / medium risk).**
Move the retry and fallback loops out of `stream()`/`complete()` into `pipeline.ts`. This is the single change that most reduces future defect surface, because it is where duplicated fixes have historically gone wrong.

**3. Wire the three hook-based telemetry sinks (high value / low risk).**
`StructuredLogger`, `OpenTelemetryExporter`, and `UsageDashboard` already expose `instrumentClient(client)`. Calling them from the client constructor, behind a config field, converts roughly 600 lines of dead code into working infrastructure in one change.

**4. Decide the fate of the remaining unwired modules (medium value / low risk).**
`credentials/`, `middleware/`, `request-signer.ts`, `degradation.ts`, `pii-guard.ts`, `audit-logger.ts`. Each is one of: wire it, document it as a standalone opt-in utility, or remove it. Leaving them exported-but-unused is the worst of the three options — it inflates the public surface without delivering value.

**5. Fix BUG-02 and BUG-04 (high value / low–medium risk).**
`ReasoningNormalizer` needs buffer discipline plus a per-stream reset. `streamObject` needs to route through the existing validation pipeline. Both are contained changes.

**6. Deliver or withdraw the MCP client (medium value / medium risk).**
A real MCP implementation (stdio + SSE, JSON-RPC) unlocks tool discovery, which is what most benefits the agent layer. A stub returning `Called X on Y` is worse than no method, because it fails silently rather than loudly.

**7. Add integration tests for `stream()` / `complete()` (high value / low risk).**
A mocked `Transport` exercising retry, fallback, budget reserve/settle, and event emission would pin the behaviour that BUG-01..05 currently threaten.

**8. Split Node-only modules out of the root barrel (medium value / low risk).**
Keeps the edge/browser portability claim honest.

**Explicitly not recommended:** rewriting the adapter layer (it is good), replacing the circuit breaker (it works), or introducing a DI container (the registry pattern is sufficient and simpler).

---

## 22. Priority Classification

### P0 — Critical

| ID | Finding |
|---|---|
| BUG-01 | Env-var API key redacted before storage — `HILBRAS_*` provider config is non-functional |

### P1 — High

| ID | Finding |
|---|---|
| BUG-02 | `ReasoningNormalizer` buffer leak — user text misclassified as reasoning |
| BUG-04 | `streamObject` bypasses validation and auto-repair |
| C5 | `SDKConfig` / env vars never reach `HilbrasClient` |
| A2 | `AnthropicAdapter` string-concatenates possibly-array content |
| A3 | `AnthropicAdapter` forwards `role:"tool"` verbatim — no `tool_use`/`tool_result` translation |
| T1 | `stream()` / `complete()` have no direct tests |
| T2 | Fallback loop untested despite being enabled in 4 of 5 presets |
| I1 | 3 telemetry sinks + audit logger exist but are unwired |

---
---

---