# Security & SSRF Protection

`@hilbras/sdk` is SSRF-safe by default starting in v0.9.3. A misconfigured
or malicious provider cannot point the SDK at the AWS instance metadata
service, internal services, or unsafe URL schemes.

## What is blocked

`HilbrasClient.addProvider()` validates the `baseUrl` through
[`validateBaseUrl()`](../src/security/url-guard.ts) before any HTTP request
is constructed.

By default, the validator rejects:

- **Non-https URLs** (e.g. `http://api.example.com`)
- **AWS instance metadata** (`http://169.254.169.254/...`) — *always blocked,*
  even when insecure is explicitly allowed
- **Private network ranges** (`10.*`, `172.16-31.*`, `192.168.*`) unless
  `allowPrivateNetwork: true` is also set
- **Unsafe schemes**: `file:`, `javascript:`, `data:`, `blob:`, `ftp:`,
  `gopher:`, `ws:`, `wss:`

On rejection, `addProvider` throws a `ConfigurationError` with a message
that names the rejected URL and the policy reason.

## Per-provider opt-in: `allowInsecure`

For local development, Ollama, or a proxy that doesn't terminate TLS,
set `allowInsecure: true` on the provider:

```typescript
client.addProvider({
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  authentication: { type: "none" },
  adapter: "ollama",
  allowInsecure: true, // required for http://
  models: [/* ... */],
});
```

With `allowInsecure: true`, local loopback targets are allowed (`localhost`,
`127.0.0.1`, and `[::1]`). Names under `.local` additionally require
`allowPrivateNetwork: true`; link-local and metadata addresses remain blocked
even when private-network access is enabled.

## Client-wide opt-in: `allowInsecureUrls`

To allow all providers to use `http://` without per-provider flags, set
`allowInsecureUrls: true` on the client:

```typescript
const client = new HilbrasClient({
  allowInsecureUrls: true,
});
```

## Private network access

Private network ranges (`10.*`, `172.16-31.*`, `192.168.*`) require an
additional opt-in beyond `allowInsecure`:

```typescript
const client = new HilbrasClient({
  allowInsecureUrls: true,
  allowPrivateNetwork: true, // additionally allows 10.*, 192.168.*, 172.16-31.*
});
```

The AWS instance metadata address (`169.254.169.254`) is *always* blocked
regardless of these flags.

## Programmatic validation

You can validate a URL before using it elsewhere with the exported
`validateBaseUrl` function:

```typescript
import { validateBaseUrl } from "@hilbras/sdk";

const result = validateBaseUrl("https://api.openai.com/v1");
if (result.ok) {
  // safe to use
} else {
  console.error(`Rejected: ${result.reason}`);
}
```

## Provider configuration exposure

`client.getProvider()` and `client.listProviders()` currently return
`ProviderConfig` objects for compatibility, including authentication and
custom-header values. Do not serialize these objects into browser state,
diagnostic endpoints, or logs. The SDK's defensive copies prevent later caller
mutation of registered providers, but they do not change the legacy getter
shape; a future release should add explicit redacted summary accessors.

## Error redaction in provider responses

`@hilbras/sdk` automatically redacts sensitive substrings from provider
error bodies before they reach your code. The redaction is applied inside
`ProviderRequestError` and covers:

- `sk-…`, `sk-proj-…`, `sk-ant-…` API key shapes
- `Bearer <token>` headers in any case
- JSON `"apiKey"`, `"api_key"`, `"token"`, `"secret"`, `"password"`,
  `"accessToken"`, `"authToken"` field values

This means the README's example pattern
`console.error(`HTTP ${err.status}: ${err.body}`)` is now safe — `err.body`
will not contain your API key even if the provider echoed it back in the
error response.

If you need to apply redaction to other text, `redact()` is also exported:

```typescript
import { redact } from "@hilbras/sdk";
const safe = redact(userProvidedText);
```

## Authorization — v3.4.0

Control which providers, models, and tools each caller may use.

Authorization is enforced at the transport layer, so a denied request never
reaches a provider. Tool policy is a separate control enforced where tools
actually execute; see [Tool policy](#tool-policy).

### Defining roles

```typescript
import { HilbrasClient, createRBACMiddleware } from "@hilbras/sdk";

const rbac = createRBACMiddleware(
  {
    roles: {
      viewer: {
        name: "viewer",
        allowedProviders: ["openai"],
        allowedModels: ["gpt-4o", "gpt-4o-mini"],
        maxTokensPerRequest: 4096,
        rateLimit: { maxRequests: 10, windowMs: 60_000 },
      },
      developer: {
        name: "developer",
        allowedProviders: ["openai", "anthropic"],
        // no model restriction
      },
      admin: { name: "admin" }, // no restrictions
    },
    defaultRole: "viewer",
  },
  (ctx) => extractUserIdFromRequest(ctx),
  {
    // Map the caller identity onto a role. Without this the middleware always
    // applies `defaultRole`, so per-user roles are not possible.
    resolveRole: (ctx) => roleForUser(extractUserIdFromRequest(ctx)),
    // Providers are identified from the request URL, because no adapter puts
    // `provider` in the request body.
    resolveProviderByUrl: (url) => providerNameForUrl(url),
  },
);

const client = new HilbrasClient({ middleware: rbac });
```

### Enforcement modes

`enforcement` controls what happens when a request context cannot be fully
resolved — no resolvable role, an unidentifiable provider, or a resolver that
throws.

| Situation | `"permissive"` (default) | `"strict"` |
|---|---|---|
| Resolved request that satisfies the role | allow | allow |
| Provider, model, or tool not permitted | `403` | `403` |
| Token or session budget exceeded | `403` | `403` |
| Rate limit exceeded | `429` + `Retry-After` | `429` + `Retry-After` |
| No role resolves | allow, diagnostic recorded | `403` |
| Provider cannot be identified | that check is skipped, diagnostic recorded | `403` |
| Role or request resolver throws | allow, diagnostic recorded | `403` |

`"permissive"` is the default so that adopting a policy never silently starts
rejecting traffic. Set `enforcement: "strict"` once the policy is known to
resolve correctly.

### Configuration wiring

A `rbac` block in client configuration is enforced automatically:

```typescript
const client = new HilbrasClient({
  config: {
    rbac: {
      roles: { viewer: { name: "viewer", allowedProviders: ["openai"] } },
      defaultRole: "viewer",
    },
  },
});

client.getAuthorizationDiagnostics(); // redacted decision log, bounded
```

A malformed policy is rejected when the client is constructed rather than
degrading to "no restrictions":

```typescript
new HilbrasClient({
  config: { rbac: { roles: { v: { name: "v", allowedModels: "gpt-4o" } } } },
});
// ConfigurationError: rbac.roles.v.allowedModels must be an array of non-empty strings
```

The client resolves provider identity from its own provider registry, so
providers added with `addProvider()` after construction are covered by the same
policy.

### Session budgets

A role's `maxBudgetPerSession` is enforced against the client's session budget
tracker. That tracker is session-scoped rather than per-role, so with several
budgeted roles the same session total is compared against each role's ceiling.
For per-role attribution, supply `resolveBudget`:

```typescript
createRBACMiddleware(config, getUserId, {
  resolveBudget: ({ roleName, userId }) => ({
    spent: myLedger.spentFor(roleName, userId),
  }),
});
```

When a role declares a budget and no `resolveBudget` is configured, the SDK
reports `RBAC_BUDGET_NOT_ENFORCED` rather than claiming the limit is enforced.

### Permission checks

You can also check permissions programmatically:

```typescript
import { checkPermission } from "@hilbras/sdk";

const result = checkPermission(
  { name: "viewer", allowedProviders: ["openai"] },
  "anthropic",  // provider
  "claude-3",   // model
);

if (!result.allowed) {
  console.error(result.reason); // Provider "anthropic" is not allowed for role "viewer"
}
```

A role with no declared restrictions allows everything. A role whose policy is
malformed denies, because an invalid policy must not be read as an absent one.

### Model pattern matching

Roles support wildcard patterns for model restrictions:

```typescript
{
  name: "restricted",
  allowedModels: ["gpt-*"],  // matches gpt-4o, gpt-4o-mini, etc.
}
```

### Tool policy

`allowedTools` and `deniedTools` are enforced by the client on every request and
by `ToolLoopAgent` before every tool execution. A deny-list always wins, and an
empty allow-list permits everything.

```typescript
const client = new HilbrasClient({
  config: { allowedTools: ["search", "fetch"], deniedTools: ["shell"] },
});

// A request that names a denied tool is rejected before any provider call.
await client.complete({ provider, model, messages, tools: [shellTool] });
// Error: Tool "shell" is denied by policy

// Reuse the same policy in an agent loop.
const agent = new ToolLoopAgent({
  provider, model,
  tools,
  toolPolicy: client.getToolPolicy(),
  llm,
});
```

For a per-user narrowing, intersect the two — `narrow` only ever removes
permissions:

```typescript
toolPolicy: client.getToolPolicy().narrow({ allowedTools: ["search"] });
```

A role may also declare `allowedTools` / `deniedTools`. Those apply when the
decision is made at the transport layer. Because tools run locally, a local tool
loop must apply the policy itself via `ToolLoopAgent`'s `toolPolicy`.

### Audit logging

Access-denied and rate-limit events are logged to the `AuditLogger` when one is
configured, attributed with the caller's user id and the role that was applied:

```typescript
import { AuditLogger, createRBACMiddleware } from "@hilbras/sdk";

const auditLogger = new AuditLogger({ serviceName: "my-app" });
const rbac = createRBACMiddleware(config, getUserId, { auditLogger });

auditLogger.getByUser("user-42"); // includes RBAC denials for that caller
```

## Request signing — v3.4.0

`RequestSigner` produces an HMAC over a canonical representation of a request.

### Signature profiles

| | `v1` (default, deprecated) | `v2` |
|---|---|---|
| Method, path, and configured headers | signed | signed |
| Request body | **not** bound | bound via `x-hilbras-content-digest` |
| Key id | not bound | bound |
| Nonce | none | bound via `x-hilbras-nonce` |
| `verify()` trusts a received digest header | yes | no — it recomputes from the body |

`v1` is frozen so existing verifiers keep working. It does not authenticate the
body, so a `v1` signature cannot detect a modified request body. Use `v2` for
any new integration.

```typescript
import { RequestSigner, signingMiddleware } from "@hilbras/sdk";

const signer = new RequestSigner({
  secret: process.env.GATEWAY_SECRET!,
  keyId: "key-2026-09",
  profile: "v2",
});

const client = new HilbrasClient({ middleware: signingMiddleware(signer) });
```

A body that cannot be read for signing — a `FormData` upload, for example — gets
no digest header rather than a digest of a placeholder, so an absent digest is
never mistaken for content binding.

### Replay protection

A signature proves authorship, not freshness. Neither profile provides replay
protection on its own; pair it with `ReplayGuard` or use `verifyFresh()`:

```typescript
import { ReplayGuard } from "@hilbras/sdk";

const guard = new ReplayGuard({ maxAgeMs: 5 * 60_000, maxSkewMs: 30_000 });

// On the receiving side:
const verdict = signer.verifyFresh(url, { method, body, headers }, signature, { guard });
// { valid: false, reason: "signature has already been used" }
```

The guard enforces a signed-timestamp window and keeps a bounded FIFO cache of
seen signatures, so a long-lived process cannot grow without bound.

### Composing with retries

`composeMiddlewares` re-runs every downstream stage on each attempt, so a
signing stage placed after a retry stage signs each attempt with a fresh
timestamp and nonce:

```typescript
const client = new HilbrasClient({
  middleware: composeMiddlewares(retryMiddleware(2), signingMiddleware(signer)),
});
```


## Reporting security issues

Please report security issues privately via GitHub's
[security advisory](https://github.com/Hilbras/Hilbras-ai-sdk/security/advisories/new)
mechanism. Do not file public issues for undisclosed vulnerabilities.
