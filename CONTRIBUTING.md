# Contributing to @hilbras/sdk

## Setup

```bash
git clone https://github.com/Hilbras/Hilbras-ai-sdk.git
cd Hilbras-ai-sdk
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode compilation |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source with oxlint |

## Project Structure

```
src/
├── index.ts              # Public API surface
├── client/client.ts      # Main entry point
├── adapters/             # Provider wire-format converters
├── transport/            # HTTP abstraction layer
├── reliability/          # Circuit breaker, retry, backoff, timeout
├── middleware/            # Request pipeline interceptors
├── tokens/               # Token counting, caching, pricing
├── config/               # Configuration loader and schema
├── credentials/          # Secret resolution
├── reasoning/            # Thinking/reasoning normalizer
├── errors/               # Typed error hierarchy
├── logging/              # Redacting logger
├── types/                # Canonical types
└── catalog/              # Built-in model catalog
```

## Adding a New Provider Adapter

1. Create `src/adapters/my-provider.ts`
2. Implement the adapter interface (see existing adapters for reference):
   ```typescript
   export class MyProviderAdapter {
     async *stream(params: StreamParams): AsyncGenerator<StreamChunk> { ... }
     async complete(params: CompleteParams): Promise<string> { ... }
   }
   ```
3. Add the adapter name to `AdapterName` in `src/types/providers.ts`
4. Register in `ADAPTER_MAP` in `src/client/client.ts`
5. Export from `src/index.ts`
6. Add models to `src/catalog/models.ts`
7. Add tests in `tests/my-provider-adapter.test.ts`

## Writing Tests

Tests use [Vitest](https://vitest.dev/) with `globals: true`. Follow the existing mock transport pattern:

```typescript
import { describe, it, expect } from "vitest";

function mockTransport(chunks: string[]): Transport {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    async request() { return new Response(stream, { status: 200 }); },
    async stream() { return stream; },
    abort() {},
  };
}
```

## Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — Breaking changes to public API
- **MINOR** — New features, backward compatible
- **PATCH** — Bug fixes, backward compatible

When bumping version:
1. Update `version` in `package.json`
2. Add entry to `CHANGELOG.md` with all changes categorized as Added/Fixed/Changed
3. Tag the commit: `git tag v0.x.y`

## Code Style

- TypeScript strict mode
- ESM (`type: "module"`)
- No runtime dependencies
- Node 18+ compatible (guard `process`, `WebSocket`, etc.)
- Error classes extend `HilbrasSdkError`
- All public API exported from `src/index.ts`

## Pull Request Process

1. Create a branch from `main`
2. Make your changes
3. Run `npm test` — all tests must pass
4. Run `npm run build` — must compile cleanly
5. Update `CHANGELOG.md` if adding features or fixing bugs
6. Open a PR with a clear description
