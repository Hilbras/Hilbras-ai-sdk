# Implementation Plan: v3.2.0 Core Execution Stabilization

## Overview

Evolve the v3.1.0 execution paths incrementally into a dedicated internal execution subsystem without unnecessarily changing public APIs or observable behavior. The first release slice will characterize the existing lifecycle, then introduce typed request context/results and one-attempt execution, followed by a narrow `complete()` migration. Streaming, fallback correctness, multimodal convergence, and public exports remain independently gated slices.

## Current-state evidence

- `HilbrasClient` is approximately 1,500 lines and owns provider resolution, policy preparation, retries, fallback, budget lifecycle, plugins, telemetry, cancellation, and terminal events.
- `stream()`, `complete()`, and `_runMultiModal()` contain divergent reliability loops.
- No `src/core/execution/` modules exist yet.
- The public `ExecutionPlan` types in `src/types/execution.ts` must not be repurposed as runtime execution results.
- Confirmed risks include fallback skipped after a non-retryable primary error, fallback output/cancellation inconsistencies, timeout/backoff cleanup gaps, non-terminal lifecycle events, plugin signal/context divergence, and global circuit-breaker behavior.
- v3.1.0 is published and the repository is clean; no v3.2.0 source changes are made during planning.

## Architecture decisions

1. **Internal-first boundary:** create `src/core/execution/` modules without exporting them from the root barrel until parity is proven.
2. **Logical request vs. attempt:** one logical request ID owns lifecycle, budget, plugin, and terminal state; each attempt/candidate gets explicit metadata.
3. **Preserve error identity:** execution results retain and rethrow the original provider/cancellation/validation error; wrappers may add internal context but must not replace public error identity.
4. **Preserve event compatibility:** retain existing event names, request IDs, payload fields, and ordering unless an additive field is required.
5. **Preserve current public mutation semantics:** do not freeze/copy plugin message objects until characterization tests and a compatibility decision establish the desired behavior.
6. **Separate characterization from fixes:** add tests before mechanical extraction; land retry/fallback/timeout behavior changes separately with named regressions.
7. **Plain complete first:** migrate non-streaming complete execution before structured-output and streaming migration.
8. **No runtime dependency or Node-only regression:** retain zero runtime dependencies and native ESM compatibility.
9. **Package-size discipline:** v3.1.0 is close to the 1,900 KB limit; every slice must run the size gate.

## Task list

### Phase 0 — Characterization tests

- [ ] **Task 0.1: Add execution lifecycle characterization tests**
  - Add focused tests for request start/completed/failed ordering, lazy stream startup, consumer break, budget finalization, provider errors, cancellation, and structured success/failure.
  - Use public client APIs and injected adapters/transports; avoid mutating private client fields except in an explicitly isolated legacy test.
  - **Acceptance:** existing behavior is recorded and passes on the v3.1.0 baseline; no production behavior changes.
  - **Verification:** `npx vitest run tests/core/execution tests/client/pipeline.test.ts tests/stream-integration.test.ts tests/complete-integration.test.ts`.
  - **Dependencies:** None.
  - **Files:** new `tests/core/execution/*.test.ts`; existing integration tests as needed.

- [ ] **Task 0.2: Add retry/fallback characterization matrix**
  - Cover non-retryable primary errors, successful fallback, visible fallback output, cancellation during fallback, structured-output capability, and terminal error identity.
  - **Acceptance:** each current behavior is either locked as compatibility behavior or marked for a separately approved fix.
  - **Verification:** focused execution-pipeline tests with fake adapters and deterministic errors.
  - **Dependencies:** Task 0.1.
  - **Files:** `tests/core/execution/lifecycle.test.ts`, `tests/execution-pipeline-audit.test.ts`.

### Phase 1 — Pure internal contracts

- [ ] **Task 1.1: Add `RequestContext` and `ExecutionResult` contracts**
  - Add `src/core/execution/request-context.ts` and `execution-result.ts`.
  - Represent logical request metadata, resolved provider/model, routing metadata, policy, caller/execution signals, attempt/fallback phase, operation, and redacted event/plugin projections.
  - Use discriminated success/failure results and preserve the original error object.
  - **Acceptance:** contracts are internal, type-safe, free of client/provider-registry back-dependencies, and do not change public exports or behavior.
  - **Verification:** `npx tsc --noEmit` and focused contract tests.
  - **Dependencies:** Task 0.1.
  - **Files:** new `src/core/execution/request-context.ts`, `execution-result.ts`, `tests/core/execution/context.test.ts`.

- [ ] **Task 1.2: Define injected execution ports**
  - Define narrow internal interfaces for provider invocation, policy/circuit state, budget, hooks, plugins, fallback candidates, and clock/sleep.
  - Avoid importing `HilbrasClient` or the root barrel from the execution layer.
  - **Acceptance:** the execution layer can be tested with fakes and has no new runtime dependency.
  - **Verification:** typecheck and architecture dependency scan.
  - **Dependencies:** Task 1.1.
  - **Files:** `src/core/execution/ports.ts` or colocated types; focused type tests.

### Phase 2 — One-attempt execution

- [ ] **Task 2.1: Add disposable timeout primitive internally**
  - Keep the public `createTimeoutSignal(): AbortSignal` API unchanged.
  - Add an internal disposable helper that exposes signal state and clears timers/listeners on completion.
  - Distinguish caller cancellation from internal timeout expiry.
  - **Acceptance:** successful requests release timeout resources; caller abort remains observable; provider timeout precedence is explicitly tested.
  - **Verification:** fake-clock tests, `npm run pretest`, existing timeout/retry tests.
  - **Dependencies:** Task 1.1.
  - **Files:** `src/reliability/timeout.ts`, `tests/reliability/timeout.test.ts`.

- [ ] **Task 2.2: Extract `RequestExecutor` for one attempt**
  - Move policy preparation, circuit availability, adapter lookup/invocation, error classification, and circuit success/failure recording behind the executor.
  - Delegate existing `_prepareRequest()` first without changing retry/fallback behavior.
  - **Acceptance:** one-attempt behavior matches baseline; original errors retain identity; cancellation is not counted as a provider failure where baseline already excludes it.
  - **Verification:** focused executor tests plus existing pipeline/retry/provider-contract suites.
  - **Dependencies:** Tasks 1.1–1.2, 2.1.
  - **Files:** `src/core/execution/request-executor.ts`, `src/client/client.ts`, focused tests.

### Phase 3 — Non-streaming pipeline

- [ ] **Task 3.1: Extract `RequestPipeline` for plain `complete()`**
  - Move one logical request's reserve → attempt → settle/release lifecycle behind an injected pipeline.
  - Keep `HilbrasClient.complete()` as the public facade and preserve current public parameters/events.
  - Enforce exactly one terminal budget action and rethrow the original terminal error.
  - **Acceptance:** plain complete parity tests pass; no streaming/structured behavior changes are introduced.
  - **Verification:** `tests/complete-integration.test.ts`, `tests/reservation-budget.test.ts`, `tests/financial-integrity.test.ts`, full focused suite.
  - **Dependencies:** Task 2.2.
  - **Files:** `src/core/execution/request-pipeline.ts`, `src/client/client.ts`, new tests.

- [ ] **Task 3.2: Migrate structured complete only after parity**
  - Reuse the pipeline's terminal lifecycle for structured output and repair.
  - Preserve existing JSON repair behavior and validation error identity.
  - **Acceptance:** structured success, repair, and exhaustion have matching event/budget semantics; reservation cleanup is guaranteed.
  - **Verification:** structured-output, execution-pipeline, and financial-integrity tests.
  - **Dependencies:** Task 3.1.
  - **Files:** `src/core/execution/request-pipeline.ts`, `src/client/client.ts`, `src/output/structured.ts` only if required.

### Phase 4 — Reliability correctness

- [ ] **Task 4.1: Make backoff cancellation-aware**
  - Add an abort-aware internal sleep without changing the existing public backoff API.
  - Ensure no adapter invocation occurs after caller cancellation.
  - **Acceptance:** cancellation during backoff exits promptly and produces the established cancellation result.
  - **Verification:** fake-timer tests for primary, retry, and fallback paths.
  - **Dependencies:** Task 3.1.
  - **Files:** `src/reliability/backoff.ts`, execution tests.

- [ ] **Task 4.2: Correct fallback activation and isolation**
  - Make fallback eligibility independent of the retry counter.
  - Track visible output, attempted candidates, cancellation, structured capability, and `maxFallbackCost`.
  - Ensure fallback participates in the same circuit/plugin/telemetry lifecycle policy.
  - **Acceptance:** non-retryable primary failure can use an eligible fallback; no duplicate output/side effects; cancellation is terminal; structured constraints are preserved.
  - **Verification:** dedicated fallback matrix and concurrency tests.
  - **Dependencies:** Tasks 3.1–3.2, 4.1.
  - **Files:** `src/core/execution/request-pipeline.ts`, `src/client/client.ts`, policy/router tests.

- [ ] **Task 4.3: Define timeout semantics**
  - Decide and document whether `requestTimeoutMs` is a logical deadline or per-attempt deadline.
  - Make the decision explicit in tests and migration notes; do not silently change behavior.
  - **Acceptance:** one documented semantic model governs retries, fallback, and streaming.
  - **Verification:** timeout and wall-clock tests under Node 18/22/24.
  - **Dependencies:** Tasks 2.1, 4.1.
  - **Files:** `docs/api-reference.md`, `docs/observability.md`, policy/timeout types if additive changes are required.

### Phase 5 — Streaming migration

- [ ] **Task 5.1: Add async-iterable pipeline support**
  - Migrate `client.stream()` after complete parity is established.
  - Preserve chunk identity/order, lazy startup, first-chunk telemetry, consumer `break`, and exactly-once settlement.
  - **Acceptance:** no retry/fallback after any visible chunk; fallback obeys the same rule; cancellation and timeout remain responsive.
  - **Verification:** stream integration, execution-pipeline, tool-loop, and async-generator cleanup tests.
  - **Dependencies:** Tasks 3.1, 4.1–4.3.
  - **Files:** `src/core/execution/request-pipeline.ts`, `src/client/client.ts`, stream tests.

- [ ] **Task 5.2: Verify `streamText()` and `streamObject()` parity**
  - Confirm tool calls, structured validation, repair, usage, plugins, and terminal events use the successful attempt.
  - **Acceptance:** no public success event precedes a later public validation failure.
  - **Verification:** streamText/streamObject tests and lifecycle assertions.
  - **Dependencies:** Task 5.1.
  - **Files:** client stream helpers, structured output tests, plugin tests.

### Phase 6 — Deferred convergence and release

- [ ] **Task 6.1: Route multimodal calls through the executor**
  - Normalize cancellation/error classification first; decide explicitly whether multimodal calls receive budget/plugin lifecycle.
  - **Acceptance:** no broad accounting behavior is introduced without a pricing/semantics decision.
  - **Verification:** provider-specific multimodal tests and lifecycle tests.
  - **Dependencies:** Task 2.2 and a documented product decision.
  - **Files:** `src/client/client.ts`, multimodal execution tests.

- [ ] **Task 6.2: Final public/export decision**
  - Keep the execution contracts internal unless parity and consumer value justify stable exports.
  - Do not repurpose public `ExecutionPlan` types.
  - **Acceptance:** public API diff is minimal and documented.
  - **Verification:** declaration tests, `publint`, `check-package`, and package size.
  - **Dependencies:** Tasks 3–5.
  - **Files:** `src/index.ts`, package exports if needed, API docs.

- [ ] **Task 6.3: v3.2.0 release gate**
  - Update README, CHANGELOG, docs, examples, API/migration notes, version, and lockfile.
  - Run unit, integration, regression, security, typecheck, lint, benchmark, package, clean-install, and published-package verification.
  - Commit, tag `v3.2.0`, push the protected release branch, merge to `main`, create GitHub release, publish root npm package, and verify the clean install.
  - **Acceptance:** all mandatory lifecycle gates pass; coverage thresholds are not weakened.
  - **Dependencies:** Tasks 0.1–6.2.
  - **Files:** release metadata and documentation as appropriate.

## Checkpoints

- [ ] **Checkpoint A — Characterization:** baseline tests document lifecycle and fallback behavior.
- [ ] **Checkpoint B — Internal foundation:** context/result/ports compile without public changes.
- [ ] **Checkpoint C — Complete parity:** plain `complete()` has one pipeline and exact budget/error/event behavior.
- [ ] **Checkpoint D — Reliability fixes:** timeout, backoff, cancellation, and fallback decisions are explicit and tested.
- [ ] **Checkpoint E — Streaming parity:** stream, tools, and structured output remain behavior-compatible.
- [ ] **Checkpoint F — Release readiness:** full tests, audits, package checks, docs, and published-package smoke tests pass.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Timeout semantics change | Different wall-clock/retry behavior | Characterization tests, explicit decision, separate release notes |
| Error wrapping | Breaks `instanceof` and status handling | Retain/rethrow original errors in `ExecutionResult` |
| Event/plugin compatibility | Consumers observe missing/duplicated lifecycle events | Preserve names/order and add only additive fields |
| Budget accounting changes | Unexpected request/cost totals | One terminal action, idempotence tests, separate behavior commit |
| Fallback output duplication | Duplicate user/tool side effects | Track visible output and attempted candidates before fallback |
| Global circuit breaker change | Cross-client behavior changes | Do not change scope in v3.2 without explicit compatibility decision |
| Streaming generator cleanup | Leaks or premature settlement | Dedicated `return()`/consumer-break tests |
| Package size ceiling | Release build exceeds 1,900 KB | Run size gate per slice; no new runtime dependencies |
| Node 18/ESM compatibility | Published artifact fails supported runtimes | Test Node 18 locally and native ESM package install |
| Public API churn | Unnecessary breaking release | Keep new execution modules internal until parity |

## Open questions requiring a decision before implementation

1. `requestTimeoutMs` remains a whole logical-request deadline in v3.2.0; fallback candidates use the primary deadline as their parent signal.
2. Caller cancellation is a neutral terminal outcome and is not recorded as a circuit-breaker provider failure.
3. Fallback candidates are internal attempts under one logical request lifecycle; v3.2.0 preserves one plugin lifecycle and records the successful candidate.
4. Multimodal budget/pricing semantics remain explicitly deferred; v3.2.0 normalizes executor behavior without silently starting new billing.
5. Execution context/result types remain internal until parity and API review.
