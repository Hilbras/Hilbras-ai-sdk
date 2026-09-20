# @hilbras/sdk Examples

Example apps demonstrating `@hilbras/sdk` with popular frameworks.

## Examples

| Framework | Directory | Features |
|---|---|---|
| **Next.js** | [nextjs/](./nextjs/) | App Router, streaming, structured output, cost tracking |
| **SvelteKit** | [sveltekit/](./sveltekit/) | Streaming, structured output, reactive UI |
| **Hono** | [hono/](./hono/) | Edge runtime, lightweight API server |

## Quick Start

Each example has its own `package.json`. To run:

```bash
cd examples/nextjs
npm install
cp .env.example .env  # Add your API keys
npm run dev
```

## Features Demonstrated

- **Streaming chat** — real-time token-by-token responses via ReadableStream
- **Structured output** — Zod schema validation with auto-repair
- **Cost tracking** — session budget enforcement and cost reports
- **Error handling** — actionable error messages with hints
- **Provider switching** — swap providers by changing one line of config
