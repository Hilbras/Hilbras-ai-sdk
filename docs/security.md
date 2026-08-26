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

With `allowInsecure: true` the following are *always* allowed:
- `http://localhost`
- `http://127.0.0.1`
- `http://[::1]`
- `http://*.local`

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

## Reporting security issues

Please report security issues privately via GitHub's
[security advisory](https://github.com/Hilbras/Hilbras-ai-sdk/security/advisories/new)
mechanism. Do not file public issues for undisclosed vulnerabilities.
