# Getting Started

Step-by-step guide to integrating `@hilbras/sdk` into your project.

## 1. Install

```bash
npm install @hilbras/sdk
```

## 2. Create a Client

```typescript
import { HilbrasClient } from "@hilbras/sdk";

const client = new HilbrasClient();
```

## 3. Add a Provider

### OpenAI

```typescript
client.addProvider({
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  authentication: { type: "bearer", apiKey: "sk-..." },
  adapter: "openai",
  timeout: 60_000,
  models: [
    { id: "gpt-4.1", contextWindow: 1_048_576, maxOutputTokens: 32_768,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: true, parallelTools: true, systemPrompts: true } },
  ],
});
```

### Anthropic

```typescript
client.addProvider({
  name: "Anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  authentication: { type: "bearer", apiKey: "sk-ant-..." },
  adapter: "anthropic",
  timeout: 60_000,
  models: [
    { id: "claude-sonnet-4-20250514", contextWindow: 200_000, maxOutputTokens: 16_384,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
  ],
});
```

### Azure OpenAI

```typescript
client.addProvider({
  name: "Azure",
  baseUrl: "https://myinstance.openai.azure.com",
  authentication: { type: "bearer", apiKey: "your-azure-key" },
  adapter: "azure",
  timeout: 60_000,
  models: [
    { id: "gpt-4o", contextWindow: 128_000, maxOutputTokens: 16_384,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
  ],
});
```

### Groq

```typescript
client.addProvider({
  name: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  authentication: { type: "bearer", apiKey: "gsk_..." },
  adapter: "groq",
  models: [
    { id: "llama-4-maverick-17b-128e-instruct", contextWindow: 1_000_000, maxOutputTokens: 32_768,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
  ],
});
```

### Ollama (Local)

```typescript
client.addProvider({
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  authentication: { type: "none" },
  adapter: "ollama",
  models: [
    { id: "llama3.1", contextWindow: 128_000, maxOutputTokens: 8_192,
      capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false, parallelTools: false, systemPrompts: true } },
  ],
});
```

## 4. Stream a Response

```typescript
for await (const chunk of client.stream({
  provider: "OpenAI",
  model: "gpt-4.1",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
})) {
  switch (chunk.type) {
    case "text":
      process.stdout.write(chunk.text);
      break;
    case "reasoning":
      console.error("\n[Thinking]", chunk.text);
      break;
    case "usage":
      console.log(`\nTokens: ${chunk.inputTokens} in / ${chunk.outputTokens} out`);
      break;
    case "finish":
      console.log(`\n[Finished: ${chunk.reason}]`);
      break;
  }
}
```

## 5. Use Tool Calling

```typescript
const chunks = client.stream({
  provider: "OpenAI",
  model: "gpt-4.1",
  messages: [{ role: "user", content: "Read the file /etc/hostname" }],
  tools: [{
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
        },
        required: ["path"],
      },
    },
  }],
});

const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
for await (const chunk of chunks) {
  if (chunk.type === "tool_call") {
    toolCalls.push({ name: chunk.name!, args: JSON.parse(chunk.argumentsDelta!) });
  }
}

// Execute tools and continue the conversation
for (const tc of toolCalls) {
  console.log(`Tool: ${tc.name}`, tc.args);
  // ... execute the tool ...
}
```

## 6. Error Handling

```typescript
import {
  HilbrasSdkError,
  ProviderNotFoundError,
  ModelNotFoundError,
  ProviderRequestError,
  CircuitBreakerOpenError,
} from "@hilbras/sdk";

try {
  for await (const chunk of client.stream({ ... })) { ... }
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    console.error(`Provider ${err.providerName} is temporarily unavailable`);
  } else if (err instanceof ProviderRequestError) {
    console.error(`HTTP ${err.status} from ${err.providerName}`);
    console.error(err.body);
  } else if (err instanceof ModelNotFoundError) {
    console.error(`Model ${err.modelId} not found on ${err.providerName}`);
  } else if (err instanceof HilbrasSdkError) {
    console.error(err.message);
  }
}
```

## 7. Cleanup

```typescript
// Explicit cleanup
await client.dispose();

// Or use `using` for automatic cleanup (TypeScript 5.2+)
async function main() {
  using client = new HilbrasClient();
  client.addProvider({ ... });
  // client.dispose() called automatically when scope exits
}
```

## Next Steps

- Read the [API Reference](./api-reference.md) for complete type documentation
- See the [Providers guide](./providers.md) for adapter-specific examples
- See [Cost & Budget](./cost-and-budget.md) for budget enforcement
- See [Security](./security.md) for SSRF protection and redaction
- See [Observability](./observability.md) for lifecycle events
- See the [CHANGELOG](../CHANGELOG.md) for version history
