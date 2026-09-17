/**
 * @hilbras/sdk — Perplexity Adapter
 *
 * Handles Perplexity's OpenAI-compatible API.
 * Perplexity specializes in search-augmented generation.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type PerplexityAdapterConfig = AdapterConfig;

export class PerplexityAdapter extends GenericOpenAIAdapter {
  constructor(config: PerplexityAdapterConfig) {
    super(config, {
      adapterId: "perplexity",
      supportsNativeTools: false,
    });
  }
}
