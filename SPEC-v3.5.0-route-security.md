# SPEC — v3.5.0 Framework Route Security

**Status:** implemented on `release/v3.5.0`, PR-ready. Not merged, not tagged, not
published.

**Objective.** Give the shipped framework handlers an authentication
extension point, an explicit allowlist for caller-supplied fields, and bounded
request limits — and close the rate-limit bypass that shipped in the
`@hilbras/next` workspace package, which is the same defect class (a
caller-supplied value treated as authoritative).

## Why this phase exists

v3.4.0 closed twenty findings inside the SDK core. Framework route auth was
explicitly deferred to v3.5.0 because the shared handler core (`v3.4.4`) did not
exist yet. Two items from the v3.4.0 deferred list are also in scope because
they are the same bug class and shipping the SDK half alone would leave a known
live instance of it.

## Scope

### In scope — `@hilbras/sdk`, minor bump to 3.5.0

| Item | Change | Semver |
|------|--------|--------|
| S1 | `onRequest` hook on all six handler factories | additive |
| S2 | `onError` hook on all six handler factories | additive |
| S3 | `trustClientFields` allowlist | additive, default preserves v3.4 |
| S4 | `limits` — `maxBodyBytes`, `maxMessages`, `maxTools`, clamps on `maxSteps` / `maxTokens` / `temperature` | additive |
| S5 | `ServerHilbrasClient` / `createServerClient` deprecated | deprecation notice only |

### In scope — folded from `@hilbras/next` into `@hilbras/sdk`

`@hilbras/next` was never published to npm (only `@hilbras/sdk` exists there),
so its code moves into the SDK under two new subpaths and the workspace package
is removed. Nothing to migrate for an installed user; the source moves.

| Item | Change | Semver |
|------|--------|--------|
| N1 | `hilbrasMiddleware` keys on a trusted `x-forwarded-for` entry (`trustProxy`) instead of the leftmost | **behaviour change**, security fix |
| N2 | Fallback chain: trusted `x-real-ip` → `fallbackKey` → shared `unidentified` bucket; `request.ip` deliberately not trusted | **behaviour change**, security fix |
| N3 | Pluggable `store` so the limit is shared across instances | additive |
| N4 | `stream.ts` gains its first tests (199 lines, previously zero) | test-only |
| N5 | `@hilbras/sdk/nextjs/api` and `@hilbras/sdk/nextjs/edge` subpaths | additive |

**Why the subpath split.** Both modules were typed against `next/server`. The
SDK cannot import that: `next` is an optional peer, and the package must build
and typecheck in a project that has never installed it. So the surface these
helpers actually use — `request.json()`, `request.signal`, `request.headers`,
`request.nextUrl.pathname`, `NextResponse.json`/`.next` — is declared
structurally in `src/frameworks/nextjs/next-runtime.ts`, which every real Next
type satisfies. Verified by a clean install with `next` deleted from
`node_modules`: `@hilbras/sdk/nextjs` and `@hilbras/sdk/nextjs/edge` both import
and both enforce their behaviour.

They are split into two subpaths rather than one because the two audiences
differ: `/api` is for route handlers, `/edge` for `middleware.ts`. Neither
imports `next/server`, so `@hilbras/sdk/nextjs` keeps resolving in a project
with no Next dependency.

### Explicitly out of scope

- **`@hilbras/react` browser inference.** `useChat` / `useCompletion` call
  `client.stream()` directly and have no route-based mode, so a browser-side
  client holding an API key is the designed usage. Making it safe means making
  `client` conditionally optional in the public hook types — a breaking change
  that cannot ride in a minor release. Deferred to v4.0.0 with a design note.
- The `trustClientFields` default flip for Next.js (`true` → `false`). Deferred
  to 4.0.0.
- The signature-profile default flip to `v2`. Deferred to 4.0.0 (v3.4.0 decision).

## Compatibility contract

1. **No existing request changes behaviour.** Every new option defaults to the
   pre-3.5.0 value. A caller who passes none of them gets byte-identical
   responses.
2. **`trustClientFields` defaults differ per adapter family, by design.**
   `createChatHandler` / `createCompletionHandler` default `true` because those
   have always read `model`, `tools`, `maxSteps`, `temperature` and `maxTokens`
   from the body. `createChatEndpoint` / `createChatAction` and their completion
   forms default `false` because those have never read those fields — verified
   against `f5f9bac`, where the Astro and Remix adapters contain only
   `model: options.model`. Defaulting them to `true` would have widened caller
   influence in a hardening release, which is the opposite of the phase's intent.
3. **N1/N2 are deliberate behaviour changes.** A deployment that relied on the
   old keying — a single client rotating `x-forwarded-for`, or multiple
   anonymous clients sharing one bucket — will see different limiting. Both
   changes move toward *more* limiting, never less. Migration is one line: set
   `trustProxy` to the proxy count. This affects `@hilbras/next` users, who are
   source consumers only: the package was never on npm.
4. **No new runtime dependencies.** Both packages remain dependency-free.

## Limits defaults

Chosen above any realistic request so that leaving `limits` unset bounds the
worst case without altering a normal call:

| Option | Default | Rationale |
|--------|---------|-----------|
| `maxBodyBytes` | 1 MiB | A 200-message chat with long tool schemas stays well under. |
| `maxMessages` | 200 | Above any real conversation. |
| `maxTools` | 64 | Above any realistic function-calling surface. |
| `maxStepsClamp` | 25 | Client-side tool loop bound. |
| `maxTokensClamp` | 32768 | Above every current provider ceiling. |
| `temperatureClamp` | `[0, 2]` | Every provider rejects outside this. |

## Verification contract

Guards are proven load-bearing by mutation, not by passing:

- `tools/mutation-frameworks.sh` — 10 mutations over the shared core and the
  Next.js adapter. All 10 killed.
- `tools/mutation-next-middleware.sh` — 8 mutations over the middleware, plus 1
  verified equivalent mutant. All 8 killed, and all 8 still killed after the
  module moved into the SDK.
- `tools/mutation-next-stream.sh` — 15 mutations over `stream.ts`. All 15
  killed, before and after the move.

Every suite must be green at baseline before any mutation is applied, and the
source is restored from a pre-run snapshot on exit.
