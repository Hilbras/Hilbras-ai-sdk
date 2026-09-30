# Spec: v3.4.0 Security Enforcement Integrity

## Objective

Make the SDK's existing authorization and request-integrity controls actually
enforce, without changing behavior for operators who did not opt into them.

After v3.4.0:

- `config.rbac` and `SDKConfig.allowedTools` / `deniedTools` are live controls
  instead of declared-but-unread fields;
- RBAC evaluates a real request context, so a role's provider/model/tool
  restrictions are enforced instead of silently skipped;
- per-role rate limits and token budgets actually consume;
- malformed authorization policy is rejected as configuration, not silently
  treated as "no restrictions";
- the HMAC signer binds the request body in a profile that recomputes and
  verifies the digest from received bytes;
- a bounded replay guard enforces timestamp freshness and nonce uniqueness;
- middleware composition re-runs downstream stages on retry, so per-attempt
  signing and per-attempt guards are correct;
- streaming transports surface non-2xx responses instead of yielding an empty
  stream;
- `checkPermission`, `createRBACMiddleware`, `signingMiddleware`,
  `RequestSigner`, and all existing client configuration APIs remain available.

## Motivation

A read-only audit of `src/security/` against the v3.3.0 baseline found that the
two headline security features are non-functional in shipped code paths.

### RBAC (`src/security/rbac.ts`)

| # | Severity | Defect | Evidence |
|---|---|---|---|
| R1 | Critical | `getUserId` never resolves the role. `roleId` is always `config.defaultRole ?? "default"`, so per-user privilege separation is impossible. | `rbac.ts:140-144` |
| R2 | Critical | The permission check is unreachable. `provider` is read from the wire body, but no adapter sends `provider` in the body, so `if (provider && model)` is never true. | `rbac.ts:156-167`, `adapters/openai.ts:72-77` |
| R3 | High | Per-role rate limiting is a no-op. `limiter.acquire()` never decrements tokens; only `consume()` does. The 429 branch is unreachable. | `rbac.ts:189`, `rate-limiter.ts:101-114` |
| R4 | High | A missing role fails open. A `defaultRole` typo silently disables all enforcement with no error. | `rbac.ts:143-149` |
| R5 | High | `SDKConfig.rbac` is accepted by the resolver, never validated, and never read by the client. | `config-schema.ts:69,98`; no `.rbac` read in `src/` |
| R6 | High | `SDKConfig.allowedTools` / `deniedTools` are declared and overlap-checked but never enforced. | `config-resolver.ts:149-155`; no enforcement read |
| R7 | Medium | Malformed policy fails open (`allowedProviders: {}`) or throws an uncaught `TypeError` (`allowedModels: "gpt-4o"`). Never a 403. | `rbac.ts:64,74` |
| R8 | Medium | `maxBudgetPerSession` is declared and never read. | `rbac.ts:22-23` |
| R9 | Medium | Denials are logged without `userId` or `role`, so denial forensics is impossible. | `rbac.ts:170-175` |
| R10 | Medium | On the streaming path a 403/429 body is returned as the SSE stream, so a denial is indistinguishable from an empty completion. | `transport/middleware-transport.ts:41-52` |
| R11 | Low | A throwing `getUserId` propagates unhandled and is amplified by a preceding retry stage. | `rbac.ts:140` |

### Request signing (`src/security/request-signer.ts`)

| # | Severity | Defect | Evidence |
|---|---|---|---|
| S1 | High | The signature does not authenticate the body. `bodyHash` is computed and written to the unsigned `x-content-sha256` header, but the canonical signing string is built from `config.headers` only. | `request-signer.ts:96-112` |
| S2 | High | `verify()` never reads its `body` parameter and trusts the received `x-content-sha256` header, so header substitution defeats any attempt to opt into body binding. No configuration fixes S1. | `request-signer.ts:139-167` |
| S3 | High | No replay protection anywhere: no timestamp window, no nonce, no sequence number, no seen-signature cache. | `request-signer.ts:139-178`; no nonce symbol in `src/` |
| S4 | High | `composeMiddlewares` uses a monotonic cursor, so any middleware after a retry stage is skipped on every later attempt. A signature computed at T0 is reused unchanged for attempts 2..N. | `middleware/middleware.ts:19-23,57-67` |
| S5 | Medium | `FormData` bodies hash to the constant string `"[object FormData]"`, so `x-content-sha256` is identical for every upload. | `request-signer.ts:186`; `adapters/openai.ts:489,513` |
| S6 | Medium | `sign()` lowercases every input header and the middleware merges them over un-normalized originals, producing both `Content-Type` and `content-type` on the wire. | `request-signer.ts:88-92,123,196` |
| S7 | Medium | `keyId` is not covered by the HMAC, and the `signatureInput` string that would bind it is returned but never emitted as a header. | `request-signer.ts:120,125-127` |
| S8 | Low | `new Date().toUTCString()` has one-second resolution, so same-second requests to the same path share a signature. | `request-signer.ts:82,187` |
| S9 | Low | A `sha512` signer emits a header named `x-content-sha256` that is not a SHA-256 digest. | `request-signer.ts:100-102` |

`signingMiddleware` and `RequestSigner.verify` have zero internal call sites, so
the SDK itself signs and verifies nothing today.

## Capability map

| Module | Responsibility | Depends on |
|---|---|---|
| `authorization-contracts` | Role/policy types, enforcement modes, request context, diagnostics, policy validation | `config-schema` |
| `authorization-resolver` | Role resolution, provider resolution from URL, model/tool/token extraction, policy evaluation | `authorization-contracts` |
| `rbac-enforcement` | Rewrite the RBAC middleware so it enforces; rate limiting, budget, audit attribution | `authorization-resolver` |
| `client-authorization` | Wire `config.rbac`, `allowedTools`, `deniedTools` into the client; provider-URL binding; tool policy enforcement | `rbac-enforcement` |
| `signing-profiles` | `v1` (frozen) and `v2` (body-bound, nonce, key-id authenticated) signature profiles | — |
| `replay-guard` | Bounded nonce cache plus timestamp-window verification | `signing-profiles` |
| `transport-integrity` | Correct middleware composition, streaming error propagation, header normalization | `signing-profiles` |
| `compat-docs` | Deprecations, migration guide, security documentation, release records | all prior modules |

Build order:

```text
authorization-contracts
        ↓
authorization-resolver
        ↓
rbac-enforcement
        ↓
client-authorization
        ↓
signing-profiles → replay-guard → transport-integrity
        ↓
compat-docs
```

## Assumptions

1. v3.4.0 is a minor release. No public export is removed. `checkPermission`,
   `createRBACMiddleware`, `RequestSigner`, `signingMiddleware`, and every v3.3
   configuration entry point keep their existing call signatures.
2. `checkPermission` keeps its current semantics for well-formed roles, including
   "a role with no declared restrictions allows everything". The existing unit
   tests in `tests/security/rbac.test.ts` remain valid.
3. Signature profile `v1` is frozen and byte-compatible. Profile `v2` is the
   correct implementation and is opt-in in v3.4.0. Flipping the default is
   deferred to v4.0.0 because it changes the signature wire format.
4. RBAC `enforcement` defaults to `"permissive"`, which preserves the v3.3
   observable behavior for unresolvable request contexts. `"strict"` is
   opt-in.
5. A usable resolved configuration may still contain credentials. New
   authorization diagnostics are redacted and never contain secret values.
6. No new runtime dependencies are introduced.

## Design

### 1. Authorization contracts

New module `src/security/authorization.ts` owns the policy vocabulary.

```ts
export type AuthorizationEnforcement = "permissive" | "strict";

export interface RBACRole {
  name: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  maxTokensPerRequest?: number;
  maxBudgetPerSession?: number;
  rateLimit?: { maxRequests: number; windowMs: number };
  allowedTools?: string[];   // new
  deniedTools?: string[];    // new
}

export interface RBACConfig {
  roles: Record<string, RBACRole>;
  defaultRole?: string;
  enforcement?: AuthorizationEnforcement;  // new, default "permissive"
}

export interface RBACRequestContext {
  provider: string;
  model: string;
  tokenCount?: number;
  toolName?: string;
}

export type AuthorizationDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; status: 403 | 429; reason: string; retryAfterMs?: number }
  | { outcome: "diagnostic"; code: string; message: string; severity: "info" | "warning" | "error" };

export interface AuthorizationOptions {
  enforcement?: AuthorizationEnforcement;
  resolveRole?: (ctx: MiddlewareContext) => string | null | undefined;
  resolveRequest?: (ctx: MiddlewareContext) => RBACRequestContext | null | undefined;
  auditLogger?: AuditLogger;
  rateLimiters?: RateLimiterRegistry;
  now?: () => number;
  onDiagnostic?: (d: AuthorizationDiagnostic) => void;
}
```

`RBACRole` and `RBACConfig` are re-declared as extensions of the v3.3 shapes so
existing annotations keep compiling. `src/security/rbac.ts` re-exports them.

### 2. Request-context resolution (fixes R2)

`provider` is absent from every adapter's wire body, so provider identity is
resolved from the request URL instead:

1. the client passes a lazy `resolveProviderByUrl: (url) => string | null`
   backed by a new `ProviderRegistry.findByUrl()`;
2. the default `resolveRequest` asks that callback for the provider name, then
   reads `model`, `max_tokens`, and any tool name from a JSON body;
3. when the body is not JSON, or the provider cannot be resolved, the context is
   `null` and the outcome is `diagnostic` (permissive) or `deny` (strict).

A caller who routes non-SDK traffic through the middleware can supply an
explicit `resolveRequest`.

### 3. Role resolution (fixes R1)

`resolveRole` is optional. When omitted, the middleware falls back to
`config.defaultRole ?? "default"`, which is exactly the v3.3 behavior. When
supplied, the returned role name is looked up in `config.roles`; an unknown name
produces a diagnostic or, in strict mode, a 403.

### 4. Enforcement semantics (fixes R4, R7, R11)

| Situation | `permissive` (default) | `strict` |
|---|---|---|
| Role found, all checks pass | allow | allow |
| Role found, provider/model/tool denied | 403 | 403 |
| Role found, token or budget exceeded | 403 | 403 |
| Role found, rate limit exceeded | 429 + `Retry-After` | 429 + `Retry-After` |
| No identity and no resolvable role | diagnostic, allow | 403 |
| `defaultRole` names a role that does not exist | diagnostic, allow | 403 |
| `resolveRole` or `resolveRequest` throws | diagnostic, allow | 403 |
| Malformed role policy | diagnostic, allow | 403 |

Malformed policy is additionally rejected at configuration time (see §6), so a
deny caused by malformed policy is a defense-in-depth path, not the normal one.

### 5. Rate limit and budget (fixes R3, R8)

- Rate limiting calls `consume()` semantics: the token bucket is decremented on
  an allowed decision, so the 429 branch becomes reachable. The bucket key is
  `rbac:<userId>:<role>`, so two roles for one user get independent limits.
- `maxBudgetPerSession` is enforced through the client's existing
  `BudgetTracker` by exposing a per-role budget view. If a role declares a
  budget and the client has no budget tracker, the decision is a `diagnostic`
  (permissive) or a deny (strict) stating that no budget tracker is available.
  The SDK does not silently claim a budget is enforced when it is not.

### 6. Configuration validation (fixes R5, R6, R7)

`validateValues()` in `src/config/config-resolver.ts` gains RBAC validation that
emits **error** diagnostics, so the strict resolver rejects a malformed policy at
client construction instead of at request time:

- every value in `roles` is an object with a non-empty `name` matching its key;
- `allowedProviders`, `allowedModels`, `allowedTools`, `deniedTools` are arrays
  of non-empty strings;
- `maxTokensPerRequest` and `maxBudgetPerSession` are finite and non-negative;
- `rateLimit` is an object with `maxRequests >= 1` and `windowMs >= 1`;
- `allowedTools` and `deniedTools` do not overlap within a role;
- `enforcement` is `"permissive"` or `"strict"`;
- if `defaultRole` is set, it must exist in `roles` (this is the R4 typo guard).

`SDKConfig.allowedTools` / `deniedTools` become enforced by the client through a
`ToolPolicy` consulted before every tool execution, with role-level tool lists
narrowing the client-level lists. The resolver's existing overlap check is kept.

### 7. Client wiring (fixes R5, R6)

- `HilbrasClient` composes an authorization middleware ahead of any
  user-supplied `middleware` when `resolvedSdk.rbac` is present.
- The middleware reads the client's provider registry lazily, so providers
  registered by `addProvider()` after construction are covered.
- The client exposes `getAuthorizationDiagnostics()` returning the redacted,
  ordered decision log for the most recent decisions.
- Tool policy is applied in the shared tool-execution path used by
  `ToolLoopAgent` and by `client.complete()` when tools are supplied.

### 8. Signing profiles (fixes S1, S2, S5, S6, S7, S8, S9)

`RequestSignerConfig` gains:

```ts
profile?: "v1" | "v2";   // default "v1"
nonceHeader?: string;    // default "x-hilbras-nonce"
```

- `v1` is frozen and byte-compatible with v3.3.0, including the
  `x-content-sha256` header and its `String(FormData)` behavior. It is marked
  `@deprecated` in documentation only; no runtime warning is emitted.
- `v2` is correct:
  - the body digest, the key id, and the nonce are all bound into the canonical
    signing string;
  - the digest is emitted as `x-hilbras-content-digest` (correctly named, and
    not emitted at all when the body cannot be read);
  - `verify()` recomputes the digest from the received body bytes and rebuilds
    the canonical string from scratch, never trusting a received digest header;
  - `sign()` accepts `string | Uint8Array`, and `signingMiddleware` never
    string-coerces a `FormData`; an unreadable body omits the digest and records a
    diagnostic rather than emitting a constant one;
  - a per-sign nonce is generated unless supplied.

`signingMiddleware` normalizes the outgoing header bag to a single lowercase
key set before merging signed headers, so no duplicate-case headers are
produced.

### 9. Replay guard (fixes S3)

New export `ReplayGuard`:

```ts
export interface ReplayGuardOptions {
  maxAgeMs?: number;   // default 300_000
  maxSkewMs?: number;  // default 30_000
  maxEntries?: number; // default 10_000, bounded FIFO eviction
  now?: () => number;
}
export class ReplayGuard {
  verify(headers: Record<string, string>, signature: string): { valid: boolean; reason?: string };
}
```

`RequestSigner.verifyFresh()` composes signature verification with a `ReplayGuard`
and returns a discriminated result. The guard is opt-in and holds no unbounded
state.

### 10. Transport integrity (fixes S4, R10)

- `composeMiddlewares` becomes a recursive compose where each `next()` call
  re-enters at the following index, so downstream stages re-run per retry
  attempt. The current monotonic cursor is the bug that skips signing on
  attempts 2..N.
- `MiddlewareTransport.stream` checks `res.ok` before extracting the body and
  throws `ProviderRequestError` with the status, so a 403/429 is not delivered as
  an empty SSE stream.
- `signingMiddleware` normalizes header casing (S6).

## Compatibility contract

Exactly one intentional behavior change is accepted in v3.4.0:

> A client constructed with a malformed `config.rbac` now throws during
> construction instead of silently ignoring the policy.

`config.rbac` has never been read by any code in any released version, so no
operator can be relying on its current behavior. The change surfaces their
misconfiguration with an actionable diagnostic. The migration guide documents it.

Everything else is either an internal fix that cannot change an
operator-observable result, or is gated behind an opt-in:

| Change | Gating |
|---|---|
| RBAC evaluates a real provider/model context | Only when `rbac` is configured |
| Rate limits actually consume | Only when a role declares `rateLimit` |
| `defaultRole` typo rejected | Only when `rbac` is configured |
| `allowedTools` / `deniedTools` enforced | Only when the lists are non-empty |
| Middleware re-runs downstream on retry | Only affects chains containing a retry stage |
| Streaming non-2xx throws | Only affects non-2xx responses reaching the stream path |
| Body-bound signatures, nonce, key-id binding | Opt-in via `profile: "v2"` |
| Replay protection | Opt-in via `verifyFresh()` / `ReplayGuard` |
| `strict` enforcement | Opt-in via `enforcement: "strict"` |

## Non-goals for v3.4.0

Deferred, with reasons:

1. **Framework route authorization and body limits.** `createChatHandler` and its
   Astro/Remix siblings trust caller-supplied `body.tools`, `body.model`, and
   `body.maxSteps`, and apply no authentication or body-size limit. Fixing this
   requires a route-security design and companion-package releases
   (`@hilbras/nextjs`, `@hilbras/react`, `@hilbras/ui`), so it is scoped to
   v3.5.0 rather than silently changing a permissive default here.
2. **`node:crypto` in the package barrel.** `request-signer.ts` imports
   `node:crypto` and is re-exported from the root entry, which breaks edge and
   browser bundling. This needs a WebCrypto implementation and an injected-hmac
   contract; scoped to v3.5.0.
3. **Browser credential isolation.** Server secrets reachable from client
   bundles remains an open architectural question.
4. **DNS and egress SSRF controls.** `validateBaseUrl` inspects the URL string
   but does not resolve DNS or constrain egress.
5. **Agent approval and runtime schema enforcement.** The tool-loop approval
   callback currently defaults to approved.
6. **Flipping the default signature profile to `v2`.** Scheduled for v4.0.0
   together with removal of `v1`.
7. **Coverage thresholds.** Unmet and unchanged.

## Verification requirements

- Existing `tests/security/rbac.test.ts` and `tests/security-hardening.test.ts`
  continue to pass; signature tests that assume the `v1` wire format are pinned
  to `v1` explicitly rather than deleted.
- New tests demonstrate each audited defect is closed: unreachable RBAC check
  (R2), no-op rate limiter (R3), silent role typo (R4), unread `config.rbac`
  (R5), unenforced tool lists (R6), malformed policy (R7), unenforceable budget
  (R8), unattributed denials (R9), swallowed 403 (R10), unhandled identity
  errors (R11), unsigned body (S1), trusted digest header (S2), replay (S3),
  stale signature across retries (S4), `FormData` digest (S5), duplicate header
  case (S6), unauthenticated key id (S7), timestamp collision (S8), and the
  misleading digest header name (S9).
- Full release lifecycle as in v3.3.0: implementation, tests, audit, docs,
  version bump, commit, tag, GitHub release, npm publish, clean install, and
  published-package verification.
- Coverage thresholds are not lowered. No provider adapter, catalog, or public
  execution contract is removed.
