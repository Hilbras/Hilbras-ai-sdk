/**
 * @hilbras/sdk — Built-in Model Catalog
 *
 * Pre-configured model definitions for common providers.
 * Users can extend this with their own models via addProvider().
 */

import type { ModelCapabilities } from "../types/models.js";

const DEFAULT_CAPS: ModelCapabilities = {
  streaming: true, tools: true, vision: false, reasoning: false,
  structuredOutput: false, parallelTools: false, systemPrompts: true,
  embeddings: false, imageGeneration: false, speech: false, transcription: false, reranking: false,
};
const VISION_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, vision: true };
const REASONING_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, reasoning: true };
const FULL_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, vision: true, reasoning: true, structuredOutput: true, parallelTools: true };
const EMBEDDING_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, embeddings: true };
const IMAGE_GEN_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, imageGeneration: true };
const SPEECH_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, speech: true };
const TRANSCRIPTION_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, transcription: true };
const RERANK_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, reranking: true };

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: ModelCapabilities;
  aliases?: string[];
}

export const BUILTIN_MODELS: ModelEntry[] = [
  // ─── OpenAI ───────────────────────────────────────────────────────
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["5.6-sol", "gpt5.6"] },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["5.6-terra", "terra"] },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "openai", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: VISION_CAPS, aliases: ["5.6-luna", "luna"] },
  { id: "o3", name: "o3", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: FULL_CAPS, aliases: [] },
  { id: "o3-mini", name: "o3 Mini", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: REASONING_CAPS, aliases: [] },
  { id: "o4-mini", name: "o4 Mini", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: FULL_CAPS, aliases: ["o4-mini"] },
  // ─── Azure ─────────────────────────────────────────────────────────
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Azure)", provider: "azure", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["azure-5.6-sol"] },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra (Azure)", provider: "azure", contextWindow: 1_048_576, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["azure-5.6-terra"] },
  { id: "o3", name: "o3 (Azure)", provider: "azure", contextWindow: 200_000, maxOutput: 100_000, capabilities: FULL_CAPS, aliases: ["azure-o3"] },
  // ─── Anthropic ─────────────────────────────────────────────────────
  { id: "claude-fable-5", name: "Claude Fable 5", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["fable", "claude-fable"] },
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["opus", "claude-opus"] },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 131_072, capabilities: FULL_CAPS, aliases: ["sonnet", "claude-sonnet"] },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", contextWindow: 200_000, maxOutput: 65_536, capabilities: VISION_CAPS, aliases: ["haiku", "claude-haiku"] },
  // ─── Google Gemini ─────────────────────────────────────────────────
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["3.7-flash"] },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["3.6-flash"] },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["3.5-flash"] },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: VISION_CAPS, aliases: ["3.5-flash-lite"] },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["3.1-pro", "gemini-pro"] },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: VISION_CAPS, aliases: ["3.1-flash-lite"] },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["3-flash", "gemini-flash"] },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["2.5-pro"] },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: VISION_CAPS, aliases: ["2.5-flash"] },
  // ─── Groq ──────────────────────────────────────────────────────────
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["gpt-oss-120b", "gptoss"] },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "groq", contextWindow: 131_072, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["gpt-oss-20b"] },
  { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7", provider: "groq", contextWindow: 196_608, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["minimax-m2.7", "minimax"] },
  { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", provider: "groq", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["qwen3.6-27b", "qwen-3.6"] },
  { id: "groq/compound", name: "Groq Compound", provider: "groq", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["compound"] },
  { id: "groq/compound-mini", name: "Groq Compound Mini", provider: "groq", contextWindow: 131_072, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["compound-mini"] },
  // ─── Ollama (local) ────────────────────────────────────────────────
  { id: "llama4", name: "Llama 4 (local)", provider: "ollama", contextWindow: 1_000_000, maxOutput: 32_768, capabilities: VISION_CAPS, aliases: ["llama-4"] },
  { id: "qwen3", name: "Qwen 3 (local)", provider: "ollama", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["qwen-3"] },
  { id: "qwen3-coder", name: "Qwen 3 Coder (local)", provider: "ollama", contextWindow: 131_072, maxOutput: 16_384, capabilities: DEFAULT_CAPS, aliases: ["qwen-coder"] },
  { id: "deepseek-r1", name: "DeepSeek R1 (local)", provider: "ollama", contextWindow: 131_072, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: ["deepseek"] },
  { id: "mistral", name: "Mistral (local)", provider: "ollama", contextWindow: 32_768, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: [] },
  // ─── Mistral ─────────────────────────────────────────────────────
  { id: "mistral-large-latest", name: "Mistral Large", provider: "mistral", contextWindow: 128_000, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["mistral-large"] },
  { id: "mistral-small-latest", name: "Mistral Small", provider: "mistral", contextWindow: 128_000, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["mistral-small"] },
  { id: "codestral-latest", name: "Codestral", provider: "mistral", contextWindow: 256_000, maxOutput: 32_768, capabilities: DEFAULT_CAPS, aliases: ["codestral"] },
  { id: "pixtral-large-latest", name: "Pixtral Large", provider: "mistral", contextWindow: 128_000, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["pixtral"] },
  // ─── DeepSeek ────────────────────────────────────────────────────
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["deepseek-v3"] },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "deepseek", contextWindow: 131_072, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: ["deepseek-r1"] },
  // ─── xAI (Grok) ─────────────────────────────────────────────────
  { id: "grok-3", name: "Grok 3", provider: "xai", contextWindow: 131_072, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: [] },
  { id: "grok-3-mini", name: "Grok 3 Mini", provider: "xai", contextWindow: 131_072, maxOutput: 32_768, capabilities: REASONING_CAPS, aliases: [] },
  { id: "grok-3-fast", name: "Grok 3 Fast", provider: "xai", contextWindow: 131_072, maxOutput: 32_768, capabilities: VISION_CAPS, aliases: [] },
  // ─── Together AI ─────────────────────────────────────────────────
  { id: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", name: "Llama 3.1 405B Turbo", provider: "together", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["llama-405b"] },
  { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B Turbo", provider: "together", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["llama-70b"] },
  { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B Turbo", provider: "together", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["qwen-72b"] },
  { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", provider: "together", contextWindow: 131_072, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: [] },
  // ─── Fireworks ───────────────────────────────────────────────────
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", provider: "fireworks", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["fireworks-llama-70b"] },
  { id: "accounts/fireworks/models/mixtral-8x22b-instruct", name: "Mixtral 8x22B", provider: "fireworks", contextWindow: 65_536, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["fireworks-mixtral"] },
  { id: "accounts/fireworks/models/deepseek-r1", name: "DeepSeek R1", provider: "fireworks", contextWindow: 131_072, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: ["fireworks-deepseek"] },
  // ─── Cohere ──────────────────────────────────────────────────────
  { id: "command-r-plus-08-2024", name: "Command R+", provider: "cohere", contextWindow: 128_000, maxOutput: 4_096, capabilities: FULL_CAPS, aliases: ["command-r-plus"] },
  { id: "command-r-08-2024", name: "Command R", provider: "cohere", contextWindow: 128_000, maxOutput: 4_096, capabilities: DEFAULT_CAPS, aliases: ["command-r"] },
  // ─── Perplexity ──────────────────────────────────────────────────
  { id: "llama-3.1-sonar-large-128k-online", name: "Sonar Large", provider: "perplexity", contextWindow: 128_000, maxOutput: 4_096, capabilities: DEFAULT_CAPS, aliases: ["sonar-large"] },
  { id: "llama-3.1-sonar-small-128k-online", name: "Sonar Small", provider: "perplexity", contextWindow: 128_000, maxOutput: 4_096, capabilities: DEFAULT_CAPS, aliases: ["sonar-small"] },
  // ─── Cerebras ────────────────────────────────────────────────────
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", provider: "cerebras", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["cerebras-llama-70b"] },
  { id: "llama-3.1-8b", name: "Llama 3.1 8B", provider: "cerebras", contextWindow: 131_072, maxOutput: 16_384, capabilities: DEFAULT_CAPS, aliases: ["cerebras-llama-8b"] },
  // ─── DeepInfra ───────────────────────────────────────────────────
  { id: "meta-llama/Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B", provider: "deepinfra", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["deepinfra-llama-405b"] },
  { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", provider: "deepinfra", contextWindow: 131_072, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["deepinfra-qwen-72b"] },
  { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", provider: "deepinfra", contextWindow: 131_072, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: ["deepinfra-deepseek"] },

  // ─── Embedding Models ───────────────────────────────────────────────
  { id: "text-embedding-3-small", name: "Embedding 3 Small", provider: "openai", contextWindow: 8_191, maxOutput: 0, capabilities: EMBEDDING_CAPS, aliases: ["embedding-small"] },
  { id: "text-embedding-3-large", name: "Embedding 3 Large", provider: "openai", contextWindow: 8_191, maxOutput: 0, capabilities: EMBEDDING_CAPS, aliases: ["embedding-large"] },
  { id: "text-embedding-ada-002", name: "Embedding Ada 002", provider: "openai", contextWindow: 8_191, maxOutput: 0, capabilities: EMBEDDING_CAPS, aliases: ["ada-002"] },
  { id: "mistral-embed", name: "Mistral Embed", provider: "mistral", contextWindow: 8_191, maxOutput: 0, capabilities: EMBEDDING_CAPS, aliases: ["mistral-embedding"] },
  { id: "embed-english-v3.0", name: "Cohere Embed v3", provider: "cohere", contextWindow: 512, maxOutput: 0, capabilities: EMBEDDING_CAPS, aliases: ["cohere-embed"] },

  // ─── Image Generation Models ────────────────────────────────────────
  { id: "dall-e-3", name: "DALL-E 3", provider: "openai", contextWindow: 4_096, maxOutput: 0, capabilities: IMAGE_GEN_CAPS, aliases: ["dalle-3"] },
  { id: "dall-e-2", name: "DALL-E 2", provider: "openai", contextWindow: 4_096, maxOutput: 0, capabilities: IMAGE_GEN_CAPS, aliases: ["dalle-2"] },

  // ─── Speech Synthesis Models ────────────────────────────────────────
  { id: "tts-1", name: "TTS-1", provider: "openai", contextWindow: 4_096, maxOutput: 0, capabilities: SPEECH_CAPS, aliases: [] },
  { id: "tts-1-hd", name: "TTS-1 HD", provider: "openai", contextWindow: 4_096, maxOutput: 0, capabilities: SPEECH_CAPS, aliases: [] },

  // ─── Transcription Models ───────────────────────────────────────────
  { id: "whisper-1", name: "Whisper v1", provider: "openai", contextWindow: 0, maxOutput: 0, capabilities: TRANSCRIPTION_CAPS, aliases: ["whisper"] },
  { id: "whisper-large-v3", name: "Whisper Large v3", provider: "groq", contextWindow: 0, maxOutput: 0, capabilities: TRANSCRIPTION_CAPS, aliases: ["groq-whisper"] },

  // ─── Reranking Models ──────────────────────────────────────────────
  { id: "rerank-english-v3.0", name: "Cohere Rerank v3", provider: "cohere", contextWindow: 512, maxOutput: 0, capabilities: RERANK_CAPS, aliases: ["cohere-rerank"] },
  { id: "rerank-multilingual-v3.0", name: "Cohere Rerank Multilingual v3", provider: "cohere", contextWindow: 512, maxOutput: 0, capabilities: RERANK_CAPS, aliases: ["cohere-rerank-ml"] },
];

export function findModel(query: string): ModelEntry | undefined {
  const q = query.toLowerCase();
  return BUILTIN_MODELS.find((m) => m.id === q || m.name.toLowerCase() === q || m.aliases?.includes(q));
}

export function modelsForProvider(provider: string): ModelEntry[] {
  return BUILTIN_MODELS.filter((m) => m.provider === provider);
}
