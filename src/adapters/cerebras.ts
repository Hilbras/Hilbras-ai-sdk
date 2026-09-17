/**
 * @hilbras/sdk — Cerebras Adapter
 *
 * Handles Cerebras's OpenAI-compatible API.
 * Specializes in ultra-fast inference with wafer-scale hardware.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type CerebrasAdapterConfig = AdapterConfig;

export class CerebrasAdapter extends GenericOpenAIAdapter {
  constructor(config: CerebrasAdapterConfig) {
    super(config, {
      adapterId: "cerebras",
      supportsNativeTools: true,
    });
  }
}
