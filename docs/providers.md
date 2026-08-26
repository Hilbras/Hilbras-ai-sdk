# Providers

`@hilbras/sdk` ships with 6 built-in adapters covering the major LLM
providers. Every adapter implements the same `AIProvider` contract so the
rest of the SDK is provider-agnostic.

## Supported providers

| Provider | Adapter | Streaming | Tool Calls | Reasoning | Notes |
|---|---|---|---|---|---|
| **OpenAI** | `openai` | ✅ | ✅ native + text-embedded | ✅ | GPT-5.6, o3, o4-mini and OpenAI-compatible APIs (DeepSeek, Qwen, Mistral, etc.) |
| **Anthropic** | `anthropic` | ✅ | ✅ native | ✅ | Claude Opus 4, Sonnet 4, Haiku 4 |
| **Google Gemini** | `google-genai` | ✅ | ✅ native | ✅ | Gemini 2.5/2.0 Flash, 1.5 Pro |
| **Azure OpenAI** | `azure` | ✅ | ✅ native | ✅ | Uses `api-key` header + `api-version` query param |
| **Groq** | `groq` | ✅ | text-embedded | ✅ | GPT-OSS, Llama 3.x, Qwen |
| **Ollama** | `ollama` | ✅ | text-embedded | ✅ | Local models, no auth |

## Adding a provider

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();

client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
  adapter: "openai",
  models: [
    {
      id: "gpt-5.6",
      contextWindow: 1_048_576,
      maxOutputTokens: 131_072,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        reasoning: true,
        structuredOutput: true,
        parallelTools: true,
        systemPrompts: true,
      },
    },
  ],
});
```

## Provider examples

### OpenAI

```typescript
client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: process.env.OPENAI_API_KEY! },
  adapter: "openai",
  models: [{ id: "gpt-5.6", contextWindow: 1_048_576, capabilities: { /* ... */ } }],
});
```

The same configuration works for any OpenAI-compatible API by changing
`baseUrl` (e.g. `https://api.deepseek.com/v1`, `https://openrouter.ai/api/v1`).

### Anthropic

```typescript
client.addProvider({
  name: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  authentication: { type: "header", name: "x-api-key", value: process.env.ANTHROPIC_API_KEY! },
  adapter: "anthropic",
  models: [{ id: "claude-sonnet-4-5", contextWindow: 200_000, capabilities: { /* ... */ } }],
});
```

### Google Gemini

```typescript
client.addProvider({
  name: "Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  authentication: { type: "bearer", apiKey: process.env.GEMINI_API_KEY! },
  adapter: "google-genai",
  models: [{ id: "gemini-2.5-flash", contextWindow: 1_000_000, capabilities: { /* ... */ } }],
});
```

### Azure OpenAI

```typescript
client.addProvider({
  name: "Azure",
  baseUrl: "https://myinstance.openai.azure.com",
  authentication: { type: "header", name: "api-key", value: process.env.AZURE_API_KEY! },
  adapter: "azure",
  models: [{ id: "gpt-5.6", contextWindow: 1_048_576, capabilities: { /* ... */ } }],
});
```

### Groq

```typescript
client.addProvider({
  name: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  authentication: { type: "bearer", apiKey: process.env.GROQ_API_KEY! },
  adapter: "groq",
  models: [{ id: "llama-3.3-70b-versatile", contextWindow: 128_000, capabilities: { /* ... */ } }],
});
```

### Ollama (local)

```typescript
client.addProvider({
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  authentication: { type: "none" },
  adapter: "ollama",
  allowInsecure: true, // required for http://
  models: [{ id: "llama3.3", contextWindow: 128_000, capabilities: { /* ... */ } }],
});
```

## Custom providers

To add a provider that isn't built in, implement the `AIProvider` contract
and register it via the `AdapterRegistry`:

```typescript
import { HilbrasClient, AdapterRegistry } from "@hilbras/sdk";
import type { AIProvider } from "@hilbras/sdk/adapter";

class MyAdapter implements AIProvider {
  readonly id = "my-provider";
  async *stream(params) { /* ... */ }
  async complete(params) { /* ... */ }
}

const registry = new AdapterRegistry();
registry.register("my-provider", (config) => new MyAdapter(config));

const client = new HilbrasClient({ adapterRegistry: registry });
```

## Authentication

Three authentication types are supported:

- `bearer` — adds `Authorization: Bearer <apiKey>` (OpenAI, Gemini, Groq)
- `header` — adds a custom header (Anthropic's `x-api-key`, Azure's
  `api-key`, or any custom auth)
- `none` — no auth header (Ollama local)

## URL validation

By default, only `https://` URLs are accepted. See
[Security & SSRF Protection](security.md) for the full policy and the
`allowInsecure` / `allowInsecureUrls` / `allowPrivateNetwork` opt-ins.
