# Migration from v3.2 to v3.3

v3.3 adds a canonical configuration resolver without removing the v3.2
configuration API.

## Existing code

These patterns continue to work:

```typescript
import { HilbrasClient, createConfig, loadConfig } from "@hilbras/sdk";

const config = loadConfig({ configPath: "./hilbras.config.json" });
const client = new HilbrasClient({ sdkConfig: config });
```

`loadConfig()`, `createConfig()`, `validateConfig()`, and
`HilbrasClientConfig.sdkConfig` remain available.

## Recommended code

Use explicit sources and resolve once:

```typescript
import {
  HilbrasClient,
  createFileSource,
  createRuntimeSource,
  resolveConfig,
} from "@hilbras/sdk";
import { readFileSync } from "node:fs";

const resolved = resolveConfig({
  sources: [
    createFileSource({
      path: "./hilbras.config.json",
      readFile: (path) => readFileSync(path, "utf8"),
    }),
    createRuntimeSource({ temperature: 0.3 }),
  ],
});

const client = new HilbrasClient({ resolvedConfig: resolved });
```

## Behavior changes to be aware of

- The canonical resolver is strict about malformed numeric, boolean, and enum
  values.
- Provider URLs are validated from every source.
- Arrays and provider collections use replacement semantics.
- Unknown keys produce warnings by default and errors when
  `rejectUnknownKeys: true`.
- File configuration uses an injected reader in the universal source. The
  legacy `loadConfig({ configPath })` helper remains Node-oriented.
- Configuration diagnostics never include raw credentials.

## Verifying a migration

```typescript
const snapshot = client.getConfigSnapshot();
const diagnostics = client.getConfigDiagnostics();

if (diagnostics.some((item) => item.severity === "error")) {
  throw new Error("Configuration requires attention");
}
```

Do not use `getConfigSnapshot()` as a credential store; it is intentionally
redacted.
