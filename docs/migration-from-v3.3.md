# Migration from v3.3 to v3.4

v3.4 makes the SDK's authorization and request-integrity controls actually
enforce. No public export is removed, and one behavior change is intentional.

## The one behavior change

> A client constructed with a malformed `config.rbac` block now throws during
> construction instead of silently ignoring the policy.

`config.rbac` has never been read by any released version of the SDK. Setting it
did nothing and produced no warning, so the policy was never in effect and
nothing could depend on it. Malformed policies are now rejected with a
diagnostic naming the offending field:

```typescript
new HilbrasClient({
  config: { rbac: { roles: { v: { name: "v", allowedModels: "gpt-4o" } } } },
});
// ConfigurationError: rbac.roles.v.allowedModels must be an array of non-empty strings
```

A common cause of the old silent failure was a `defaultRole` typo. That is now
caught explicitly:

```typescript
new HilbrasClient({
  config: { rbac: { roles: { viewer: { name: "viewer" } }, defaultRole: "viewr" } },
});
// ConfigurationError: rbac.defaultRole: defaultRole "viewr" is not defined in rbac.roles
```

## Changes that only affect opted-in behavior

Nothing below changes for a client that does not configure the relevant feature.

| Change | Applies when |
|---|---|
| RBAC evaluates a real provider/model context | `rbac` is configured |
| Rate limits actually consume tokens | a role declares `rateLimit` |
| `defaultRole` typo is rejected | `rbac` is configured |
| `allowedTools` / `deniedTools` are enforced | either list is non-empty |
| Middleware re-runs downstream stages on retry | the chain contains a retry stage |
| Streaming non-2xx throws instead of an empty stream | a non-2xx reaches the stream path |
| Body-bound signatures, key-id binding, nonce | `profile: "v2"` |
| Replay protection | `verifyFresh()` / `ReplayGuard` |
| Fail-closed authorization | `enforcement: "strict"` |

### Rate limits now work

`role.rateLimit` previously called `acquire()`, which by design never
decremented the bucket, so the 429 branch was unreachable. It now consumes. If
you declared a rate limit and never saw a 429, you will start to. The bucket is
keyed `rbac:<userId>:<role>`, so two roles for one caller get independent limits.

### `allowedTools` / `deniedTools` are enforced

These configuration fields were declared and overlap-checked but read by
nothing. The client now rejects a request that names a denied tool, and
`ToolLoopAgent` refuses to execute one:

```typescript
const agent = new ToolLoopAgent({
  provider, model, tools, llm,
  toolPolicy: client.getToolPolicy(), // opt in to the same policy
});
```

An empty or absent allow-list still permits every tool, so a client that never
set these fields is unaffected.

### Middleware ordering with retries

`composeMiddlewares` used a shared monotonic cursor. Once a stage called `next()`
more than once — `retryMiddleware` does — every stage after it was skipped on
all later attempts. Composition now re-enters per attempt:

```typescript
// Before: signed once at T0, then attempts 2..N were sent unsigned.
// After: each attempt is signed with a fresh timestamp and nonce.
composeMiddlewares(retryMiddleware(2), signingMiddleware(signer));
```

If you relied on a post-retry stage running only once, that was the bug, not the
intent; check for stages that are not safe to repeat.

### Streaming errors

`MiddlewareTransport.stream` now throws `ProviderRequestError` for a non-2xx
response instead of returning the error body as the stream. A 403 from a
middleware used to surface as a silent empty completion. If you were treating
empty streams as a normal outcome, handle the error instead.

## Moving to the `v2` signature profile

`v1` is the default and is unchanged, so nothing breaks by staying. `v1` does
not authenticate the request body: the body digest is emitted as
`x-content-sha256` but is not part of the signed canonical string, and `verify()`
reads a received digest header rather than recomputing it. `v2` binds the body,
the key id, and a nonce, and recomputes the digest from the received bytes.

```typescript
const signer = new RequestSigner({
  secret: process.env.GATEWAY_SECRET!,
  keyId: "key-2026-09",
  profile: "v2",
});
```

When you move, the verifier must change with it. `v2` verification requires:

- the body bytes, so the digest can be recomputed;
- the nonce, read from `x-hilbras-nonce` (or passed explicitly);
- a `x-hilbras-key-id` header that matches the verifying signer's `keyId`, if
  one is configured.

The `x-hilbras-content-digest` header is emitted instead of `x-content-sha256`,
and is omitted entirely for a body that cannot be read, such as `FormData`.

## Adding replay protection

No profile provides replay protection. Add it on the receiving side:

```typescript
import { ReplayGuard } from "@hilbras/sdk";

const guard = new ReplayGuard({ maxAgeMs: 5 * 60_000, maxSkewMs: 30_000 });
const verdict = signer.verifyFresh(url, { method, body, headers }, signature, { guard });
if (!verdict.valid) return new Response(verdict.reason, { status: 401 });
```

The seen-signature cache is bounded (10,000 entries by default) and evicts
oldest-first, so `maxAgeMs` rather than cache size is the binding freshness
limit.

## Adopting strict enforcement

`enforcement` defaults to `"permissive"`, which allows a request whose context
cannot be resolved and records a diagnostic. Check the diagnostics log first:

```typescript
const client = new HilbrasClient({ config: { rbac: { roles, defaultRole: "viewer" } } });
console.log(client.getAuthorizationDiagnostics());
```

Once the log is clean, opt in to fail-closed behavior:

```typescript
config: { rbac: { roles, defaultRole: "viewer", enforcement: "strict" } }
```

## What is still not enforced

Being explicit about the limits of v3.4:

- **Framework route handlers.** `createChatHandler` and its Astro and Remix
  siblings still trust caller-supplied `body.tools`, `body.model`, and
  `body.maxSteps`, and apply no authentication or body-size limit. Do not expose
  them unauthenticated. Scheduled for v3.5.0.
- **Per-role budget attribution.** `maxBudgetPerSession` is compared against the
  session-scoped budget tracker. Supply `resolveBudget` for per-role totals.
- **Local tool loops and role tool policy.** A role's `allowedTools` applies at
  the transport layer; a local tool loop must apply the policy through
  `ToolLoopAgent`'s `toolPolicy`.
- **Agent approval.** The tool-loop approval callback still defaults to
  approved.
- **DNS and egress.** Provider URLs are checked as strings, without DNS
  resolution or egress constraints.
- **Credential handling in the browser.** Server secrets remain reachable from
  client bundles.
- **Coverage thresholds.** Unmet and unchanged.
