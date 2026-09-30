# Configuration

`@hilbras/sdk` v3.3 introduces a canonical configuration resolver while keeping
the v3.2 configuration APIs available.

## Precedence

Configuration is resolved once, in this order:

```text
defaults
  < file source
  < environment source
  < runtime/client configuration
  < explicit client policy or budget
```

Later sources replace earlier values. Arrays and provider collections are
replaced atomically rather than deep-merged.

## Quick start

```typescript
import { HilbrasClient } from "@hilbras/sdk";
import { resolveConfig } from "@hilbras/sdk/config";

const resolved = resolveConfig({
  overrides: {
    temperature: 0.4,
    maxTokens: 4096,
  },
});

const client = new HilbrasClient({ resolvedConfig: resolved });
```

## Runtime configuration

```typescript
import { HilbrasClient, createRuntimeSource } from "@hilbras/sdk";

const client = new HilbrasClient({
  configSources: [
    createRuntimeSource({
      temperature: 0.2,
      maxRetries: 1,
    }),
  ],
});
```

The source copies its input. Mutating the original object after resolution does
not change the client configuration.

## Environment configuration

The environment source accepts an injected environment object. This makes it
testable and avoids relying on ambient process state:

```typescript
import { HilbrasClient, createEnvironmentSource } from "@hilbras/sdk";

const client = new HilbrasClient({
  configSources: [
    createEnvironmentSource({
      HILBRAS_DEFAULT_MODEL: "my-model",
      HILBRAS_TEMPERATURE: "0.3",
      HILBRAS_MAX_RETRIES: "2",
      HILBRAS_PROVIDER_URL: "https://api.example.com/v1",
      HILBRAS_PROVIDER_KEY: process.env.MY_PROVIDER_KEY!,
    }),
  ],
});
```

Supported values are validated strictly. Invalid numbers, booleans, enum
values, incomplete provider credentials, and unsafe URLs produce diagnostics
or a `ConfigurationError` in strict mode.

## File configuration

File reading is injected so the universal resolver does not depend on Node
built-ins:

```typescript
import { readFileSync } from "node:fs";
import { createFileSource } from "@hilbras/sdk";

const source = createFileSource({
  path: "./hilbras.config.json",
  readFile: (path) => readFileSync(path, "utf8"),
});

const resolved = resolveConfig({ sources: [source] });
```

File paths are explicit. The SDK does not automatically search the filesystem
for `hilbras.config.json`.

The JSON file must contain an object. Malformed JSON is reported as a
configuration diagnostic rather than silently treated as an empty file in the
strict resolver.

## Client configuration

`HilbrasClient` resolves configuration once during construction:

```typescript
const client = new HilbrasClient({
  config: {
    maxRetries: 2,
    requestTimeoutMs: 30_000,
    providers: [
      {
        name: "my-provider",
        baseUrl: "https://api.example.com/v1",
        adapter: "openai",
        authentication: { type: "bearer", apiKey: process.env.MY_KEY! },
        models: [],
      },
    ],
  },
});
```

The existing `sdkConfig` field remains supported:

```typescript
const client = new HilbrasClient({ sdkConfig: legacyConfig });
```

Explicit `policy` and `budget` values still take precedence over mapped
configuration values.

## Diagnostics and secret safety

```typescript
const snapshot = client.getConfigSnapshot();
const diagnostics = client.getConfigDiagnostics();
```

`getConfigSnapshot()` is redacted. It is safe to use for diagnostics and
developer tooling, but it is not a replacement for an application-specific
secret manager. Raw authentication values are never included in the snapshot
or configuration diagnostics.

The resolved configuration may contain credentials because the client needs
them to make requests. Do not log the resolved object directly.

## Validation

The resolver validates:

- numeric ranges and integer requirements;
- booleans and log levels;
- provider names and adapter identifiers;
- provider authentication shapes;
- provider URLs through the SDK SSRF policy;
- duplicate provider names;
- conflicting allowed/denied tool lists;
- unknown configuration keys.

Unknown keys are warnings by default. Use `rejectUnknownKeys: true` for strict
applications.

## Browser boundary

The resolver, runtime source, and environment source are runtime-agnostic. The
file source requires an injected reader. The legacy `loadConfig({ configPath })`
facade remains Node-oriented because it uses `node:fs` internally.

## Legacy APIs

These functions remain available:

```typescript
import { loadConfig, createConfig, validateConfig } from "@hilbras/sdk";
```

`loadConfig()` preserves the v3.2 permissive file behavior for compatibility.
New code should prefer `resolveConfig()` for explicit diagnostics and
deterministic validation.
