# Reddit / Hacker News Post Draft

## Title Options

**Reddit (r/typescript, r/node):**
> I built a provider-agnostic AI execution engine for TypeScript — zero dependencies, 23 providers, circuit breaker, cost enforcement, structured output

**Hacker News:**
> Show HN: @hilbras/sdk – Provider-agnostic AI execution engine for TypeScript (zero deps)

## Body

I've been building AI-powered features for the past year and kept running into the same problems:

1. **Vendor lock-in** — switching providers meant rewriting code
2. **No cost control** — a single bad prompt could blow the budget
3. **No reliability** — when a provider goes down, the app goes down
4. **No validation** — the model returns JSON but it doesn't match your schema
5. **Security concerns** — prompt injection, SSRF via provider URLs, API key leakage

So I built `@hilbras/sdk` — a TypeScript SDK that treats every LLM call as a managed operation.

### What it does

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient({
  providers: [{ name: "openai", ... }],
  budget: { sessionBudget: 5.00 },
});

const result = await client.complete({
  messages: [{ role: "user", content: "Summarize this" }],
  model: "gpt-4o",
  output: { schema: z.object({ summary: z.string(), tags: z.array(z.string()) }) },
});
// result is typed as { summary: string; tags: string[] }
```

Under the hood: cost estimation → circuit breaker check → streaming with reasoning normalization → structured output validation with auto-repair → budget settlement → observability hooks.

### Key features

- **Zero runtime dependencies** — the entire SDK, 23 adapters, everything
- **23 provider adapters** — OpenAI, Anthropic, Gemini, Azure, Groq, Ollama, Bedrock, Vertex, HuggingFace, Deepgram, ElevenLabs, Voyage, Cohere, and more
- **Circuit breaker & fallback** — automatic provider failover
- **Cost enforcement** — session and per-request budgets with atomic reservation
- **Structured output** — schema validation with auto-repair
- **Security** — prompt injection detection, SSRF validation, rate limiting
- **DevTools dashboard** — real-time metrics, provider health, cost tracking
- **Actionable errors** — every error carries request ID, provider, cost, and hints

### Numbers

- 1541 tests across 76 test files
- ~175KB compiled
- Strict TypeScript throughout
- MIT licensed

### Links

- GitHub: https://github.com/Hilbras/Hilbras-ai-sdk
- npm: https://www.npmjs.com/package/@hilbras/sdk

Would love feedback, contributions, and suggestions for what to build next.
