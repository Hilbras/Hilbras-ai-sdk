# Hilbras SDK (@hilbras/sdk) — Deep Analysis

**Path:** `/run/media/gin/01DD24D06510A4D0/Hilbras.product/SDK`
**Version analyzed:** 0.9.4 (post-hardening release)
**License:** MIT (copyright Hilbras 2026)
**Stack:** TypeScript ESM, Node ≥ 18, tsc only (no tsup/esbuild), Vitest, oxlint, single-package (no monorepo)
**Date of scan:** 2026-08-27

---

## Executive summary

`@hilbras/sdk` is a single-package, zero-runtime-dependency TypeScript SDK that ships a provider-agnostic LLM client with 6 built-in adapters, a policy-based model router, a reservation-based budget tracker, an SSRF-safe `addProvider()` guard, structured-output auto-repair, and a typed observability event surface. The codebase is 51 source files / ~3,300 lines, 30 test files / 878 tests, MIT-licensed, and built/tested on Node 22 + Node 24. The v0.9.3 hardening closed 6 P0 issues (budget monotonicity, stream budget enforcement, error-body API-key leakage, SSRF, callback ordering, `extractJson` truncation); the architecture is now well-suited to be lifted into a larger monorepo. The remaining risks are concentrated in a single 708-line god-file (`src/client/client.ts`), two divergent `ProviderConfig` types, and a small set of unused/dead exports.

## Project facts

- **Repo type:** single-package npm library
- **Version:** 0.9.4 (in `package.json:3`)
- **Module type:** ESM (`"type": "module"`), `module: Node16`, `target: ES2022`
- **Runtime deps:** zero (no `dependencies` key)
- **Dev deps (4):** `@types/node ^26.2.0`, `oxlint ^1.79.0`, `typescript ^7.0.2`, `vitest ^4.1.11`
- **Build:** `tsc` with `declaration` + `declarationMap` + `sourceMap`
- **Test runner:** Vitest 4.1.x with `globals: true`, `include: ["tests/**/*.test.ts"]`
- **Lint:** `oxlint 1.79.x` (`npm run lint` covers `src/`)
- **Node engines:** `>= 18`
- **Lockfile:** `package-lock.json` committed
- **Postinstall:** none
- **CI:** `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm run build`, `npm test` on Node 22 + Node 24 (push to main, every PR)
- **Dependabot:** weekly npm + GitHub Actions updates
- **No `release.yml` / `publish.yml`** — the package is published manually (or outside the repo). README and CHANGELOG both reference v0.9.3, so a manual publish flow is in use.
- **License:** MIT
- **Homepage / repo / bugs:** set in `package.json` for npm metadata

## Source structure

51 source files in `src/`, organized into 18 folders plus a barrel `src/index.ts` (118 lines). The full breakdown:

| Folder | Purpose | Public exports (from `src/index.ts`) | Key collaborators | Depth |
|---|---|---|---|---|
| `src/adapters/` | 6 wire-format converters: `openai`, `anthropic`, `google-genai`, `azure`, `groq`, `ollama`, plus `text-tool-call-parser` | `OpenAIAdapter` etc. (only the 5 non-OpenAI are exported from `index.ts:114-118`; `OpenAIAdapter` is the default and is reachable via subpath) | `ProviderConfig`, `Transport`, `ReasoningNormalizer`, `TextToolCallParser` | **Grab-bag** — significant duplication of streaming boilerplate; consider extracting a shared `BaseSSEAdapter` |
| `src/client/` | `client.ts` (god-file) + `hooks.ts` | `HilbrasClient`, `HilbrasClientConfig` | `BudgetTracker`, `ModelRouter`, `CircuitBreakerRegistry`, all 6 adapters via registry | **God-module** — `client.ts` is 708 lines and concentrates policy resolution, budget reservation, retry, fallback, structured output, and SSE parsing orchestration in one class |
| `src/config/` | `schema.ts` (`SDKConfig`, `ProviderConfig`, `DEFAULT_CONFIG`) + `config.ts` (env/file loader) + `prompts.ts` (system-prompt builder) | `loadConfig`, `createConfig`, `validateConfig`, `SDKConfig`, `DEFAULT_CONFIG`, `buildPrompt`, `buildToolSection`, `buildEnvironmentSection`, `buildCodingAgentPrompt` | none internally (read by external code) | **Deep enough** — but `SDKConfig` is never actually wired into `HilbrasClientConfig` (see Risks) |
| `src/cost/` | `tracker.ts` (BudgetTracker + Reservation) + `types.ts` | `BudgetTracker`, `Reservation`, `CostEvent`, `CostReport`, `BudgetConfig` | `tokens/counter` (via `estimateCost`) | **Deep** — clean two-file split; `record()` legacy path lives here (see Risks) |
| `src/credentials/` | `provider.ts` (singleton `DefaultCredentialProvider` + getter/setter) | `DefaultCredentialProvider`, `CredentialSource`, `CredentialProvider`, `getCredentialProvider`, `setCredentialProvider` | none internally; no consumer in the SDK | **Dead module** — entire surface area is unused at runtime (see Risks) |
| `src/errors/` | `index.ts` — 8 typed errors | All 8: `HilbrasSdkError`, `ProviderNotFoundError`, `ModelNotFoundError`, `ProviderRequestError`, `StreamError`, `InvalidFormatError`, `ConfigurationError`, `CircuitBreakerOpenError`, `ValidationError` | `redact` from `logging/logger` (used inside `ProviderRequestError`) | **Deep** — single barrel, clean contract |
| `src/logging/` | `logger.ts` — `SDKLogger` class + `redact()` + `LogEntry`/`LogLevel` types | `redact` only (added in v0.9.3) | `redact()` consumed by `errors/ProviderRequestError`; `sdkLogger` is exported but not wired anywhere | **Deep** — single file; only `redact()` is truly public |
| `src/middleware/` | `middleware.ts` — 5 middleware factories + `composeMiddlewares` | All (`composeMiddlewares`, `authMiddleware`, `loggingMiddleware`, `retryMiddleware`, `rateLimitMiddleware`, `cacheMiddleware`) | none internally; not wired into the client pipeline | **Deep** — but the entire module is currently decorative; `HilbrasClient` does not use `composeMiddlewares` |
| `src/output/` | `structured.ts` — JSON extraction, schema instructions, repair prompts, JSON-mode params | `extractJson`, `buildJsonSystemInstruction`, `buildRepairPrompt`, `buildJsonModeParams` (also `validateOutput`, `processStructuredOutput` internally) | `errors/ValidationError` | **Deep** — well-isolated, heavily tested |
| `src/providers/` | `registry.ts` (ProviderRegistry) + `adapter-registry.ts` (AdapterRegistry + `getDefaultAdapterRegistry`) | `ProviderRegistry`, `AdapterRegistry`, `getDefaultAdapterRegistry`, `AdapterFactory` | all 6 adapter classes via `getDefaultAdapterRegistry` | **Deep** — clean two-class split; plugin-friendly |
| `src/reasoning/` | `normalizer.ts` — `ReasoningNormalizer` (tag-spanning stream buffer) | `ReasoningNormalizer` (class) | consumed by every text-emitting adapter | **Deep** — single class, single responsibility |
| `src/reliability/` | `circuit-breaker.ts`, `retry.ts`, `backoff.ts`, `timeout.ts`, `presets.ts`, `degradation.ts` | All of the above (`CircuitBreaker`, `CircuitBreakerRegistry`, `getCircuitBreakerRegistry`, `createRetryConfig`, `shouldRetry`, `shouldRetryNetworkError`, `createTimeoutSignal`, `calculateBackoff`, `sleep`, `resolvePolicy`, `getPreset`, `withDegradation`, `createDegradationChain`, plus all types) | `BudgetTracker` (via `client.ts`); adapters never call them directly | **Deep** — six small, well-factored files; circuit-breaker has a global singleton (see Risks) |
| `src/router/` | `model-router.ts` — `ModelRouter` (deterministic, scoring-based) | `ModelRouter` (class); `TaskRequirement`, `RoutingResult` (types) | `BUILTIN_MODELS`, `estimateCost`, `ScoreBreakdown` | **Deep** — single class, deterministic, well-tested |
| `src/security/` | `url-guard.ts` + barrel `index.ts` | `validateBaseUrl`, `UrlGuardOptions`, `UrlGuardResult` | `validateBaseUrl` called by `client.ts:116` | **Deep** — v0.9.3 addition, two files, clean |
| `src/tokens/` | `counter.ts` (estimator + pricing table) + `prompt-cache.ts` (cache-control helpers) | `estimateTokens`, `estimateMessageTokens`, `estimateToolTokens`, `estimateCost`, all `cacheXxx` helpers, `supportsCacheControl` | `estimateCost` consumed by `BudgetTracker.estimate` and `ModelRouter._estimateCost` | **Deep** — well-tested, but the pricing table has model-id drift (see Risks) |
| `src/transport/` | `transport.ts` (interface), `fetch.ts`, `websocket.ts` | `Transport`, `TransportRequestInit`, `FetchTransport`, `WebSocketTransport` | all adapters | **Deep** — clean three-file split |
| `src/types/` | `index.ts` barrel + 8 type files (`messages`, `tools`, `streams`, `providers`, `models`, `adapter`, `router`, `policy`, `execution`, `observability`, `schema`) | All types | adapters, router, client | **Grab-bag** — 11 type files in one folder; only `providers.ts` and `schema.ts` both export a `ProviderConfig` (see Risks) |
| `src/catalog/` | `models.ts` — `BUILTIN_MODELS` + `findModel` + `modelsForProvider` + `ModelEntry` | `BUILTIN_MODELS`, `findModel`, `modelsForProvider`, `ModelEntry` | `ModelRouter` | **Deep** — single source of truth for the catalog |
| `src/index.ts` | Public API barrel (118 lines) | 60+ exports organized by section | n/a | **Deep** — well-organized section comments |

## Test coverage

30 test files (29 + the new `tests/security/` folder's two files, as expected after v0.9.3). Total 878 tests, all passing.

| Test file | Subject | Verdict |
|---|---|---|
| `tests/security/url-guard.test.ts` | `validateBaseUrl` — schemes, http-opt-in, AWS metadata, private ranges, input validation (~30 cases) | Strong |
| `tests/security/ssrf-integration.test.ts` | `HilbrasClient.addProvider` end-to-end with `ConfigurationError` (~8 cases) | Strong |
| `tests/structured-output.test.ts` | `extractJson` (incl. v0.9.3 truncation fix), `validateOutput`, `buildJsonSystemInstruction`, `buildRepairPrompt`, `buildJsonModeParams` (~20 cases) | Strong |
| `tests/circuit-breaker-audit.test.ts` | 22 phases: state ownership, isolation, concurrency, transitions, recovery, fallback/retry interaction, error classification, test contamination, multi-client, security, determinism, API review | Excellent — 637 lines |
| `tests/circuit-breaker.test.ts` | Earlier unit tests (subset of audit) | Adequate — overlap with audit |
| `tests/cost-audit.test.ts` | Money correctness, budget boundaries, pricing, NaN/Infinity, floating-point, callback safety, byProvider/byPhase reconciliation, security, adversarial, determinism, invariants (~74 cases; v0.9.3 added 5 in Phase 26 + 2 in Phase 27) | Excellent — 800+ lines |
| `tests/cost-optimization.test.ts` | Cost report integrity, byProvider, byPhase, dedup, large numbers (~30 cases) | Strong |
| `tests/financial-integrity.test.ts` | Master accounting invariants, reservation↔settle, regression of v0.9.2 duplicate-ID, v0.9.3 budget monotonicity, v0.9.3 streaming budget enforcement (~52 cases) | Excellent |
| `tests/reservation-audit.test.ts` | Atomicity, deadlock, lifecycle, settle/release symmetry, duplicate-ID | Strong |
| `tests/reservation-budget.test.ts` | Reserve/budget integration | Adequate |
| `tests/production-audit.test.ts` | Adversarial: client edge cases, router, structured output attacks, observability, concurrency, security, fuzz, v0.9.3 redaction tests across all 6 adapters (~75 cases) | Strong |
| `tests/v0.7.1-deep-audit.test.ts` | Pre-0.8.0 deep audit (plan consistency, determinism, hard constraints, retry/fallback, infinite-loop defense) | Strong but historical |
| `tests/execution-pipeline-audit.test.ts` | v0.9.2 pipeline audit (budget+reservation, retry/fallback, streaming, concurrency, security) | Strong |
| `tests/execution-optimization.test.ts` | Plan() / best() / explain() consistency, scoring breakdown, fallback safety | Strong |
| `tests/provider-contract.test.ts` | AIProvider contract compliance across all 6 adapters (116 cases) | Excellent |
| `tests/adapter-contract.test.ts` | Adapter conformance to `AIProvider` shape | Strong |
| `tests/adapter-registry.test.ts` | `AdapterRegistry` / `getDefaultAdapterRegistry` | Adequate |
| `tests/openai-adapter.test.ts` | Text-embedded tool calls, finish_reason handling, max_tokens degraded retry, native tool calls, reasoning | Strong |
| `tests/anthropic-adapter.test.ts` | Anthropic Messages API, system prompt extraction, tool schema conversion, content blocks | Adequate |
| `tests/azure-adapter.test.ts` | Azure deployment routing, `api-key` header, API version | Adequate |
| `tests/groq-adapter.test.ts` | Groq OpenAI-compat, reasoning normalization, no native tools (text-embedded only) | Adequate |
| `tests/ollama-adapter.test.ts` | No-auth, `num_predict`, local models | Adequate |
| `tests/intelligent-execution.test.ts` | Full router pipeline, structured-output integration, backward compatibility | Strong |
| `tests/router.test.ts` | Router unit tests (filtering, scoring, evaluation order) | Strong |
| `tests/policy.test.ts` | Presets, resolution, per-field overrides | Strong |
| `tests/observability.test.ts` | All 10 hook events, listener safety, unsubscribe, multi-event isolation | Strong |
| `tests/tokens.test.ts` | `estimateTokens`, `estimateCost`, model pricing lookup, edge cases | Adequate |
| `tests/middleware.test.ts` | `composeMiddlewares`, auth, logging, retry, rate-limit, cache (11 cases) | Adequate — but middleware is not wired into the client (see Risks) |
| `tests/retry.test.ts` | `shouldRetry`, `shouldRetryNetworkError`, `createRetryConfig` | Adequate |
| `tests/degradation.test.ts` | All 4 levels, `withDegradation` success/degrade/error/all-fail (10 cases) | Adequate |
| `tests/config.test.ts` | `createConfig` / `loadConfig` / `validateConfig` / `buildPrompt` / `buildCodingAgentPrompt` / `createDegradationChain` (10 cases) | Thin — 89 lines only |

**README feature list cross-reference (no gaps):**
- Provider abstraction (6 adapters) — covered by 6 adapter files + `provider-contract.test.ts`
- Streaming — covered per-adapter
- Tool calling — covered by `openai-adapter.test.ts` + `text-tool-call-parser`
- Structured output — covered by `structured-output.test.ts`
- Model routing — covered by `router.test.ts` + `intelligent-execution.test.ts`
- Circuit breaker — covered by `circuit-breaker.test.ts` + `circuit-breaker-audit.test.ts`
- Retry & backoff — covered by `retry.test.ts`
- Cost enforcement — covered by `cost-audit.test.ts` + `financial-integrity.test.ts` + `reservation-audit.test.ts`
- Observability — covered by `observability.test.ts`
- SSRF safety — covered by `tests/security/*.test.ts` (v0.9.3)
- Error redaction — exercised by `ProviderRequestError` tests (no dedicated redaction test file beyond `url-guard.test.ts` style)
- Reasoning normalization — covered indirectly through adapter tests
- Zero runtime deps — enforced by `package.json` (verified)

**Weak spots:**
- `tests/middleware.test.ts` covers 11 cases but middleware is never invoked from the client pipeline — tests are decorative.
- `src/credentials/provider.ts` has zero tests (no `tests/credentials*` file).
- `src/logging/logger.ts` has zero tests outside of the indirect redaction coverage.
- The `chunk` helper export is undocumented and un-exercised in tests.
- The `record()` legacy cost API has heavy test coverage (tests use it as a shortcut), but no test verifies the deprecated contract from `client.ts` since `client.ts` no longer calls `record()`.

## Dependencies

- **Runtime:** zero (no `dependencies` key in `package.json`).
- **devDependencies (all `^`-prefixed, not pinned):**
  - `@types/node ^26.2.0`
  - `oxlint ^1.79.0`
  - `typescript ^7.0.2`
  - `vitest ^4.1.11`
- **Lockfile:** `package-lock.json` is committed.
- **Postinstall:** no scripts in `package.json` and no `postinstall` hook found in lockfile context.
- **Reproducibility:** all devDeps use caret ranges; `typescript ^7.0.2`, `@types/node ^26.2.0`, `vitest ^4.1.11` are pre-release / future-major pins. This is a future-release-friendly pin pattern but means reproducible builds rely on the lockfile.

## Documentation

- **README.md (151 lines)** — Landing page style: badges, why-section, ASCII architecture diagram, quick start, features table, subpath imports, dev script list. Short and scannable — not a wall of text. (After v0.9.3 docs restructure.)
- **CHANGELOG.md (920+ lines)** — Comprehensive, follows Keep-a-Changelog. v0.9.3 entry dated 2026-08-27 documents all 6 P0 fixes plus 58 new tests with file/line references. Pre-0.9.3 history is also detailed.
- **CONTRIBUTING.md (108 lines)** — Setup, project tree, adapter-adding guide, test mock pattern, versioning, code style, PR process.
- **LICENSE** — MIT, copyright Hilbras 2026.
- **docs/getting-started.md** — Install / first request / provider examples. Examples are current (refer to `gpt-4.1`, `claude-sonnet-4-20250514`, `gpt-4o` Azure).
- **docs/providers.md** — Provider table, per-provider example, covers Groq + Ollama as text-embedded-tool-calls.
- **docs/cost-and-budget.md** — Current: documents the v0.9.3 reservation lifecycle for both `stream()` and `complete()`.
- **docs/security.md** — Current: documents v0.9.3 SSRF policy and redaction.
- **docs/observability.md** — Documents the 10 hook event types, current.
- **docs/api-reference.md** — Lists public exports; reads as exported-symbol catalog.
- **No migration guide** — but the CHANGELOG serves that purpose. No dedicated `docs/migrations/` folder.

## CI/CD

- **`.github/workflows/ci.yml`** — runs `npm ci`, `npm run lint`, `npm run build`, `npm test`. Matrix: Node 22 + Node 24. Triggers on push to `main` and on every PR. No release/publish workflow is present.
- **`.github/dependabot.yml`** — weekly npm updates (minor + patch grouped) and weekly GitHub Actions updates.
- **No `release.yml` or `publish.yml`** — the package is published manually (or outside the repo). The README and CHANGELOG both reference v0.9.3, so a manual publish flow is in use.

## Public API surface

`src/index.ts` exports 60+ symbols. The `package.json` `exports` map has **12 subpath entries**:

- `.` → `dist/index.js`
- `./adapter` → `dist/types/adapter.js` (AIProvider types only)
- `./adapters/{openai,anthropic,google-genai,azure,groq,ollama}` → adapter classes
- `./tokens` → `dist/tokens/counter.js`
- `./config` → `dist/config/config.js`
- `./transport` and `./transport/fetch` → transport classes
- `./reliability/*` → entire `reliability/` folder

**Reachability from the public API:**
- All 6 adapter classes — exported.
- 9 typed error classes — exported.
- `extractJson`, `buildJsonSystemInstruction`, `buildRepairPrompt`, `buildJsonModeParams` — exported (used by `client.ts` internally too).
- `redact` — exported (v0.9.3 add).
- `validateBaseUrl` — exported.
- `BUILTIN_MODELS`, `findModel`, `modelsForProvider` — exported.

**Drift between exports and internal use:**
- `client.ts` imports `redact` indirectly through `errors/index.ts` only.
- `client.ts` imports `buildJsonSystemInstruction`, `buildRepairPrompt`, `extractJson`, `buildJsonModeParams` from `output/structured.ts` directly.
- `chunk` (the helper) is exported but not consumed anywhere inside `src/`.
- `sdkLogger` is exported from `logging/logger.ts` but `client.ts:29` imports it and **never calls it** — see Risks.
- `getCredentialProvider` / `setCredentialProvider` / `DefaultCredentialProvider` are exported but the SDK core never calls them.

## Maintenance signals

- **Version:** `0.9.4` (in `package.json:3`).
- **CHANGELOG history:** v0.1.0 (2026-07-21) → v0.2.0 → v0.3.0 → v0.4.0 → v0.5.0 → v0.5.1 → v0.5.2 → v0.6.0 → v0.6.1 → v0.6.2 → v0.7.0 → v0.7.1 → v0.8.0 → v0.8.1 → v0.9.0 → v0.9.2 → v0.9.3 (2026-08-27). 17 releases in ~5 weeks suggests an aggressive release cadence.
- **TODO/FIXME/HACK/XXX scan:** zero matches in `src/` and `tests/`.
- **`.gitignore`** is minimal — `node_modules`, `dist`, `.zcode`, IDE, OS, coverage, `.env`.
- **`dist/` is present and committed** — `.gitignore:5` lists `dist/` but the directory is on disk; this means the `dist/` folder is **committed to the repo**. (See Risks below.)
- **`prepublishOnly` script:** not present in `package.json`.

## Licensing

- **License:** MIT confirmed at root (`LICENSE:1-21`, copyright Hilbras 2026).
- **All packages:** single package, single license. Consistent.
- **No `NOTICE` file** — not required for MIT.
- **No per-package LICENSE file** — single-package, single root LICENSE is sufficient.
- **No copyright headers** in source files (standard for MIT projects; license is at the root).

## Defect inventory (severity-sorted)

### P0 (correctness / safety / data integrity)

1. **Two divergent `ProviderConfig` types.** `src/types/providers.ts:20-34` and `src/config/schema.ts:47-53` both export an interface named `ProviderConfig` with overlapping but incompatible shapes. The `config/schema.ts` variant uses `apiKey?: string` and `format: "openai"|"anthropic"|"google-genai"` and `models?: string[]`, while the public `types/providers.ts` variant uses `authentication: Authentication` and `adapter: AdapterName` and `models: Model[]`. The two cannot be cross-assigned.
2. **`SDKConfig` is exported but never wired into `HilbrasClientConfig`.** `loadConfig()` returns a `SDKConfig` (with `maxRetries`, `circuitBreakerThreshold`, etc.) but `HilbrasClientConfig` (`src/client/client.ts:42-63`) only has `policy` (which is `ExecutionPolicy`) and `budget`. There is no `sdkConfig` field on the client. README/CHANGELOG v0.4.0 entry claims this was wired. Documentation/behavior mismatch.
3. **Circuit-breaker global singleton shared by all clients.** `getCircuitBreakerRegistry()` returns a process-wide singleton (`src/reliability/circuit-breaker.ts:170-175`). A long-lived process where one client trips a breaker will block all other clients on the same provider name. There is no `HilbrasClient` constructor option for a per-client registry.
4. **Pricing-table / model-catalog drift.** `src/tokens/counter.ts:78-97` (PRICING map) only contains 17 model IDs, while `src/catalog/models.ts:30-67` lists ~35 models. Eleven catalog models (Azure duplicates, Groq models, Ollama models, several Gemini IDs) have no pricing entry and therefore silently produce $0.00 cost estimates. `docs/getting-started.md` examples reference `gpt-4.1`, `claude-sonnet-4-20250514`, `gpt-4o` (none in PRICING) — all return $0.00 from `estimateCost`.
5. **`FetchTransport` creates a fresh `AbortController` per request and only remembers the last one.** `src/transport/fetch.ts:13-15, 32-35`. `transport.abort()` only aborts the most recent in-flight request, not all of them. With concurrent `stream()` + `complete()` calls, only one will be aborted.

### P1 (maintainability / dead code / security)

6. **The 708-line god-file `src/client/client.ts`.** `stream()` (lines 274-484) and `complete()` (lines 488-695) are each ~200 lines and share most of the same pipeline skeleton (resolve provider, get adapter, resolve policy, check circuit breaker, normalize messages, build retry config, build timeout signal, reserve budget, retry loop with fallback). The duplication is the primary reason subsequent fixes (v0.9.3 stream-budget work, SSRF wiring) had to be applied in two places.
7. **`chunk` helper exported but never used internally.** `src/types/streams.ts:52-62` defines `chunk.text/reasoning/toolCall/usage/error` factories. `src/index.ts:19` re-exports it. Zero call sites of `chunk.text(...)` etc. in `src/`. The factory helpers are dead.
8. **Unused `*AdapterConfig` aliases.** `src/adapters/{openai,anthropic,google-genai,groq,ollama}.ts:24` each declare `export type XxxAdapterConfig = AdapterConfig;` (identical alias). Only `AzureAdapterConfig` is structurally distinct (`src/adapters/azure.ts:22-25`). The five identical aliases are noise.
9. **`sdkLogger` imported but never used.** `src/client/client.ts:29` imports `sdkLogger`; no call sites. The logger subsystem is fully implemented but never driven by the SDK.
10. **`credentials/provider.ts` is not wired.** `src/client/client.ts` never calls `getCredentialProvider()`. The 5 exported symbols form a complete but orphaned surface. `process.env` is read inside the adapter's `_headers()` instead (e.g. `src/adapters/openai.ts:46`). There are no `tests/credentials*` files.
11. **`middleware/` not wired into the pipeline.** `src/middleware/middleware.ts` defines 5 middlewares + `composeMiddlewares`, all exported from `index.ts:82-83`, but `client.ts` never references them. The middleware module is currently decorative.
12. **`toolToDict` defined but unused.** `src/types/tools.ts:34-43`. Adapters inline the conversion.
13. **`dist/` committed despite `.gitignore:5`.** If it is also committed, the published surface could drift from `src/`. The `prepublishOnly` script is absent, so there is no enforced rebuild-before-publish step.
14. **`ProviderConfig` from `config/schema.ts` ignores SSRF.** `loadConfig` populates `providers[].baseUrl` from `HILBRAS_PROVIDER_URL` env var and never calls `validateBaseUrl`. A malicious or malformed env var can register an `http://169.254.169.254` provider at SDK startup, bypassing the v0.9.3 SSRF guard.
15. **No redaction in `loadConfig` errors or env-load logs.** The `redact()` helper is only invoked inside `ProviderRequestError`. Anything else that surfaces a user-supplied string does not redact.

### P2 (code quality / discoverability / future-proofing)

16. **Adapter duplication.** 6 adapters share an SSE-buffer skeleton (`text = ""; const parts = buffer.split("\n\n"); buffer = parts.pop() ?? "";` and the `for (;;) { reader.read() }` loop) in `src/adapters/openai.ts:178-292`, `anthropic.ts:142-226`, `google-genai.ts:143-192`, `azure.ts:152-242`, `groq.ts:133-198`, `ollama.ts:110-165`. A shared `BaseSSEAdapter` with pluggable chunk decoders would eliminate ~50 lines per adapter.
17. **Adapter-specific `AzureAdapterConfig.deployment` and `apiVersion` are silently ignored unless `addProvider` is given an `AzureAdapterConfig` directly.** `src/adapters/azure.ts:38-39` reads `config.deployment` / `config.apiVersion` from `AzureAdapterConfig`, but `HilbrasClient.addProvider` only ever creates adapters via `AdapterRegistry.create(id, { provider, transport })` (`src/client/client.ts:126-129`) — so the deployment/apiVersion fields are unreachable.
18. **Pricing in `PRICING` map uses model-id keys but the lookup also tries `${provider}/${model}` (`src/tokens/counter.ts:99`).** Half the Groq models are namespaced `openai/gpt-oss-120b` etc., which would match the `provider/model` lookup; the other half are not. The fallback `?? { input: 0, output: 0 }` is silent — a caller cannot tell why cost is 0.
19. **No tests for `redact()` standalone.** Only exercised indirectly via `ProviderRequestError` tests. The 6 redaction patterns in `src/logging/logger.ts:25-35` are not covered by a dedicated test file.
20. **CHANGELOG v0.9.2 (2026-08-23) → v0.9.3 (2026-08-27) gap** shows 4 days between releases, both with breaking-adjacent changes. 17 versions total, many dated 2026-08-23 (8 entries).

## Recommendations (no fixes proposed — observations only)

1. **Split `src/client/client.ts`** — extract a shared `ExecutionEngine` (or `Pipeline` class) that owns: policy resolution, circuit-breaker check, retry/backoff loop, budget reserve/settle/release, fallback iteration, hook emission. Then `stream()` and `complete()` become thin adapters. This eliminates the duplication and is the single highest-leverage refactor in the codebase.
2. **Unify the two `ProviderConfig` types** — make `config/schema.ts` reuse `types/providers.ts` (or a shared base) so that `loadConfig` output can be passed to `addProvider` without a translation step. This also unblocks wiring `SDKConfig` into `HilbrasClientConfig`.
3. **Wire `SDKConfig` into `HilbrasClientConfig`** — add `sdkConfig?: SDKConfig` to `HilbrasClientConfig` and translate the legacy fields into a resolved `ExecutionPolicy`. This would honour the v0.4.0 documented behavior.
4. **Add SSRF guard inside `loadConfig`** — run `validateBaseUrl` on every `HILBRAS_PROVIDER_URL` (and on any provider in a config file) before accepting it. Otherwise the v0.9.3 SSRF protection is bypassable via env var.
5. **Decide on `chunk`, `*AdapterConfig` aliases, `sdkLogger`, `credentials/provider.ts`, and `middleware/`.** Either wire them into the pipeline (preferred for `credentials`, `middleware`, `sdkLogger`) or remove them from the public API to prevent the appearance of a supported surface that is in fact dead.
6. **Add a pricing table completeness check** — at SDK build time (or via a test), assert that every `BUILTIN_MODELS` entry has a `PRICING` entry, and either price them or tag them as "no-pricing" so `estimateCost` returns `null` rather than a misleading `$0.00`.
7. **Fix `FetchTransport.abort()`** — track an `AbortController` per `request()` and abort all of them, or document that `abort()` is single-shot.
8. **Add a release/publish workflow** — `.github/workflows/release.yml` with `npm ci`, `npm run lint`, `npm run build`, `npm test`, and `npm publish` on tag push, plus a `prepublishOnly` script in `package.json` to ensure `dist/` is fresh.
9. **Verify whether `dist/` is committed** — if it is, decide whether to keep it (for offline installs) or untrack it.
10. **Extract a `BaseSSEAdapter`** to remove the 6× duplicated streaming boilerplate and reduce the surface for SSE-parser bugs.
