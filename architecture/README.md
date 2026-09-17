# Architecture

This directory captures architectural decisions and design rationale for `@hilbras/sdk`. The goal is to make the *why* as discoverable as the *what*.

## What lives here

- **`0001-adopt-architecture-decision-records.md`** — the meta-ADR that establishes this process.
- Future ADRs numbered sequentially (e.g. `0002-…`, `0003-…`).
- Long-form design docs for the major subsystems (cost/budget, reliability pipeline, security, model routing).

## When to write a new ADR

Write an ADR when the decision:

- is hard or expensive to reverse (e.g. type-system invariants, public API surface, security posture);
- has been the subject of a debate or a non-obvious trade-off;
- or will surprise a future reader who didn't live through the discussion.

Don't write an ADR for every refactor. Routine bug fixes, test additions, and small cleanups don't need one.

## Status values

- **Proposed** — under discussion.
- **Accepted** — implemented; the codebase reflects the decision.
- **Superseded** — replaced by a later ADR. Keep the original for history; link the successor in the body.
- **Deprecated** — once-implemented, now reversed. Link the reversal ADR.

## Audience

- A maintainer trying to understand *why* the code is the way it is.
- A reviewer trying to evaluate a PR that touches the same area.
- A future you, six months from now, wondering "what were we thinking."

## Conventions

- One decision per ADR.
- Use the template below.
- Number sequentially. Don't reuse numbers.
- When superseding, keep the original. Don't rewrite history.

```markdown
# NNNN — Title

**Status:** Proposed | Accepted | Superseded by NNNN | Deprecated
**Date:** YYYY-MM-DD
**Authors:** …

## Context

What's the situation? What forces are at play?

## Decision

What did we choose? State it clearly.

## Consequences

What becomes easier? What becomes harder? What trade-offs are we accepting?

## Alternatives considered

What else did we weigh, and why did we reject it?
```

## See also

- `docs/contributing/decisions.md` — a pointer for contributors who don't read `architecture/` first.
