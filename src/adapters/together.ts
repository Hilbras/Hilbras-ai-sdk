/**
 * @hilbras/sdk — Together AI Adapter
 *
 * Handles Together AI's OpenAI-compatible API.
 * Specializes in open-source model hosting.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type TogetherAdapterConfig = AdapterConfig;

export class TogetherAdapter extends GenericOpenAIAdapter {
  constructor(config: TogetherAdapterConfig) {
    super(config, {
      adapterId: "together",
      supportsNativeTools: true,
    });
  }
}
