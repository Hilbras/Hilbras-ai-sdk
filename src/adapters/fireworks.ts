/**
 * @hilbras/sdk — Fireworks AI Adapter
 *
 * Handles Fireworks AI's OpenAI-compatible API.
 * Specializes in fast, low-latency inference.
 */

import type { AdapterConfig } from "../types/adapter.js";
import { GenericOpenAIAdapter } from "./openai-compatible.js";

export type FireworksAdapterConfig = AdapterConfig;

export class FireworksAdapter extends GenericOpenAIAdapter {
  constructor(config: FireworksAdapterConfig) {
    super(config, {
      adapterId: "fireworks",
      supportsNativeTools: true,
    });
  }
}
