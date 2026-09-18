/**
 * @hilbras/sdk — Adapter Registry
 *
 * Manages adapter factories. Built-in adapters (openai, anthropic, etc.)
 * are pre-registered. Third-party code can register custom adapters
 * without modifying the SDK core.
 *
 * Usage:
 *   import { getDefaultAdapterRegistry } from "@hilbras/sdk";
 *   const registry = getDefaultAdapterRegistry();
 *   registry.register("mistral", (config) => new MistralAdapter(config));
 */

import type { AIProvider, AdapterConfig } from "../types/adapter.js";
import { OpenAIAdapter } from "../adapters/openai.js";
import { AnthropicAdapter } from "../adapters/anthropic.js";
import { GoogleGenAIAdapter } from "../adapters/google-genai.js";
import { AzureAdapter } from "../adapters/azure.js";
import { GroqAdapter } from "../adapters/groq.js";
import { OllamaAdapter } from "../adapters/ollama.js";
import { GenericOpenAIAdapter } from "../adapters/openai-compatible.js";
import { MistralAdapter } from "../adapters/mistral.js";
import { DeepSeekAdapter } from "../adapters/deepseek.js";
import { XAIAdapter } from "../adapters/xai.js";
import { TogetherAdapter } from "../adapters/together.js";
import { FireworksAdapter } from "../adapters/fireworks.js";
import { CohereAdapter } from "../adapters/cohere.js";
import { PerplexityAdapter } from "../adapters/perplexity.js";
import { CerebrasAdapter } from "../adapters/cerebras.js";
import { DeepInfraAdapter } from "../adapters/deepinfra.js";
import { BedrockAdapter } from "../adapters/bedrock.js";
import { VertexAIAdapter } from "../adapters/google-vertex.js";
import { HuggingFaceAdapter } from "../adapters/huggingface.js";
import { DeepgramAdapter } from "../adapters/deepgram.js";
import { ElevenLabsAdapter } from "../adapters/elevenlabs.js";
import { VoyageAIAdapter } from "../adapters/voyageai.js";
import { CohereRerankAdapter } from "../adapters/cohere-rerank.js";

/** Factory function that creates an adapter from config */
export type AdapterFactory = (config: AdapterConfig) => AIProvider;

/**
 * Registry of adapter factories. Maps adapter IDs to their constructors.
 *
 * Built-in adapters are registered via `getDefaultAdapterRegistry()`.
 * Third-party code can create a custom registry or extend the default one.
 */
export class AdapterRegistry {
  private _factories = new Map<string, AdapterFactory>();

  /** Register a new adapter factory */
  register(id: string, factory: AdapterFactory): void {
    this._factories.set(id, factory);
  }

  /** Create an adapter instance by ID */
  create(id: string, config: AdapterConfig): AIProvider {
    const factory = this._factories.get(id);
    if (!factory) {
      throw new Error(
        `No adapter registered for "${id}". ` +
        `Registered adapters: ${this._factories.size > 0 ? [...this._factories.keys()].join(", ") : "(none)"}. ` +
        `Use registry.register() to add custom adapters.`
      );
    }
    return factory(config);
  }

  /** Check if an adapter ID is registered */
  has(id: string): boolean {
    return this._factories.has(id);
  }

  /** List all registered adapter IDs */
  list(): string[] {
    return [...this._factories.keys()];
  }

  /** Remove a registered adapter */
  remove(id: string): boolean {
    return this._factories.delete(id);
  }

  /** Number of registered adapters */
  get size(): number {
    return this._factories.size;
  }
}

/**
 * Create a new AdapterRegistry pre-loaded with all built-in adapters:
 * openai, anthropic, google-genai, azure, groq, ollama,
 * mistral, deepseek, xai, together, fireworks, cohere,
 * perplexity, cerebras, deepinfra, openai-compatible
 */
export function getDefaultAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();

  // Original 6 adapters
  registry.register("openai", (config) => new OpenAIAdapter(config));
  registry.register("anthropic", (config) => new AnthropicAdapter(config));
  registry.register("google-genai", (config) => new GoogleGenAIAdapter(config));
  registry.register("azure", (config) => new AzureAdapter(config));
  registry.register("groq", (config) => new GroqAdapter(config));
  registry.register("ollama", (config) => new OllamaAdapter(config));

  // v0.10.0: OpenAI-compatible adapters
  registry.register("openai-compatible", (config) => new GenericOpenAIAdapter(config));
  registry.register("mistral", (config) => new MistralAdapter(config));
  registry.register("deepseek", (config) => new DeepSeekAdapter(config));
  registry.register("xai", (config) => new XAIAdapter(config));
  registry.register("together", (config) => new TogetherAdapter(config));
  registry.register("fireworks", (config) => new FireworksAdapter(config));
  registry.register("cohere", (config) => new CohereAdapter(config));
  registry.register("perplexity", (config) => new PerplexityAdapter(config));
  registry.register("cerebras", (config) => new CerebrasAdapter(config));
  registry.register("deepinfra", (config) => new DeepInfraAdapter(config));
  registry.register("bedrock", (config) => new BedrockAdapter(config));
  registry.register("google-vertex", (config) => new VertexAIAdapter(config));
  registry.register("huggingface", (config) => new HuggingFaceAdapter(config));
  registry.register("deepgram", (config) => new DeepgramAdapter(config));
  registry.register("elevenlabs", (config) => new ElevenLabsAdapter(config));
  registry.register("voyageai", (config) => new VoyageAIAdapter(config));
  registry.register("cohere-rerank", (config) => new CohereRerankAdapter(config));

  return registry;
}
