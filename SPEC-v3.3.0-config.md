# Spec: v3.3.0 Configuration Architecture

## Objective

Create one canonical, typed, and diagnosable configuration system for the SDK
without removing existing public configuration entry points.

After v3.3.0:

- configuration sources have explicit ownership and precedence;
- invalid values fail with actionable, redacted errors;
- runtime configuration cannot mutate caller-owned objects;
- secrets are usable by the client but never emitted in diagnostics;
- `HilbrasClient` consumes one resolved configuration object;
- the existing `loadConfig`, `createConfig`, and `validateConfig` functions
  remain available as compatibility entry points;
- browser-safe resolver modules do not import Node built-ins.

## Capability map

| Module | Responsibility | Depends on |
|---|---|---|
| `config-schema` | Canonical input/resolved types, defaults, and validation contracts | — |
| `config-sources` | Defaults, environment, file, and runtime source adapters | `config-schema` |
| `config-resolver` | Deterministic merge, precedence, diagnostics, and error aggregation | `config-schema`, `config-sources` |
| `client-integration` | Resolve once, map policy/budget/providers, and remove duplicate client mapping logic | `config-resolver` |
| `compat-docs` | Legacy API adapters, migration guide, examples, and release documentation | all prior modules |

Build order:

```text
config-schema
      ↓
config-sources
      ↓
config-resolver
      ↓
client-integration
      ↓
compat-docs
```

## Assumptions

1. v3.3.0 is a backward-compatible minor release. Existing exported
   configuration functions and `HilbrasClientConfig.sdkConfig` remain usable.
2. The canonical resolver is strict by default. The legacy `loadConfig()` facade
   preserves its permissive behavior for existing callers, while new code uses
   `resolveConfig()` and receives explicit diagnostics.
3. The core resolver is runtime-agnostic. File reading is injected; the legacy
   Node file loader remains an explicit compatibility adapter.
4. Precedence is deterministic:

   ```text
   defaults < file < environment < runtime/client config < explicit client policy/budget
   ```

5. Arrays and provider collections are replaced atomically, not deep-merged.
6. A usable resolved configuration may contain authentication secrets. Any
   diagnostic, serialization, or error projection is redacted.
7. Unknown configuration keys are reported as warnings by default and can be
   configured as errors.
8. The existing provider catalog and provider adapters are out of scope for this
   release.

## Current-state findings

- `src/config/config.ts` currently combines environment parsing, file I/O,
  merging, and validation.
- File read/parse errors are silently converted to an empty object.
- Numeric and boolean environment values are parsed without strict validation;
  invalid values can become `NaN` or silently become `false`.
- `deepMerge()` is structurally permissive and can merge values without a
  schema-aware policy.
- `validateConfig()` returns a string instead of typed diagnostics and does not
  validate all configuration fields.
- `HilbrasClient` maps only selected `SDKConfig` fields into policy and budget,
  duplicating configuration interpretation.
- `config.ts` statically imports `node:fs`, so the legacy loader is Node-bound.
- Environment provider configuration uses a hard-coded adapter inference table.
- Raw authentication values must remain usable by the client, but diagnostics
  must never expose them.
- Existing documentation claims configuration behavior that is not fully
  implemented, including automatic config-file discovery.

## Public and internal contracts

### New canonical types

```typescript
export type ConfigSourceKind = "defaults" | "file" | "environment" | "runtime";

export interface ConfigDiagnostic {
  code: string;
  message: string;
  path: string;
  severity: "info" | "warning" | "error";
  source: ConfigSourceKind;
}

export interface ConfigSource {
  kind: ConfigSourceKind;
  load(): ConfigSourceResult | Promise<ConfigSourceResult>;
}

export interface ConfigSourceResult {
  values: Partial<SDKConfig>;
  diagnostics?: ConfigDiagnostic[];
}

export interface ResolvedSDKConfig {
  values: SDKConfig;
  sources: ConfigSourceKind[];
  diagnostics: ConfigDiagnostic[];
  safeSnapshot(): SafeSDKConfig;
}
```

`SafeSDKConfig` is a redacted projection suitable for logs, diagnostics, and
developer tooling. It never contains bearer tokens, header values, or other
authentication secrets.

### Resolver API

```typescript
export interface ResolveConfigOptions {
  sources?: ConfigSource[];
  overrides?: Partial<SDKConfig>;
  strict?: boolean;
  rejectUnknownKeys?: boolean;
}

export function resolveConfig(
  options?: ResolveConfigOptions,
): ResolvedSDKConfig;
```

The resolver must:

1. Load sources in the declared order.
2. Validate each source before merging it.
3. Merge only schema-known keys.
4. Apply runtime overrides last.
5. Return the winning source for each field for diagnostics.
6. Collect all safe diagnostics before throwing where strict mode requires it.
7. Never mutate source objects, environment objects, or caller overrides.
8. Reject invalid provider URLs using the existing SSRF policy.

### Source modules

```text
src/config/
├── config-schema.ts
├── config-resolver.ts
├── resolved-config.ts
└── sources/
    ├── defaults.ts
    ├── environment.ts
    ├── file.ts
    └── runtime.ts
```

- `defaults.ts` owns the immutable default configuration.
- `environment.ts` accepts an injected `env` object and uses strict parsers.
- `file.ts` accepts an injected `readFile` function. It does not import
  `node:fs` in the universal module.
- `runtime.ts` accepts a caller-owned override object and copies it safely.
- `config.ts` remains the compatibility facade and may retain a Node-only file
  reader for `loadConfig({ configPath })`.

## Validation rules

- `temperature`: finite number in `[0, 2]`.
- `maxTokens`: positive integer.
- `requestTimeoutMs`: finite integer `>= 1000`, unless explicitly disabled by a
  documented policy field.
- `maxRetries`: non-negative integer.
- Circuit-breaker values: finite integers with documented ranges.
- `logLevel`: one of `none`, `error`, `info`, `debug`.
- Provider names: non-empty and unique.
- Provider URLs: validated through the existing SSRF guard.
- Provider adapters: non-empty string; built-in adapter inference remains a
  compatibility behavior of the legacy environment source only.
- Environment numbers: reject `NaN`, infinities, and malformed values.
- Environment booleans: accept only documented true/false forms.
- Unknown keys: warning by default, error in strict mode.
- Arrays and provider lists: replacement semantics.

## Error and secret policy

- Resolution failures use the existing `ConfigurationError` type with a
  redacted, actionable hint.
- A source may return diagnostics without throwing; the resolver decides
  whether strict mode converts them into an error.
- Raw secret values must not appear in error messages, diagnostic messages,
  `safeSnapshot()`, or serialized configuration logs.
- The resolved configuration may retain secrets because the client needs them
  to authenticate; it must not be logged by default.
- `validateBaseUrl()` remains mandatory for every provider source, including
  environment and file sources.

## Client integration

`HilbrasClient` must:

1. Accept the existing `sdkConfig` field without removal.
2. Accept the new canonical resolved configuration additively.
3. Resolve configuration once during construction.
4. Map resolved policy, budget, and providers through one internal adapter.
5. Preserve explicit `policy` and `budget` precedence.
6. Emit a configuration diagnostic event when resolution produces warnings.
7. Avoid re-reading environment variables or files during requests.

The client must not silently fall back to defaults after a supplied
configuration source fails.

## Compatibility policy

- `loadConfig(options)` remains exported and keeps its current option shape.
- `createConfig(overrides)` remains exported.
- `validateConfig(config)` remains exported and continues returning
  `string | null` for compatibility.
- New strict behavior is exposed through `resolveConfig()` and can be adopted
  incrementally.
- `HilbrasClientConfig.sdkConfig` remains supported.
- No provider adapter, catalog, or provider-specific export is removed in
  v3.3.0.
- Deprecated behavior receives a documented migration note, not an immediate
  removal.

## Testing strategy

Add focused tests under `tests/config/`:

- defaults and deep-copy isolation;
- source precedence for every field;
- file source success, missing file, malformed JSON, and injected reader;
- environment numeric/boolean parsing and invalid values;
- provider URL validation from every source;
- unknown-key warning and strict-mode failure;
- duplicate provider detection;
- secret-safe diagnostics and `safeSnapshot()`;
- resolver immutability;
- legacy `loadConfig`/`createConfig`/`validateConfig` compatibility;
- `HilbrasClient` mapping of resolved policy, budget, and providers;
- browser-safe import of the universal resolver modules.

Verification commands:

```bash
npm run pretest
npm run lint
npm test
npm run build
npm run check:package
npm run size
npx publint
npm audit --omit=dev
```

## Documentation deliverables

- `docs/configuration.md` — canonical configuration guide.
- `docs/migration-from-v3.2.md` — resolver adoption guide.
- README configuration section and feature table update.
- API reference for `resolveConfig`, `ConfigSource`, and diagnostics.
- CHANGELOG entry for v3.3.0.
- Executable examples for file, environment, and runtime configuration.

## Success criteria

1. `resolveConfig()` returns one deterministic, typed configuration object.
2. Precedence is tested and documented without relying on comments alone.
3. Invalid configuration produces actionable, redacted errors.
4. No configuration secret appears in diagnostics or safe snapshots.
5. `HilbrasClient` no longer duplicates configuration interpretation logic.
6. Existing v3.2 configuration APIs continue to work.
7. Universal resolver modules import successfully without Node built-ins.
8. Typecheck, lint, tests, build, package smoke tests, and size gate pass.
9. Coverage thresholds are not lowered.

## Open questions for implementation review

1. Should the new client field be named `config`, `resolvedConfig`, or
   `configurationSources`? Recommendation: `config` for the canonical input and
   `resolvedConfig` only for an already-resolved internal value.
2. Should strict unknown-key rejection be the default for the new resolver, or
   warning-first? Recommendation: warning-first by default, strict opt-in.
3. Should automatic `hilbras.config.json` discovery be added in v3.3.0?
   Recommendation: no; keep discovery explicit to avoid unexpected file reads.
