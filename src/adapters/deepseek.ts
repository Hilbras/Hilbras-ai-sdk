/**
 * @hilbras/sdk — DeepSeek Adapter
 *
 * Handles DeepSeek's OpenAI-compatible API.
 * DeepSeek specializes in reasoning and coding models.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type DeepSeekAdapterConfig = AdapterConfig;

export class DeepSeekAdapter extends GenericOpenAIAdapter {
  constructor(config: DeepSeekAdapterConfig) {
    super(config, {
      adapterId: "deepseek",
      supportsNativeTools: true,
    });
  }
}
