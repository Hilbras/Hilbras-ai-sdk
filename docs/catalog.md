# Provider Catalog

Runtime provider and model discovery with search capabilities.

## Usage

```typescript
import { loadCatalog, listProviders, searchModels, getModelsForProvider } from "@hilbras/sdk/catalog";

// Load the full catalog
const catalog = await loadCatalog();
console.log(catalog.providers.length);  // 17

// List all providers
const providers = await listProviders();
// Returns: [{ id, name, models, capabilities }, ...]

// Search models
const results = await searchModels("gpt-4o");
// Returns models matching "gpt-4o" across all providers

// Get models for a specific provider
const openaiModels = await getModelsForProvider("openai");
// Returns all OpenAI models with capabilities
```

## Catalog Data

The catalog includes 17 providers with 100+ models:

| Provider | Models | Capabilities |
|----------|--------|--------------|
| OpenAI | GPT-4o, GPT-4o-mini, o1, o3 | streaming, tools, vision, reasoning |
| Anthropic | Claude Sonnet 4.5, Claude Haiku 4.5 | streaming, tools, vision, reasoning |
| Google | Gemini 2.5 Flash, Gemini 2.5 Pro | streaming, tools, vision, reasoning |
| Azure | OpenAI models via Azure | streaming, tools, vision |
| Groq | Llama 3.3, Mixtral | streaming, tools |
| Ollama | Local models | streaming, tools |
| Bedrock | Claude, Llama via AWS | streaming, tools, vision |
| Vertex AI | Gemini, Claude via GCP | streaming, tools, vision |
| HuggingFace | Open models | streaming, tools |
| Deepgram | Nova models | transcription |
| ElevenLabs | Multilingual v2, Turbo v2 | speech |
| Voyage AI | voyage-3, voyage-code-3 | embeddings |
| Cohere Rerank | rerank-v3.5, rerank-english-v3.0 | reranking |

## Model Capabilities

Each model includes capability flags:

```typescript
{
  id: "gpt-4o",
  contextWindow: 128000,
  maxOutputTokens: 16384,
  capabilities: {
    streaming: true,
    tools: true,
    vision: true,
    reasoning: true,
    structuredOutput: true,
    parallelTools: true,
    systemPrompts: true,
  },
  pricing: {
    input: 2.5,   // per 1M tokens
    output: 10,
  },
}
```
