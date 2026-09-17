/**
 * @hilbras/sdk — Multi-Modal Types
 *
 * Types for embedding, image generation, speech synthesis,
 * transcription, and reranking — the five non-chat model capabilities.
 */

// ─── Embeddings ─────────────────────────────────────────────────────────────

export interface EmbeddingParams {
  model: string;
  input: string | string[];
  dimensions?: number;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: { inputTokens: number; totalTokens: number };
}

// ─── Image Generation ───────────────────────────────────────────────────────

export type ImageSize = "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
export type ImageQuality = "standard" | "hd";
export type ImageStyle = "vivid" | "natural";

export interface ImageParams {
  model: string;
  prompt: string;
  n?: number;
  size?: ImageSize;
  quality?: ImageQuality;
  style?: ImageStyle;
  responseFormat?: "url" | "b64_json";
  signal?: AbortSignal;
}

export interface ImageResult {
  images: Array<{ url?: string; b64Json?: string; revisedPrompt?: string }>;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// ─── Speech Synthesis ───────────────────────────────────────────────────────

export type SpeechVoice = "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer";
export type SpeechFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export interface SpeechParams {
  model: string;
  input: string;
  voice: SpeechVoice;
  responseFormat?: SpeechFormat;
  speed?: number;
  signal?: AbortSignal;
}

export interface SpeechResult {
  audio: Uint8Array;
  format: SpeechFormat;
}

// ─── Transcription ──────────────────────────────────────────────────────────

export type TranscriptLanguage = "en" | "es" | "fr" | "de" | "it" | "pt" | "ru" | "ja" | "ko" | "zh";
export type TranscriptFormat = "json" | "text" | "srt" | "verbose_json";

export interface TranscriptionParams {
  model: string;
  file: File | Blob | Uint8Array;
  language?: TranscriptLanguage;
  prompt?: string;
  responseFormat?: TranscriptFormat;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

// ─── Reranking ──────────────────────────────────────────────────────────────

export interface RerankParams {
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  signal?: AbortSignal;
}

export interface RerankResult {
  results: Array<{ index: number; relevanceScore: number; document?: string }>;
  usage?: { inputTokens: number; totalTokens: number };
}
