/**
 * @hilbras/sdk — Mistral Adapter
 *
 * Handles Mistral's OpenAI-compatible API.
 * Supports native tool calling and reasoning.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type MistralAdapterConfig = AdapterConfig;

export class MistralAdapter extends GenericOpenAIAdapter {
  constructor(config: MistralAdapterConfig) {
    super(config, {
      adapterId: "mistral",
      supportsNativeTools: true,
    });
  }
}
