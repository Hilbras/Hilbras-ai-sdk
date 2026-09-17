/**
 * @hilbras/sdk — DeepInfra Adapter
 *
 * Handles DeepInfra's OpenAI-compatible API.
 * Hosts a wide variety of open-source models.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type DeepInfraAdapterConfig = AdapterConfig;

export class DeepInfraAdapter extends GenericOpenAIAdapter {
  constructor(config: DeepInfraAdapterConfig) {
    super(config, {
      adapterId: "deepinfra",
      supportsNativeTools: true,
    });
  }
}
