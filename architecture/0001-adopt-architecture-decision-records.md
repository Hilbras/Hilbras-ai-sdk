# 0001 — Adopt Architecture Decision Records

**Status:** Accepted
**Date:** 2026-08-27
**Authors:** Hilbras maintainers

## Context

`@hilbras/sdk` has grown from a single ~50-file codebase at v0.1 to a 51-file, 878-test codebase at v0.9.3. Recent audit cycles closed 6 P0 defects and exposed several places where the *why* of a design choice is not obvious from reading the code: why is `_totalEstimated` decremented in `release()` but not in `settle()`? why does the budget callback fire `warning` before `exceeded`? why is the circuit-breaker a global singleton? why does the streaming path reserve budget the way it does?

New contributors and future maintainers currently have to reverse-engineer these decisions from the commit history and PR discussions, both of which decay. There is no in-repo record of *why* a decision was made, only *that* it was made. We need a durable, lightweight mechanism for capturing design rationale alongside the code it explains.

## Decision

We adopt **Architecture Decision Records (ADRs)** as the canonical mechanism for documenting significant design decisions in `@hilbras/sdk`.

An ADR is a short Markdown file in `architecture/` that captures:

- the **context** that forced the decision (what problem were we solving? what constraints applied?);
- the **decision** itself, stated clearly enough to be quoted later;
- the **consequences** (what becomes easier, what becomes harder, what trade-offs we accept);
- the **alternatives** we considered and why we rejected them.

ADRs are numbered sequentially. They are immutable once accepted; if a decision is reversed, a new ADR is written that supersedes the old one. The old ADR is preserved for history but marked Superseded.

The process is captured in `architecture/README.md`. The contributor-facing entry point is `docs/contributing/decisions.md`.

## Consequences

**Easier:**
- New contributors can read the ADR for a subsystem and understand the constraints that shaped it, rather than re-deriving them from the code.
- Code reviewers can find the rationale for a pattern they don't recognize instead of trusting their gut.
- Future maintainers (including future-us) have a written record of trade-offs that survive staff turnover.
- The conversation about "should we change X?" can start with "ADR NNNN says X for these reasons; do those reasons still apply?" rather than re-litigating from scratch.

**Harder:**
- One more process to maintain. ADRs that go stale (referenced code paths that have moved) are worse than no ADR at all.
- A small writing tax on every significant change. We accept this tax as the cost of leaving a trail.
- The temptation to over-document. The bar is "this is hard or expensive to reverse," not "I have an opinion." Routine refactors don't need ADRs.

**Trade-offs accepted:**
- ADRs are written in prose, not enforced by tooling. Stale ADRs are a content-rot problem we manage by hand.
- We are deliberately not adopting the "every PR needs an ADR" model. The discipline is "write one when the decision is significant," not "write one for everything."

## Alternatives considered

**Inline `// @decision` comments in code.** Rejected: comments decay with the code, are not greppable across files, and don't have a stable URL a reviewer can link to. ADRs are first-class files with a numbering scheme.

**External wiki / Notion page.** Rejected: requires a third-party tool, drifts from the code, and is not greppable in the same workflow as `git blame`. ADRs live next to the code they describe.

**GitHub Issues / Discussions.** Rejected: issues and discussions are time-ordered and transient. ADRs are decision-ordered and durable. A decision made today should still be findable in five years.

**Wiki-style design docs (one big file).** Rejected: a single document doesn't survive the addition of new decisions cleanly. Numbered ADRs scale.

## See also

- `architecture/README.md` — the process and template.
- `docs/contributing/decisions.md` — contributor-facing pointer.
- v0.9.3 release notes (CHANGELOG.md) — the six P0 decisions that future ADRs will document in detail.
