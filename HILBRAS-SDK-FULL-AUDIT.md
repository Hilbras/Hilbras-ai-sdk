# Hilbras SDK Full Repository Audit

**Audit date:** 2026-09-24
**Repository:** `/home/gin/work/Hilbras/SDK`
**Release branch:** `release/v3.1.0`
**Audited baseline:** `7a3801d`
**Package release:** `@hilbras/sdk@3.1.0`
**Companion packages:** `hilbras`, `create-hilbras-app`, `@hilbras/next`, `@hilbras/react`, `@hilbras/ui`

## Executive summary

This was a full-repository audit followed by an evidence-backed cleanup pass. Discovery mapped 358 tracked files (165 under `src`, 80 tests, 46 package files, 19 docs files, plus examples, showcase, CI, audit, and roadmap material). Six isolated read-only reviews covered core execution, provider adapters, packages/integrations, build/dependencies/public API, tests/docs, and security boundaries. The findings were then reproduced with focused runtime probes before any repository edit was made.

The baseline had a clean working tree, a passing root typecheck, 19 lint warnings, and a previously flaky root suite with two stress-test timeout failures. The built root package could not be imported by Node ESM because `src/catalog/index.ts` imported JSON without an ESM-compatible strategy. Companion packages were not reproducibly installable or buildable because they used `workspace:*` without a workspace root and had several TypeScript/test defects. Security probes also reproduced cross-credential transport coalescing, broken external-signal cancellation, literal-address SSRF guard gaps, reasoning-state contamination across streams, budget snapshot aliasing, structured-output reservation leaks, retry duplication after visible output, and model-selected tool execution outside the supplied allowlist.

The cleanup pass deliberately stayed within a compatibility-preserving boundary. It made the root and companion packages reproducibly buildable, corrected package/export metadata, fixed the highest-confidence transport/budget/stream/adapter defects, removed only confirmed dead internal artifacts, and corrected the most actively used documentation examples. It did not delete experimental public exports or perform broad architectural rewrites that require a compatibility decision.

### Release recommendation

1. **Release the audited changes as `@hilbras/sdk@3.1.0`.** The prior `3.0.0` version remains immutable; `3.1.0` is the first post-audit release.
2. The root package and all five companion packages pass clean-install build and test gates in this environment. Only the root package is being published in this release; companion versions remain unchanged.
3. The remaining high-risk items in [Deferred risks](#deferred-risks) must be addressed before treating the SDK as a hardened multi-tenant security boundary, especially the legacy request signer, RBAC middleware, browser credential exposure, and DNS/egress controls.

## Scope and method

### Phases completed

| Phase | Work performed | Result |
|---|---|---|
| Discovery | File inventory, exports, build scripts, package manifests, tests, docs, CI, dependency and secret scans | 358 tracked files mapped; no likely production secret committed |
| Evidence | Static review plus isolated runtime probes and adversarial tests | Release blockers and security/correctness findings reproduced before edits |
| Planning | Compatibility review and fresh-context adversarial challenge | Split into root publishability, high-confidence fixes, and companion publication tracks |
| Cleanup | Small tested slices with no public experimental-export deletion | Changes listed in [Modification log](#modification-log) |
| Verification | Clean install, typecheck, lint, tests, builds, package dry-runs, export smoke tests, audits, benchmark, second scan | Results listed in [Final verification](#final-verification) |

### Confidence and risk scale

- **High confidence:** reproduced by a source-level test or deterministic runtime probe.
- **Medium confidence:** strongly evidenced statically, but exploitability or exact provider behavior depends on deployment/configuration.
- **Low confidence:** needs a product or compatibility decision; not treated as a safe cleanup.
- **Risk:** the likelihood that a proposed change breaks a supported consumer or provider. Deferred items are not presented as fixed merely because a safer design is known.

## Architecture and package map

- **Core:** client execution, routing, provider registry/adapters, transport, retries, circuit breaker, budget/cost, structured output, streaming, telemetry, security, framework shims, evaluation, RAG, agent, fine-tune, MCP, and realtime modules.
- **Runtime target:** Node 18+ according to `package.json`; native browser support is not claimed for the Node-only root barrel.
- **Public root exports:** 47 concrete export targets were checked from the built package. The root export map now includes `./catalog` and `./types`, and type conditions precede runtime conditions.
- **Companion publication:** root is an npm workspace so local builds link the current SDK rather than silently installing a registry copy. Published manifests contain ordinary semver ranges; no `workspace:*` protocol remains in packed manifests.
- **Generated output:** `dist/` is ignored and cleaned before each build. `tools/check-package.mjs` imports every concrete export target after a clean build.

## Findings fixed in this pass

Every row below includes the evidence, impact, recommendation/implementation, confidence, compatibility risk, and verification used for the decision.

| ID / area | Evidence and impact | Implemented recommendation | Confidence / risk / verification |
|---|---|---|---|
| **P0-01 — Built ESM import failure** | The baseline `node dist/index.js` probe failed with `ERR_IMPORT_ATTRIBUTE_MISSING` from `src/catalog/index.ts` importing `provider-catalog.json` under `module: Node16`. Consumers could not import the published root. | Converted the catalog data to a typed `src/catalog/provider-catalog.ts` module, changed the import to `.js`, removed the runtime JSON dependency, and removed `resolveJsonModule` from the root config. Catalog values/version were preserved. | High; low compatibility risk; verified by clean build, `check-package` importing 47 entrypoints, `publint`, and direct Node ESM import. |
| **P0-02 — Export map gaps** | `./catalog` was documented but absent; `./types` was absent; several conditions had runtime before types; `OpenAIAdapter` and `redact` were not root-exported despite docs/API usage. | Added the two subpaths, normalized condition order, and added the missing root exports without removing existing exports. | High; additive/low risk; verified with `publint`, export smoke, typecheck, and root tests. |
| **P0-03 — Workspace/protocol release blocker** | Companion manifests used `workspace:*` while the root had no workspace graph; independent installs failed with `EUNSUPPORTEDPROTOCOL`, and the lockfile did not link local packages. | Added root and package workspaces, changed package dependency ranges to publishable semver, added the missing SDK dependency to the CLI, and regenerated `package-lock.json`. | High; low risk; verified with `npm ci`, workspace builds, and packed-manifest inspection. |
| **P0-04 — Companion builds** | React/UI/Next/CLI typechecks failed; UI hooks ran outside their provider; Next had stale type imports and DOM omissions; CLI emitted invalid model definitions. | Corrected hook call signatures, fixed UI provider nesting, mapped cost report data, added the Next DOM library, added a valid `ChatMessage` type and request validation, fixed Next route registration, and added complete CLI model capability records. | High; medium risk limited to companion behavior; verified by all five package builds and tests. |
| **P0-05 — Package release lifecycle** | `prepack`/build could package stale or missing `dist`; companion prepublish paths were inconsistent; root package size was already close to its limit. | Added clean-build scripts, root `prepack`, companion `prepublishOnly`, a package export smoke script, CI package job, and a Node 18-compatible size tool. | High; low risk; verified by dry-runs, clean build, package smoke, size gate, and CI-shaped commands. |
| **SEC-01 — Cross-credential coalescing** | Two concurrent requests with identical URL/body but different `Authorization` headers shared one response. | Coalescing keys now include method, URL, body, and normalized headers. Signal-bearing and non-string bodies are not coalesced. | High; opt-in behavior becomes safer; verified by focused transport regression test. |
| **SEC-02 — External cancellation coupling** | `FetchTransport.abort()` did not cancel a request that supplied its own signal; one caller could also interfere with another caller's shared request. | Every request now uses a transport-owned linked signal; external aborts and transport aborts both cancel it, with listener cleanup and abort-aware slot waiting. | High; low risk; verified by transport tests for caller abort, transport abort, and post-abort recovery. |
| **SEC-03 — Authenticated cache sharing** | `cacheMiddleware` keyed GET responses only by URL, allowing different credentials to share a response. | Cache keys now include normalized request headers and have a bounded LRU-style entry limit. | High; hit rate may decrease; verified by middleware regression test. |
| **SEC-04 — Retry duplication/caller abort** | A stream could be retried after a visible chunk, duplicating output or tool effects; caller cancellation was classified as a retryable network error. | Stream retries/fallback are suppressed after a visible chunk or caller abort. Ordinary internal timeout/network policy remains unchanged. | High; behavior is intentionally safer; verified by execution-pipeline regression tests. |
| **SEC-05 — Literal SSRF classifier gaps** | `127.0.0.2`, IPv4-mapped IPv6, compressed IPv6 forms, and `.local` handling were inconsistent; link-local IPv6 could be treated as an ordinary private range. | Added IPv6 expansion and mapped/loopback checks, made local targets explicitly opt-in, and made link-local IPv6 non-bypassable. | High; this is a deliberate local-network policy change; verified by enhanced and legacy URL-guard suites. |
| **SEC-06 — Provider configuration mutation** | Mutating a caller's `ProviderConfig` after `addProvider()` could change registry/adapter credentials, URL, or models. | Added nested defensive copies at client registration, registry storage, and model lookup. | High; low risk; verified by provider mutation regression test. |
| **SEC-07 — Tool execution boundary** | `streamText` executed any name returned by a model when a `toolExecution` callback existed, and passed malformed arguments as `{raw: ...}`. | Added an explicit tool-name allowlist, rejected non-object/malformed arguments, and emitted non-retryable error chunks without invoking the callback. Broader agent approval/schema policy remains deferred. | High; unknown model tools now fail closed; verified by execution-pipeline regression test. |
| **SEC-08 — PII/prompt regex denial of service** | Zero-width custom PII/injection patterns could loop forever; non-global patterns could repeatedly start at zero; prompt scanning ignored text parts in multimodal messages. | Added safe global-regex handling, zero-width advancement, and multimodal text extraction. | High; heuristic detection behavior is unchanged for normal patterns; verified by timeout-sensitive PII and injection tests. |
| **SEC-09 — Audit logger guarantees** | `redactPii` and `includeSourceIp` settings were ignored, nested entries were mutable, and retention cleared all entries without restoring retained ones. | Applied description/source-IP policy, deep defensive copies, `pruneBefore`, and correct retention restoration. | High; low risk; verified by audit logger regression tests. |
| **SEC-10 — Secret redaction gaps** | `client_secret`, AWS access-key, Google API-key, and non-Bearer token formats could survive logging; body logging truncated before redaction. | Expanded recursive redaction, redacted before truncation, and made body/structured log entries defensive copies. | High; redaction is intentionally conservative; verified by security and telemetry tests. |
| **CORE-01 — Reasoning state contamination** | One `ReasoningNormalizer` lived on each long-lived adapter; an unterminated reasoning block contaminated the next stream. | All ten affected adapters allocate a normalizer per stream invocation. | High; request-local behavior only; verified by sequential/concurrent-state regression test. |
| **CORE-02 — Structured reservation leak** | Schema validation failure could throw before the generic release path, leaving an active budget reservation. | Wrapped the complete post-reservation lifecycle in `finally`; validation exhaustion now releases all reservations. | High; low risk; verified by structured execution test and budget invariants. |
| **CORE-03 — Budget aliasing/prototype keys** | Callers could mutate nested report/event state, and provider `__proto__` could pollute `Object.prototype`. | Reports/events/reservations are copied; aggregation maps use null prototypes. | High; low risk; verified by mutation and prototype regression tests. |
| **CORE-04 — Plugin setup duplication** | Registering a second plugin reran setup for every existing plugin. | Client registration sets up only newly registered/replaced plugins; public `setupAll` remains available. | High; low risk; verified by plugin lifecycle test. |
| **CORE-05 — RAG correctness/resource issues** | Zero vectors produced `NaN`; invalid overlap could hang; pipeline queried the store twice. | Added zero-vector handling, positive finite chunk validation, and one-result context/message construction. | High; invalid inputs now reject promptly; verified by RAG regression tests. |
| **CORE-06 — Model capability defaults** | Static routing catalog specialized models inherited `streaming: true` and `tools: true`, making embeddings/speech/rerank models candidates for chat/tool routing. | Separated chat defaults from all-false specialized capabilities. | High; routing becomes more accurate; verified by router regression test. |
| **CORE-07 — Bedrock SHA primitive** | SigV4 payload hash used HMAC where AWS requires plain SHA-256. | Switched `_sha256` to `createHash("sha256")`. | High; protocol-correct; verified against captured request body. |
| **CORE-08 — Deepgram query keys** | Four query parameters had leading spaces, producing `+punctuate`-style keys instead of provider options. | Removed leading spaces. | High; low risk; verified by multipart request test. |
| **CORE-09 — Cost alert timing** | The warning callback fired every configured threshold, even thresholds not yet reached. | Threshold firing now compares current spend percentage and de-duplicates the 100% event. | High; callback timing is corrected; verified by alert tests. |
| **OPS-01 — Test false failure** | Circuit-breaker test accidentally put a transport on `ProviderConfig` and made 100 real network requests. | Corrected the test to inject the mock transport through `HilbrasClient`. | High; test-only; verified by full root suite. |
| **OPS-02 — Stress-test honesty** | Routing and financial stress tests were named/asserted inconsistently and timed out under the global 5s default despite measured 6–7s isolated runtime. | Set explicit 30s test timeouts and made the routing assertion/name agree with the measured budget. | High; test-only; verified repeatedly in the full suite. |
| **DOC-01 — Executable model-output example** | Agent docs used `eval(params.expression)` on model-selected input. | Replaced it with an allowlisted arithmetic operation and corrected framework package imports. | High; docs-only; verified by repository scan. |
| **CLEAN-01 — Confirmed dead artifacts** | Custom URL lint tool searched for nonexistent `getFromApi`; unreachable internal barrels, deprecated logger singleton, and unused `toolToDict` were dead. | Removed the custom tool/test, unreachable barrels, logger class/singleton, unused helper, and duplicate top-level benchmark. Public experimental exports were retained. | High; deletion was based on reference/build/script scans; verified by full build/tests and post-change grep. |

## Deferred risks

These findings remain real or design-dependent. They are not silently represented as fixed.

| ID / severity | Evidence and impact | Recommendation | Confidence / risk / required next verification |
|---|---|---|---|
| **SEC-D1 — High — legacy request signer** | `RequestSigner` emits a body digest header but does not include it in the default signed-header set; `verify()` does not independently recompute it. A tampered body can retain the original signature; replay protection is explicitly absent. | Introduce a versioned v2 body-bound protocol with canonical rules, timestamp freshness, nonce/replay storage, and migration guidance. Do not silently dual-accept v1 body signatures. | High confidence, high compatibility risk; requires protocol fixtures, one-byte tamper tests, empty/Buffer bodies, SHA-256/512 cases, and migration docs. |
| **SEC-D2 — High — RBAC fail-open integration** | Middleware chooses `defaultRole` rather than resolving a user role, treats missing roles as allow, extracts provider from provider wire bodies that normally omit it, skips checks when metadata is missing, and calls `acquire()` without `consume()`. | Redesign around trusted request-scoped provider/model metadata, an explicit user-to-role resolver, fail-closed defaults, and atomic rate-limit consumption. | High confidence, high compatibility risk; requires end-to-end role resolution, denial, missing-metadata, and concurrent rate-limit tests. |
| **SEC-D3 — High — credential-bearing getters/browser integration** | `client.getProvider()`/`listProviders()` retain raw authentication values for compatibility; React hooks can execute with a client constructed in browser code. | Add redacted summary accessors and migrate browser integrations to a server proxy. Keep raw getters only behind an explicit, deprecated compatibility path. | High confidence, high compatibility risk; requires browser threat-model tests and a documented migration. |
| **SEC-D4 — High — DNS/egress SSRF** | Literal URL checks are improved, but hostname DNS resolution, rebinding, address pinning, and all redirect-capable outbound paths are not uniformly controlled. OIDC, cost webhooks, and WebSocket transports have separate URL policies. | Introduce one outbound policy with DNS resolution/pinning, redirect revalidation or rejection, timeouts, response limits, and an egress proxy recommendation. | High confidence, high architectural risk; requires adversarial DNS/redirect tests and deployment guidance. |
| **SEC-D5 — High — agent approval/schema boundary** | `ToolLoopAgent`, ReAct, and plan/execute agents can default to approved execution, and tool schemas are descriptive rather than runtime-validated. Direct `streamText` is allowlisted now, but these agent classes remain broader. | Make side-effecting tools approval-gated by default, validate arguments at the execution boundary, separate read-only/privileged tools, and treat tool output as untrusted data. | High confidence, high behavioral risk; requires per-agent authorization, timeout, injection, and schema tests. |
| **SEC-D6 — High — framework route exposure** | Example and framework helpers accept raw messages, large step counts, and no built-in authentication/body limits; some return raw error strings; Hono example enables unrestricted CORS. | Require an auth hook, strict schemas/allowlists, body/message/step limits, per-user rate limits, generic errors, and explicit CORS origins. | High confidence, deployment-dependent; requires browser/integration tests for each framework. |
| **CORE-D1 — High — budget policy gaps** | Unknown models receive zero pricing, output cost is not reserved conservatively, and multimodal operations bypass the tracker. | Fail closed or use an explicit conservative pricing fallback; reserve output cost; apply one accounting lifecycle to every billable operation. | High confidence, high product-policy risk; requires pricing, overage, multimodal, and cancellation tests. |
| **CORE-D2 — High — Bedrock protocol coverage** | The SHA primitive is corrected, but Converse request/response/event-stream formats remain only partially implemented and provider-specific paths are not fully verified. | Complete protocol fixtures and provider contract tests before calling Bedrock production-ready. | High confidence for remaining defects, medium confidence for all provider variants; requires mocked AWS wire fixtures and integration tests. |
| **CORE-D3 — Medium — catalog/routing divergence** | `src/catalog/models.ts` and `src/catalog/provider-catalog.ts` remain separate sources; the JSON-derived catalog is still version `0.26.6`; automatic routing can disagree with registered providers. | Define one versioned schema and migration/generation process; unify provider/model identity separately from the import fix. | High confidence, medium compatibility risk; requires parity and routing regression tests. |
| **CORE-D4 — Medium — multimodal/provider path issues** | Several adapters interpolate model IDs into URLs or have provider-specific endpoint/response mismatches. | Encode path segments, define endpoint contracts, and add provider-specific fixtures. | Medium/high confidence depending on provider; requires live-safe mocked contract tests. |
| **CORE-D5 — Medium — realtime/MCP partial features** | Realtime event parsing/timer cleanup/authentication and MCP execution are incomplete/stubbed. | Keep exports for compatibility but label them experimental/non-production until lifecycle and security contracts are implemented. | High confidence, medium product risk; requires adversarial protocol tests. |
| **OPS-D1 — Medium — lint warnings** | `npm run lint` passes with 18 warnings, mostly ignored framework/agent options and unused imports. | Triage each warning by contract; do not hide ignored public options merely to reach zero. | High confidence, low immediate risk; no threshold was weakened. |
| **OPS-D2 — Medium — coverage gate** | Coverage executes successfully but fails the existing 80/70/80/80 thresholds at 60.8/56.29/64.6/63.06 (statements/branches/functions/lines). | Add meaningful tests for untested provider/framework/agent paths or explicitly revise the quality contract with owner approval. | High confidence; no threshold was lowered in this pass. |
| **DOC-D1 — Medium — broad docs drift** | Many historical/roadmap documents intentionally describe future packages or old APIs; some feature examples still require manual compilation review. | Add executable snippet tests and mark historical/roadmap material as non-contractual. | High confidence for known stale examples, medium for all docs; requires a dedicated docs CI job. |

## Security controls and false-positive review

The audit did not claim vulnerabilities without a reachable sink or reproducible behavior.

- No shell/process execution sink was found in the core SDK. `MCPClient` is currently a stub; its stored command/args are not executed.
- The prompt-injection detector is a heuristic helper, not an authorization boundary. Its zero-width denial-of-service issue was fixed, but it was not promoted to a security control.
- `deepMerge()` and ordinary object spread were not classified as arbitrary global prototype pollution. The concrete `BudgetTracker` aggregation issue was reproduced and fixed with null-prototype maps.
- Secret scans found placeholders, test keys, and the canonical AWS example access key. No likely live production secret was found in tracked source.
- The root browser story remains intentionally conservative: the root barrel imports Node built-ins in its dependency graph, and browser users should use a server proxy rather than treating the root package as edge-safe.

## Dead code, cleanup, and dependency audit

### Confirmed deletions

| Deleted item | Evidence before deletion | Replacement/impact |
|---|---|---|
| `src/catalog/provider-catalog.json` | Runtime import caused the Node ESM failure; no source/test/docs reference remained after conversion. | Replaced by `src/catalog/provider-catalog.ts`; catalog API and values preserved. |
| `src/plugin/index.ts` | Unreachable internal barrel; package exports point to `dist/index.js`, not this file. | No public export removed. |
| `src/security/index.ts` | Unreachable internal barrel; root exports direct modules. | No public export removed. |
| `src/telemetry/index.ts` | Unreachable internal barrel; root exports direct modules. | No public export removed. |
| `tools/check-validate-url.mjs` and its test | Script searched for nonexistent `getFromApi` and was not a real URL security check. | Removed from package/CI; real URL tests remain in `tests/security/url-guard.test.ts` and `tests/ssrf-enhanced.test.ts`. |
| `benchmarks/performance.bench.ts` | Duplicate top-level benchmark was not referenced by the `benchmark` script; canonical `tests/benchmarks/performance.bench.ts` runs successfully. | Deleted to avoid maintaining two benchmark stories. |
| `SDKLogger` class/types/singleton in `src/logging/logger.ts` | No runtime/test consumer; `redact()` remains live and root-exported. | Removed only the dead logger surface. |
| `toolToDict()` in `src/types/tools.ts` | No source/test/docs consumer; adapters inline conversion. | Removed unused helper. |

### Dependency decisions

- **No runtime dependency was removed.** The root remains a zero-runtime-dependency package.
- **No dependency was deleted merely because it appeared unused**; companion/runtime peer requirements were retained unless a direct manifest/build contradiction was proven.
- Added root dev dependency `@vitest/coverage-v8` because the existing `test:coverage` script could not run without it.
- Added UI test dev dependencies `@testing-library/react` and `jsdom` for the existing UI test suite.
- Corrected companion dependency ranges from `workspace:*` to ordinary semver ranges and added the missing SDK dependency to the CLI.
- Upgraded the Next development dependency to patched `next@^16.3.6`; the prior installed development graph reported PostCSS advisories. `npm audit` is now zero.
- Added `packageManager: npm@11.19.0` and root workspace metadata for reproducible npm operation.

## Build, public API, and documentation review

### Build and package state

- Root clean build emits declarations/source maps and passes the 47-entrypoint import smoke test.
- Companion clean builds pass for CLI, scaffolder, Next, React, and UI.
- `publint` reports `All good!`.
- `npm pack --dry-run` succeeds for all six packages. Packed companion manifests contain no `workspace:*` protocol.
- Root dry-run: 655 files, 367,437 bytes packed, 1,961,673 bytes unpacked in the final verification run.
- Companion dry-runs: CLI 3 files, scaffolder 9, Next 13, React 21, UI 69; all contain built output and publishable manifests.
- `npm run size` reports 1,889.3 KB against the 1,900 KB limit.

### Public API compatibility decisions

- Existing public exports were retained, including experimental MCP/realtime/framework surfaces.
- Additive changes include `./catalog`, `./types`, `redact`, `OpenAIAdapter`, companion `apiKey`/client options, case-insensitive catalog provider IDs, and the string return from `addProviderFromCatalog()`.
- Raw provider getters were intentionally not changed to redacted objects in this release because that would break credential-rotation and diagnostic consumers. The security documentation now explicitly warns against serializing them.
- Local URL policy is stricter: loopback/`.local` targets require explicit opt-in, and link-local IPv6 is never allowed.
- Tool callbacks now fail closed for unknown names and malformed arguments; this is an intentional security behavior change.

### Documentation corrections

Updated current-facing material for:

- the typed catalog module and synchronous catalog API;
- root subpath imports versus nonexistent separate framework packages;
- server-side provider credential handling for React/Next examples;
- current `FinishChunk`/route helper types and Next package usage;
- PII/local URL policy;
- the removed logger singleton;
- the safe agent tool example;
- current test counts and package test commands;
- scaffolder template availability and generated `.gitignore` behavior.

Historical changelogs, roadmaps, and prior audit documents were not rewritten as if they were current API contracts.

## Modification log

### Runtime and package files

- `src/catalog/index.ts`, `src/catalog/provider-catalog.ts`, `tsconfig.json`: typed catalog build path.
- `package.json`, `package-lock.json`, `.github/workflows/ci.yml`: workspaces, clean builds, package smoke, companion CI, audit gate, coverage dependency.
- `tools/clean-dist.mjs`, `tools/check-package.mjs`, `tools/check-size.mjs`: reproducible build/publish checks.
- `src/transport/fetch.ts`, `src/middleware/middleware.ts`: signal, coalescing, cache, redirect, and retry boundaries.
- `src/client/client.ts`, `src/config/provider-config.ts`, `src/providers/registry.ts`, `src/plugin/registry.ts`: defensive copies, reservation cleanup, retry/abort behavior, tool allowlist, catalog return, plugin setup.
- `src/cost/tracker.ts`, `src/cost/alerts.ts`: immutable accounting and threshold crossing.
- `src/security/url-guard.ts`, `pii-guard.ts`, `prompt-injection-guard.ts`, `audit-logger.ts`, `src/logging/logger.ts`, `src/telemetry/body-logger.ts`, `structured-logger.ts`: SSRF/redaction/audit hardening.
- `src/features/rag/{chunker,in-memory-store,pipeline,retriever}.ts`: validation, zero vectors, single retrieval.
- `src/catalog/models.ts`: specialized capability defaults.
- `src/adapters/{openai,openai-compatible,anthropic,azure,groq,ollama,cohere}.ts`, `src/adapters/extra.ts`: protected extra-parameter boundary.
- `src/adapters/bedrock.ts`, `deepgram.ts`: SHA/query corrections.
- All ten reasoning-bearing adapters: request-local normalizer allocation.

### Companion files

- React hooks/provider: current SDK stream signature, cost report mapping, server-client documentation.
- UI ChatBox/package: correct provider nesting, valid tailwind export target, React-only description, DOM test config.
- Next stream/middleware/config/package: typed request validation, catalog client registration, cancellation propagation, generic error protocol, DOM libs, patched Next dev dependency, Vitest config.
- CLI: SDK dependency, complete model records, corrected precedence and stale `--json` help.
- Scaffolder: build lifecycle, truthful template help, secret-safe generated `.gitignore`.

### Tests added or updated

Focused regression coverage was added/updated for catalog/build exports, transport coalescing and cancellation, cache isolation, URL guard edge cases, provider copies, structured reservation cleanup, budget snapshots, reasoning isolation, tool allowlisting, plugin setup, RAG validation/retrieval, PII/prompt regex safety, audit retention/copies, secret redaction, telemetry redaction, cost thresholds, Bedrock hashing, Deepgram parameters, static capabilities, and companion package behavior.

## Final verification

All commands below were rerun after a clean `npm ci --ignore-scripts` unless noted.

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | Pass; lockfile installs reproducibly; 0 vulnerabilities reported by npm |
| `npm run pretest` / `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass with 0 errors and 18 warnings; warnings were not hidden |
| `npm test` | Pass: 81 files, 1,611 root tests |
| `npm run test:packages` | Pass: CLI 8, scaffolder 18, Next 5, React 1, UI 12; 44 companion tests |
| `npm run build` | Pass |
| Companion workspace builds | Pass for all five packages |
| `npm run check:package` | Pass; 47 concrete export entrypoints imported |
| `npx publint` | Pass: `All good!` |
| `npm audit` | Pass: 0 vulnerabilities |
| `npm audit --omit=dev` | Pass: 0 vulnerabilities |
| `npm run size` | Pass: 1,889.3 KB / 1,900 KB |
| `npm run benchmark -- --run` | Pass; canonical benchmark suite completed. Vitest emitted its normal experimental-feature warning and some zero-duration comparisons display `NaNx`; process exit was successful. |
| `npm run test:coverage` | Test execution passed, but the command exits nonzero because existing global thresholds are not met: 60.8% statements, 56.29% branches, 64.6% functions, 63.06% lines. Thresholds were not lowered. |
| `@arethetypeswrong/cli --pack .` | Node 16 ESM and bundler resolution pass; the tool reports legacy Node 10 subpath resolution warnings because the package supports Node 18+ and does not provide Node-10 `typesVersions`. `publint` and the declared-runtime smoke test pass. |
| `git diff --check` | Pass |
| Second repository-wide scan | No runtime JSON catalog import, `workspace:*`, deleted lint-tool reference, executable model `eval()` example, adapter `Object.assign(body, params.extra)`, or shared reasoning-normalizer property remains in active code. Remaining matches are historical audit/roadmap documents and documented deferred code. |

## Files changed/deleted summary

- **Modified:** 97 tracked paths, including root package/config, CI, documentation, core runtime, adapters, security, cost/RAG/telemetry, companion sources/manifests, tests, and this report.
- **Added:** 11 new paths, including `src/catalog/provider-catalog.ts`, `src/adapters/extra.ts`, `tools/check-package.mjs`, `tools/clean-dist.mjs`, package Vitest configs, React smoke test, adapter-extra test, catalog integration test, reasoning-normalization test, and the generated template `.gitignore`.
- **Deleted:** the JSON catalog source, three unreachable internal barrels, the custom URL lint tool/test, duplicate top-level benchmark, and dead logger/helper symbols as described above.
- **No public experimental export was deleted.**
- **No runtime dependency was removed.**

## Recommended next work

1. Release under a new version after reviewing the package diff and changelog.
2. Complete the v2 request-signing protocol and RBAC redesign before advertising either as a production security boundary.
3. Add redacted provider summary APIs and migrate browser integrations to a server proxy.
4. Implement a shared DNS/egress policy for HTTP, OIDC, WebSocket, and webhook paths.
5. Complete agent runtime schemas/approval and framework route authentication/limits.
6. Establish a coverage-improvement plan and a docs snippet compilation job.
7. Unify the two catalogs only through a versioned migration plan; do not merge them as an unreviewed cleanup.

---

## v3.2.0 addendum — Core Execution Stabilization

**Audit date:** 2026-09-24
**Release branch:** `release/v3.2.0`
**Package target:** `@hilbras/sdk@3.2.0`
**Baseline:** v3.1.0 commit `8876e17`

### Scope and result

The v3.2 phase adds an internal execution boundary without adding public
runtime exports:

- `src/core/execution/request-context.ts` and `execution-result.ts` define
  logical-request and attempt contracts.
- `request-executor.ts` owns one provider attempt, policy preparation, circuit
  state, and disposable timeout scopes.
- `request-pipeline.ts` owns logical budget reservation, retries, fallback,
  plugin lifecycle, terminal events, plain/structured completion, and streaming.
- `ports.ts` prevents the execution layer from depending on `HilbrasClient` or
  the root barrel.
- `complete()`, structured `complete()`, `stream()`, `streamText()`, and
  `streamObject()` were migrated incrementally with focused characterization
  and regression tests.
- Multimodal calls remain outside the v3.2 budget pipeline by explicit design;
  pricing and reservation semantics are deferred rather than silently changed.
- The release build uses `tsconfig.build.json` without source/declaration maps;
  the measured artifact is 1,108.3 KB against the unchanged 1,900 KB gate.

### v3.2 verification

| Check | Result |
|---|---|
| `npm run pretest` / `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass with 0 errors and 18 existing warnings; no suppressions added |
| `npm test` | Pass: 88 files, 1,645 root tests |
| `npm run test:packages` | Pass: 44 companion tests; all five companion builds pass |
| `npm run check:package` | Pass: 47 concrete export entrypoints imported |
| `npx publint` | Pass: `All good!` |
| `npm audit --omit=dev` | Pass: 0 vulnerabilities |
| `npm run size` | Pass: 1,108.3 KB / 1,900 KB |
| `npm run benchmark` | Pass; canonical benchmark suite completed |
| `npm run test:coverage` | Tests pass, but existing global thresholds remain unmet: 61.86% statements, 56.64% branches, 65.31% functions, 64.23% lines versus 80/70/80/80. Thresholds were not lowered. |
| `@arethetypeswrong/cli --pack .` | Node 18+ ESM and bundler resolution pass; legacy Node 10 subpath warnings remain baseline/tooling limitations, while `publint` and runtime export smoke tests pass. |

### Deferred risks carried forward

The v3.2 changes do not close the previously documented high-risk items:
legacy body-bound request signing and replay protection; fail-open RBAC;
credential-bearing browser accessors and browser usage; DNS/egress SSRF
control; agent approval and runtime schema enforcement; multimodal and
unpriced-model budget policy; incomplete Bedrock/realtime/MCP protocols;
catalog/routing divergence; and framework route authorization/body limits.

The full root suite and package gates pass, but the existing coverage gate is
still below its declared thresholds and remains an explicit follow-up rather
than a silently weakened requirement.
