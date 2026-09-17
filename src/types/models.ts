/**
 * @hilbras/sdk — Model types with capabilities
 *
 * Rich model definitions that enable the future Model Router:
 * user request → required capabilities → compatible models → optimization → selected model
 */

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  parallelTools: boolean;
  systemPrompts: boolean;
  /** Model supports text embeddings (e.g. text-embedding-3-small) */
  embeddings: boolean;
  /** Model supports image generation (e.g. dall-e-3) */
  imageGeneration: boolean;
  /** Model supports speech synthesis (e.g. tts-1) */
  speech: boolean;
  /** Model supports audio transcription (e.g. whisper-1) */
  transcription: boolean;
  /** Model supports document reranking (e.g. cohere rerank) */
  reranking: boolean;
}

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  tools: true,
  vision: false,
  reasoning: false,
  structuredOutput: false,
  parallelTools: false,
  systemPrompts: true,
  embeddings: false,
  imageGeneration: false,
  speech: false,
  transcription: false,
  reranking: false,
};

export interface Model {
  id: string;
  contextWindow: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
}
