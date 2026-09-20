---
title: "Why I Built a Provider-Agnostic AI Execution Engine for TypeScript"
published: false
description: "Introducing @hilbras/sdk — a zero-dependency TypeScript SDK that goes beyond wrapping LLM APIs. It's an AI execution engine with routing, cost enforcement, circuit breaker, structured output, and security hardening."
tags: javascript, typescript, ai, llm
---

# Why I Built a Provider-Agnostic AI Execution Engine for TypeScript

Most LLM SDKs do one thing: wrap a provider's API. You call `openai.chat.completions.create()`, you get a response. That's it. No cost tracking, no automatic retries with backoff, no circuit breaker when a provider goes down, no validation that the model's output matches your schema.

I wanted more. So I built **`@hilbras/sdk`** — a provider-agnostic AI execution engine for TypeScript that treats every LLM call as a managed operation with full observability, reliability, and cost control.

## The Problem

When you build production AI applications, you quickly accumulate a pile of cross-cutting concerns:

- **Which provider should I use?** OpenAI for text, Claude for reasoning, Gemini for multimodal, Groq for speed...
- **What if the provider is down?** You need circuit breakers and automatic fallback.
- **What about costs?** A single runaway prompt can blow your budget.
- **How do I validate structured output?** The model returns JSON, but does it match your schema?
- **What about security?** Prompt injection, SSRF via provider URLs, API key leakage in errors.

Every team reimplements this plumbing. I wanted a single SDK that handles all of it.

## What @hilbras/sdk Does

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient({
  providers: [{ name: "openai", ... }],
  budget: { sessionBudget: 5.00 },
});

const result = await client.complete({
  messages: [{ role: "user", content: "Summarize this article" }],
  model: "gpt-4o",
  output: { schema: z.object({ summary: z.string(), tags: z.array(z.string()) }) },
});
// result is fully typed as { summary: string; tags: string[] }
```

Under the hood, the SDK is doing a lot more than just calling OpenAI:

1. **Cost estimation** before the call (and atomic budget reservation)
2. **Circuit breaker** check (is this provider healthy?)
3. **Streaming** with automatic reasoning normalization
4. **Structured output validation** with auto-repair (up to N attempts)
5. **Budget settlement** with actual usage data
6. **Hook emission** for observability (request start, completion, failure, retry)

## Key Features

### Zero Runtime Dependencies

The entire SDK — 23 provider adapters, circuit breaker, rate limiter, cost tracker, structured output validator — has **zero npm dependencies**. It runs everywhere: Node 18+, Bun, Deno, browsers, VS Code extensions, CLIs, edge runtimes.

### Provider Abstraction

Write your code against one interface. Switch providers by changing one line of config:

```typescript
// Switch from OpenAI to Anthropic — no code changes
client.addProvider({ name: "anthropic", ... });
```

### Circuit Breaker & Automatic Fallback

When a provider starts failing, the circuit breaker opens and blocks further requests. After a timeout, it half-opens and allows a test request. If it succeeds, the circuit closes. If it fails, it opens again.

Combined with fallback chains, your app stays available even when individual providers have outages.

### Cost Enforcement

Set a session budget or per-request budget. The SDK estimates cost before each call, reserves the budget atomically, and settles with actual usage after. If the estimate would exceed the budget, the request is rejected with a clear error message — before any API call is made.

### Actionable Error Messages

Every error carries structured context:

```typescript
try {
  await client.complete({ ... });
} catch (err) {
  if (err instanceof HilbrasSdkError) {
    console.log(err.toSummary());
    // "Provider 'openai' returned HTTP 429: Rate limited | request=req-abc | provider=openai | model=gpt-4 | hint="Rate limited by openai. Implement exponential backoff""
  }
}
```

### Security Hardening (v1.2.0+)

- **Prompt injection detection** with 27 built-in patterns across 8 categories
- **Client-side rate limiting** with token bucket algorithm
- **Advanced SSRF validation** including IPv6 scope IDs, DNS rebinding prevention, and unicode hostname normalization

### DevTools Dashboard (v1.3.0+)

```typescript
import { DevToolsDashboard } from "@hilbras/sdk";

const dashboard = new DevToolsDashboard();
dashboard.instrument(client.hooks);

// Get a full snapshot of your system
const snapshot = dashboard.snapshot();
console.log(dashboard.renderText());
// Renders: provider health, cost breakdown, routing decisions, throughput sparkline
```

## By the Numbers

- **1541 tests** across 76 test files
- **23 provider adapters** (OpenAI, Anthropic, Gemini, Azure, Groq, Ollama, Bedrock, Vertex, HuggingFace, Deepgram, ElevenLabs, Voyage, Cohere, and more)
- **Zero runtime dependencies**
- **~175KB** compiled output

## What's Next

The roadmap includes:
- **Framework examples** (Next.js, SvelteKit, Hono)
- **More provider adapters** (Mistral, Replicate, Together AI)
- **Distributed tracing** (OpenTelemetry integration is already partially built in)
- **Community contributions** — check the [good first issue](https://github.com/Hilbras/Hilbras-ai-sdk/issues) labels

## Try It

```bash
npm install @hilbras/sdk
```

GitHub: [github.com/Hilbras/Hilbras-ai-sdk](https://github.com/Hilbras/Hilbras-ai-sdk)
npm: [npmjs.com/package/@hilbras/sdk](https://www.npmjs.com/package/@hilbras/sdk)

---

*Built with TypeScript. MIT licensed. Zero dependencies.*
