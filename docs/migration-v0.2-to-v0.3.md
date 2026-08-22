# Migration Guide: v0.2.0 → v0.3.0

## Breaking Changes

**None for most users.** All existing APIs continue to work unchanged.

The only technically breaking change:
- `AdapterName` no longer includes `"responses"` — but no adapter ever implemented it, so no real code should reference it.

## What's New

### Universal Provider Contract

All adapters now implement the `AIProvider` interface:

```typescript
import type { AIProvider } from "@hilbras/sdk";

// All adapters satisfy this contract:
// OpenAIAdapter, AnthropicAdapter, GoogleGenAIAdapter, AzureAdapter, GroqAdapter, OllamaAdapter
```

Each adapter now has a `readonly id` property:

```typescript
const adapter = new OpenAIAdapter(config);
console.log(adapter.id);  // "openai"
```

### Plugin System

Register custom adapters without modifying the SDK:

```typescript
import { HilbrasClient, getDefaultAdapterRegistry } from "@hilbras/sdk";
import type { AIProvider, AdapterConfig } from "@hilbras/sdk/adapter";

class MistralAdapter implements AIProvider {
  readonly id = "mistral";
  async *stream(params) { /* ... */ }
  async complete(params) { /* ... */ }
}

const client = new HilbrasClient();
client.adapterRegistry.register("mistral", (config) => new MistralAdapter(config));

client.addProvider({
  name: "Mistral",
  baseUrl: "https://api.mistral.ai/v1",
  authentication: { type: "bearer", apiKey: "..." },
  adapter: "mistral" as any,  // or use string — registry handles it
  models: [],
});
```

### Custom Registry

Create a fresh registry with only the adapters you need:

```typescript
import { HilbrasClient, AdapterRegistry } from "@hilbras/sdk";

const registry = new AdapterRegistry();
registry.register("openai", (config) => new OpenAIAdapter(config));
// Only OpenAI is available — no other adapters loaded

const client = new HilbrasClient({ adapterRegistry: registry });
```

### Importing the Contract

```typescript
// Via subpath (tree-shakeable)
import type { AIProvider, AdapterConfig, GenerateParams } from "@hilbras/sdk/adapter";

// Via main export
import type { AIProvider, AdapterConfig, GenerateParams } from "@hilbras/sdk";
```

## Upgrading

```bash
npm install @hilbras/sdk@0.3.0
```

No code changes required for existing usage. Adopt the new features when ready.
