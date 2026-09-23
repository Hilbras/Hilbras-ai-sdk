# v3.2.0 Task List

See [`tasks/plan.md`](plan.md) for architecture decisions, acceptance criteria, dependencies, and verification commands.

## Phase 0 — Characterization

- [x] 0.1 Add execution lifecycle characterization tests
- [ ] 0.2 Add retry/fallback characterization matrix

## Phase 1 — Internal contracts

- [x] 1.1 Add `RequestContext` and `ExecutionResult`
- [x] 1.2 Define injected execution ports

## Phase 2 — One-attempt execution

- [x] 2.1 Add disposable internal timeout primitive
- [x] 2.2 Extract `RequestExecutor`

## Phase 3 — Non-streaming pipeline

- [x] 3.1 Extract `RequestPipeline` for plain `complete()`
- [ ] 3.2 Migrate structured `complete()`

## Phase 4 — Reliability correctness

- [ ] 4.1 Make backoff cancellation-aware
- [ ] 4.2 Correct fallback activation and isolation
- [ ] 4.3 Decide and document timeout semantics

## Phase 5 — Streaming

- [ ] 5.1 Add async-iterable pipeline support
- [ ] 5.2 Verify `streamText()` and `streamObject()` parity

## Phase 6 — Convergence and release

- [ ] 6.1 Route multimodal calls through the executor or document deferral
- [ ] 6.2 Make the public/export decision
- [ ] 6.3 Complete the v3.2.0 release gate

## Checkpoints

- [ ] A — Characterization baseline
- [ ] B — Internal foundation
- [ ] C — Complete parity
- [ ] D — Reliability decisions
- [ ] E — Streaming parity
- [ ] F — Release readiness
