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
};
const VISION_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, vision: true };
const REASONING_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, reasoning: true };
const FULL_CAPS: ModelCapabilities = { ...DEFAULT_CAPS, vision: true, reasoning: true, structuredOutput: true, parallelTools: true };

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
  { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", contextWindow: 1_048_576, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["4.1"] },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", contextWindow: 1_048_576, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["4.1-mini"] },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "openai", contextWindow: 1_048_576, maxOutput: 32_768, capabilities: VISION_CAPS, aliases: ["4.1-nano"] },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128_000, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["4o"] },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", contextWindow: 128_000, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["4o-mini"] },
  { id: "o3", name: "o3", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: FULL_CAPS, aliases: [] },
  { id: "o3-mini", name: "o3 Mini", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: REASONING_CAPS, aliases: ["o3-mini"] },
  { id: "o4-mini", name: "o4 Mini", provider: "openai", contextWindow: 200_000, maxOutput: 100_000, capabilities: FULL_CAPS, aliases: ["o4-mini"] },
  { id: "o1-preview", name: "o1 Preview", provider: "openai", contextWindow: 128_000, maxOutput: 32_768, capabilities: REASONING_CAPS, aliases: ["o1"] },
  { id: "o1-mini", name: "o1 Mini", provider: "openai", contextWindow: 128_000, maxOutput: 32_768, capabilities: REASONING_CAPS, aliases: [] },
  // ─── Azure ─────────────────────────────────────────────────────────
  { id: "gpt-4.1", name: "GPT-4.1 (Azure)", provider: "azure", contextWindow: 1_048_576, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["azure-4.1"] },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (Azure)", provider: "azure", contextWindow: 1_048_576, maxOutput: 32_768, capabilities: FULL_CAPS, aliases: ["azure-4.1-mini"] },
  { id: "gpt-4o", name: "GPT-4o (Azure)", provider: "azure", contextWindow: 128_000, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["azure-4o"] },
  { id: "gpt-4o-mini", name: "GPT-4o Mini (Azure)", provider: "azure", contextWindow: 128_000, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["azure-4o-mini"] },
  { id: "o3-mini", name: "o3 Mini (Azure)", provider: "azure", contextWindow: 200_000, maxOutput: 100_000, capabilities: REASONING_CAPS, aliases: ["azure-o3-mini"] },
  // ─── Anthropic ─────────────────────────────────────────────────────
  { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "anthropic", contextWindow: 200_000, maxOutput: 32_000, capabilities: FULL_CAPS, aliases: ["opus", "claude-opus"] },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", contextWindow: 200_000, maxOutput: 16_384, capabilities: VISION_CAPS, aliases: ["sonnet", "claude-4"] },
  { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", provider: "anthropic", contextWindow: 200_000, maxOutput: 16_384, capabilities: FULL_CAPS, aliases: ["claude-3.7"] },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", contextWindow: 200_000, maxOutput: 8_192, capabilities: VISION_CAPS, aliases: ["claude-3.5-sonnet"] },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", contextWindow: 200_000, maxOutput: 8_192, capabilities: VISION_CAPS, aliases: ["haiku"] },
  // ─── Google Gemini ─────────────────────────────────────────────────
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["gemini-pro", "2.5-pro"] },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 65_536, capabilities: FULL_CAPS, aliases: ["gemini-flash", "2.5-flash"] },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 8_192, capabilities: VISION_CAPS, aliases: ["2.0-flash"] },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google-genai", contextWindow: 2_000_000, maxOutput: 8_192, capabilities: VISION_CAPS, aliases: [] },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "google-genai", contextWindow: 1_000_000, maxOutput: 8_192, capabilities: VISION_CAPS, aliases: [] },
  // ─── Groq ──────────────────────────────────────────────────────────
  { id: "llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B", provider: "groq", contextWindow: 1_000_000, maxOutput: 32_768, capabilities: VISION_CAPS, aliases: ["llama-4-maverick", "maverick"] },
  { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B", provider: "groq", contextWindow: 1_000_000, maxOutput: 32_768, capabilities: VISION_CAPS, aliases: ["llama-4-scout", "scout"] },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq", contextWindow: 128_000, maxOutput: 32_768, capabilities: DEFAULT_CAPS, aliases: ["llama-3.3", "70b"] },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "groq", contextWindow: 128_000, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: ["llama-3.1", "8b"] },
  { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", provider: "groq", contextWindow: 128_000, maxOutput: 16_384, capabilities: REASONING_CAPS, aliases: ["deepseek-r1"] },
  { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "groq", contextWindow: 32_768, maxOutput: 32_768, capabilities: DEFAULT_CAPS, aliases: ["mixtral"] },
  { id: "gemma2-9b-it", name: "Gemma 2 9B", provider: "groq", contextWindow: 8_192, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: ["gemma2"] },
  // ─── Ollama (local) ────────────────────────────────────────────────
  { id: "llama3.1", name: "Llama 3.1 (local)", provider: "ollama", contextWindow: 128_000, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: ["llama3"] },
  { id: "llama3.3", name: "Llama 3.3 (local)", provider: "ollama", contextWindow: 128_000, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: [] },
  { id: "mistral", name: "Mistral (local)", provider: "ollama", contextWindow: 32_768, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: [] },
  { id: "qwen2.5-coder", name: "Qwen 2.5 Coder (local)", provider: "ollama", contextWindow: 32_768, maxOutput: 8_192, capabilities: DEFAULT_CAPS, aliases: ["qwen-coder"] },
  { id: "codellama", name: "CodeLlama (local)", provider: "ollama", contextWindow: 16_384, maxOutput: 4_096, capabilities: DEFAULT_CAPS, aliases: ["codellama7b"] },
];

export function findModel(query: string): ModelEntry | undefined {
  const q = query.toLowerCase();
  return BUILTIN_MODELS.find((m) => m.id === q || m.name.toLowerCase() === q || m.aliases?.includes(q));
}

export function modelsForProvider(provider: string): ModelEntry[] {
  return BUILTIN_MODELS.filter((m) => m.provider === provider);
}
