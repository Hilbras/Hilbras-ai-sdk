# Changelog

All notable changes to `@hilbras/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] - 2026-08-22

### Added

#### Execution Policies

New `ExecutionPolicy` system for controlling reliability, timeout, retry, backoff, and circuit breaker behavior — both globally and per-request:

```typescript
// Named preset
client.stream({ ..., policy: { preset: "production" } });

// Custom policy
client.stream({ ..., policy: { retry: { maxRetries: 5 }, timeout: { requestTimeoutMs: 10_000 } } });

// Preset with overrides
client.stream({ ..., policy: { preset: "maximum", circuitBreaker: { enabled: false } } });
```

**5 built-in presets:**

| Preset | Retries | Timeout | Circuit Breaker | Use case |
|--------|---------|---------|-----------------|----------|
| `balanced` | 3 | 60s | On (5 failures) | Default — most apps |
| `production` | 5 | 120s | On (5 failures) | Conservative, reliable |
| `fast` | 1 | 15s | On (3 failures) | Latency-sensitive |
| `cheap` | 10 | 300s | Off | Cost matters more than speed |
| `maximum` | 10 | 300s | On (10 failures) | Critical operations |

**Per-request policy overrides client default:**

```typescript
const client = new HilbrasClient({ policy: { preset: "production" } });
// This request uses fast policy instead
await client.complete({ ..., policy: { preset: "fast" } });
```

#### SDKConfig Integration

`SDKConfig` reliability fields (`maxRetries`, `requestTimeoutMs`, `circuitBreakerEnabled`, `circuitBreakerThreshold`, `circuitBreakerResetMs`) are now wired to the actual runtime via the policy system:

```typescript
import { loadConfig } from "@hilbras/sdk";

const config = loadConfig({ configPath: "./hilbras.config.json" });
const client = new HilbrasClient({ sdkConfig: config });
```

Priority chain: `per-request policy > client default > SDKConfig > balanced preset`

#### New Exports

- `ExecutionPolicy`, `ResolvedPolicy`, `PolicyPreset` types
- `resolvePolicy()`, `getPreset()` functions

### Fixed

- `SDKConfig` reliability fields were disconnected from runtime — now wired through policy system
- Circuit breaker config (`failureThreshold`, `timeoutMs`, etc.) was always hardcoded — now configurable
- Retry config (`maxRetries`, `retryableStatuses`) was always hardcoded — now configurable
- Backoff config (`baseDelayMs`, `maxDelayMs`, `jitter`) was always hardcoded — now configurable

### Changed

- `HilbrasClient` constructor accepts optional `policy` and `sdkConfig`
- `stream()` and `complete()` accept optional per-request `policy`
- 16 new policy tests (130 → 146 total)

---

## [0.3.0] - 2026-08-22

### Added

#### Universal Provider Contract (`AIProvider` Interface)
- New `AIProvider` interface defines the universal contract all adapters implement:
  ```typescript
  interface AIProvider {
    readonly id: string;
    stream(params: GenerateParams): AsyncGenerator<StreamChunk>;
    complete(params: GenerateParams): Promise<string>;
  }
  ```
- New `AdapterConfig` shared type for adapter constructors
- New `GenerateParams` type for stream/complete parameters
- All 6 adapters now declare `implements AIProvider` with a `readonly id`

#### Plugin Registration System (`AdapterRegistry`)
- New `AdapterRegistry` class for registering adapter factories by ID
- `getDefaultAdapterRegistry()` returns a registry pre-loaded with all 6 built-in adapters
- Third-party adapters can be registered without modifying SDK core:
  ```typescript
  import { AdapterRegistry } from "@hilbras/sdk";
  const registry = getDefaultAdapterRegistry();
  registry.register("mistral", (config) => new MistralAdapter(config));
  ```
- `HilbrasClient` accepts optional `adapterRegistry` config
- `HilbrasClient.adapterRegistry` getter for accessing the registry

#### Subpath Export
- `@hilbras/sdk/adapter` — imports the `AIProvider`, `AdapterConfig`, `GenerateParams` types

### Fixed
- Removed phantom `"responses"` from `AdapterName` type (no adapter implementation existed)
- Removed `"responses"` from `APIFormat` type
- Client no longer uses `any` casts — adapters are typed as `AIProvider` with compile-time safety
- Client no longer imports all 6 adapter classes directly — uses the registry instead

### Changed
- All 6 adapters now have `readonly id` property (e.g. `"openai"`, `"anthropic"`)
- Adapter config types (`OpenAIAdapterConfig`, `AnthropicAdapterConfig`, etc.) now alias or extend `AdapterConfig`
- `HilbrasClient` constructor accepts `adapterRegistry` option for custom plugin registries

---

## [0.2.0] - 2026-08-22

### Added

#### New Adapters
- **`complete()` method** added to Anthropic, Google GenAI, Azure, Groq, and Ollama adapters. Previously only the OpenAI adapter implemented non-streaming completion — calling `client.complete()` with any other provider would crash at runtime.

#### Model Catalog
- **OpenAI:** GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o3-mini, o4-mini, o1-mini
- **Azure:** GPT-4.1 (Azure), GPT-4.1 Mini (Azure), o3 Mini (Azure), GPT-4o Mini (Azure)
- **Anthropic:** Claude Opus 4, Claude 3.7 Sonnet
- **Google Gemini:** Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash (provider field corrected to `google-genai`)
- **Groq:** Llama 4 Maverick, Llama 4 Scout, DeepSeek R1 Distill
- **Ollama:** Llama 3.3, Qwen 2.5 Coder

#### Token Pricing
- Updated pricing table with 2025 model rates (GPT-4.1 family, o3/o4, Claude Opus 4, Gemini 2.5, etc.)

#### Timeout Enforcement
- `createTimeoutSignal()` is now wired into `HilbrasClient.stream()` and `HilbrasClient.complete()`. Providers with a `timeout` config now enforce it via `AbortSignal`, preventing hung requests.

#### Subpath Exports
- Added subpath exports for tree-shaking: `@hilbras/sdk/adapters/openai`, `@hilbras/sdk/tokens`, `@hilbras/sdk/config`, `@hilbras/sdk/transport/fetch`, `@hilbras/sdk/reliability/*`

#### Documentation
- Comprehensive README with provider table, feature examples, architecture diagram, subpath imports, and error handling guide
- CHANGELOG.md (this file)
- CONTRIBUTING.md with development guidelines
- Full API documentation in `docs/`

#### Tests
- 38 new tests (59 → 97 total, 6 → 11 test files)
- Azure adapter tests (6 tests): routing, auth headers, streaming, complete
- Groq adapter tests (6 tests): streaming, auth, reasoning normalization, complete
- Ollama adapter tests (5 tests): streaming, no-auth, num_predict, complete
- Middleware tests (11 tests): compose, auth, logging, retry, rate-limit, cache
- Degradation tests (10 tests): all 4 levels, withDegradation success/degrade/error/all-fail

### Fixed

- **`AdapterName` type** now includes `"azure"`, `"groq"`, `"ollama"`. Previously, `addProvider({ adapter: "azure" ... })` was a TypeScript error even though the runtime code handled it.
- **`require("node:fs")`** in `config/config.ts` replaced with ESM `import { readFileSync }`. This was a CJS call in an ESM module and would throw in strict ESM contexts.
- **`process.cwd()` in `DEFAULT_CONFIG`** guarded with `typeof process !== "undefined"` check. Previously this would throw in browser/Deno environments when importing the config schema.
- **`WebSocketTransport`** now uses `getWebSocketConstructor()` with a clear error message for Node 18–21 (which lacks global `WebSocket`). Previously the code would crash with an opaque reference error.
- **`dist/` was stale** — 12 of 30 source modules had no compiled output. The `dist/` is now fully rebuilt and verified against source.
- **`tsconfig.json`** updated with `DOM`, `DOM.Iterable` libs and `@types/node`. TypeScript compilation was impossible without these type definitions for web APIs (`AbortSignal`, `Response`, `ReadableStream`, `fetch`, etc.).
- **`Transport.body` type** narrowed from `string | Uint8Array` to `string`. The `Uint8Array` variant caused type incompatibility between Node and DOM `Uint8Array` definitions.

### Changed

- **DevDependencies:** Added `typescript`, `oxlint`, `@types/node` (were referenced by scripts but not installed)
- **`Body` type in transport** simplified to `string` only — all adapters serialize to JSON strings anyway

---

## [0.1.0] - 2026-07-21

### Added

Initial release of `@hilbras/sdk`.

#### Core
- `HilbrasClient` — main entry point with `stream()` and `complete()` methods
- Provider registry with add/remove/findModel
- `AsyncDisposable` support for cleanup

#### Adapters
- **OpenAI** — Chat Completions API with streaming, tool calls, reasoning detection
- **Anthropic** — Messages API with system prompt extraction, tool schema conversion
- **Google GenAI** — Gemini API with function declarations, NDJSON streaming
- **Azure** — Azure OpenAI with deployment routing, `api-key` header, API version
- **Groq** — OpenAI-compatible for ultra-fast inference
- **Ollama** — Local models, no auth required

#### Reliability
- Circuit breaker (CLOSED → OPEN → HALF_OPEN state machine)
- Retry with exponential backoff and jitter
- Timeout via AbortSignal composition
- Graceful degradation chain (normal → media-degraded → media-stripped → history-truncated)

#### Transport
- `FetchTransport` — native fetch, works in Node 18+, Bun, Deno, browsers
- `WebSocketTransport` — bidirectional transport for WebSocket providers
- `Transport` interface for custom implementations

#### Types
- Canonical `Message`, `Tool`, `StreamChunk` types
- `messageToDict` / `dictToMessage` converters
- Discriminated union stream chunks: Text, Reasoning, ToolCall, Usage, Error, Finish

#### Tokens
- Token estimation heuristic (~4 chars/token)
- Per-message and per-tool token counting
- Cost estimation with model pricing table
- Prompt caching support (Anthropic `cache_control`, OpenAI)

#### Config
- Layered config: defaults → file → env vars → runtime overrides
- Environment variable loading (prefix `HILBRAS_`)
- JSON config file support
- Config validation

#### Middleware
- `composeMiddlewares` — chain middlewares
- `authMiddleware` — dynamic token injection
- `loggingMiddleware` — request/response logging
- `retryMiddleware` — retry with backoff
- `rateLimitMiddleware` — request throttling
- `cacheMiddleware` — GET response caching

#### Reasoning
- `ReasoningNormalizer` — detects `<thinking>`, `<reasoning>`, `<reason>` tags across delta boundaries
- Native reasoning field support (`reasoning_content`, `thinking`)

#### Credentials
- `DefaultCredentialProvider` — resolves from explicit token or environment variable
- Pluggable `CredentialProvider` interface

#### Logging
- `SDKLogger` with configurable log levels
- Automatic redaction of API keys and tokens
- Circular log buffer (1000 entries)

#### Errors
- Typed error hierarchy: `HilbrasSdkError` → `ProviderNotFoundError`, `ModelNotFoundError`, `ProviderRequestError`, `StreamError`, `InvalidFormatError`, `ConfigurationError`, `CircuitBreakerOpenError`
