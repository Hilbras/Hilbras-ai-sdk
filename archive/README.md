# archive/

Historical process documents — audits, upgrade plans and fix plans from earlier
phases. **None of these are current documentation.** They are kept because they
record what was decided and why at the time, which is worth more than a tidy
repository root.

| File | Phase | Superseded by |
|------|-------|---------------|
| `HILBRAS-SDK-DEEP-CODEBASE-AUDIT.md` | pre-v1.1 codebase audit | — |
| `v1.1.0-AUDIT-FIX-PLAN.md` | v1.1.0 remediation plan | — |
| `HILBRAS-SDK-UPGRADE-PLAN.md` | v2.x upgrade strategy | — |
| `HILBRAS-SDK-FULL-AUDIT.md` | v3.3.0 / v3.4.0 audit | `SPEC-v3.4.0-security.md`, `tasks/v3.5.0-todo.md` |

## Current documentation

| What | Where |
|------|-------|
| Getting started | `docs/getting-started.md` |
| Frameworks, route security | `docs/frameworks.md` |
| Security model | `docs/security.md` |
| Full export list | `docs/api-reference.md` |
| What is in flight | `tasks/v3.5.0-todo.md` |
| Release notes | `CHANGELOG.md` |

These files mention packages that no longer exist — `@hilbras/next` and
`@hilbras/react` were folded into `@hilbras/sdk` in 3.5.0, and are now the
`@hilbras/sdk/nextjs/api`, `@hilbras/sdk/nextjs/edge` and
`@hilbras/sdk/react-client` subpaths. Read them for the reasoning, not for
current API surfaces.
