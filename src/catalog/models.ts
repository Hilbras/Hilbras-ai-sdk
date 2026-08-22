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
];

export function findModel(query: string): ModelEntry | undefined {
  const q = query.toLowerCase();
  return BUILTIN_MODELS.find((m) => m.id === q || m.name.toLowerCase() === q || m.aliases?.includes(q));
}

export function modelsForProvider(provider: string): ModelEntry[] {
  return BUILTIN_MODELS.filter((m) => m.provider === provider);
}
