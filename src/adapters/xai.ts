/**
 * @hilbras/sdk — xAI (Grok) Adapter
 *
 * Handles xAI's OpenAI-compatible API for Grok models.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type XAIAdapterConfig = AdapterConfig;

export class XAIAdapter extends GenericOpenAIAdapter {
  constructor(config: XAIAdapterConfig) {
    super(config, {
      adapterId: "xai",
      supportsNativeTools: true,
    });
  }
}
