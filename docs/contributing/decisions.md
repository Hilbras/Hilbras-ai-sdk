# Decisions

Significant design decisions in `@hilbras/sdk` are captured as **Architecture Decision Records (ADRs)** in the [`architecture/`](../../architecture/) directory at the root of the repo.

If you're wondering *why* a piece of code looks the way it does — why the budget callback fires `warning` before `exceeded`, why `_totalEstimated` is decremented in `release()` but not in `settle()`, why the streaming path reserves budget before any provider call — the answer is probably in an ADR.

## Where to start

- Read [`architecture/README.md`](../../architecture/README.md) for the process.
- See [`architecture/0001-adopt-architecture-decision-records.md`](../../architecture/0001-adopt-architecture-decision-records.md) for the meta-decision that started the practice.

## When to write a new ADR

Write an ADR when the decision:

- is hard or expensive to reverse (type-system invariants, public API surface, security posture);
- has been the subject of debate or a non-obvious trade-off;
- or will surprise a future reader who didn't live through the discussion.

Don't write one for routine bug fixes, test additions, or small cleanups.

## How to propose an ADR

1. Open a PR that adds the file under `architecture/` with status **Proposed**.
2. Reference the PR in the description so reviewers can find it.
3. Once merged, the ADR is **Accepted** and the codebase is expected to reflect the decision.
