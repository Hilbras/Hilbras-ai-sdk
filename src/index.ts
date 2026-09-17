/**
 * @hilbras/sdk — Public API
 *
 * Standalone LLM Client SDK. Zero UI dependencies.
 * Use in: Web UI, CLI, TUI, VS Code Extension, Runtime, External apps.
 */

// ─── Client ─────────────────────────────────────────────────────────────────
export { HilbrasClient } from "./client/client.js";
export type { HilbrasClientConfig } from "./client/client.js";

// ─── Types ──────────────────────────────────────────────────────────────────
export type { Role, Message, ToolCall, ToolCallFunction } from "./types/messages.js";
export { messageToDict, dictToMessage } from "./types/messages.js";

export type { Tool, ToolFunction, ToolParameters, ToolParameter } from "./types/tools.js";

export type { StreamChunk, TextChunk, ReasoningChunk, ToolCallChunk, UsageChunk, ErrorChunk } from "./types/streams.js";
export { chunk } from "./types/streams.js";

export type { APIFormat, Authentication, AdapterName, ProviderConfig } from "./types/providers.js";

export type { Model, ModelCapabilities } from "./types/models.js";
export { DEFAULT_CAPABILITIES } from "./types/models.js";

export type {
  EmbeddingParams,
  EmbeddingResult,
  ImageParams,
  ImageResult,
  SpeechParams,
  SpeechResult,
  TranscriptionParams,
  TranscriptionResult,
  RerankParams,
  RerankResult,
  ImageSize,
  ImageQuality,
  ImageStyle,
  SpeechVoice,
  SpeechFormat,
  TranscriptLanguage,
  TranscriptFormat,
} from "./types/multi-modal.js";

// ─── Errors ─────────────────────────────────────────────────────────────────
export {
  HilbrasSdkError,
  ProviderNotFoundError,
  ModelNotFoundError,
  ProviderRequestError,
  StreamError,
  InvalidFormatError,
  ConfigurationError,
  CircuitBreakerOpenError,
  ValidationError,
} from "./errors/index.js";

// ─── Providers ──────────────────────────────────────────────────────────────
export { ProviderRegistry } from "./providers/registry.js";
export { AdapterRegistry, getDefaultAdapterRegistry } from "./providers/adapter-registry.js";
export type { AdapterFactory } from "./providers/adapter-registry.js";

// ─── Provider Contract ──────────────────────────────────────────────────────
export type { AIProvider, AdapterConfig, GenerateParams } from "./types/adapter.js";

// ─── Observability ──────────────────────────────────────────────────────────
export type { HookEvent, HookEventType, HookListener, RequestStartEvent, RoutingResolvedEvent, RequestCompletedEvent, RequestFailedEvent, RetryEvent, CircuitBreakerOpenEvent, ValidationPassEvent, ValidationFailEvent, StreamFirstChunkEvent } from "./types/observability.js";

// ─── Model Router ───────────────────────────────────────────────────────────
export { ModelRouter } from "./router/model-router.js";
export type { TaskRequirement, RoutingResult } from "./types/router.js";

// ─── Structured Output ──────────────────────────────────────────────────────
export type { SchemaValidator, StructuredOutputConfig } from "./types/schema.js";
export { extractJson, buildJsonSystemInstruction, buildRepairPrompt, buildJsonModeParams } from "./output/structured.js";
export { zodSchema, jsonSchema } from "./output/schema-helpers.js";

// ─── Tool Builder ───────────────────────────────────────────────────────────
export { tool, toolDef, dynamicTool } from "./types/tool-builder.js";
export type { DefinedTool, ToolDefinition, ParameterSchema } from "./types/tool-builder.js";

// ─── Utilities ──────────────────────────────────────────────────────────────
export { generateId, createIdGenerator, shortId } from "./utils/id.js";
export { parseSSEStream, parseJsonEventStream, collectSSEEvents, findSSEEvent } from "./utils/sse.js";
export type { SSEEvent } from "./utils/sse.js";

// ─── Telemetry (Production Observability) ───────────────────────────────────
export { OpenTelemetryExporter } from "./telemetry/opentelemetry.js";
export type { OpenTelemetryConfig } from "./telemetry/opentelemetry.js";
export { StructuredLogger } from "./telemetry/structured-logger.js";
export type { StructuredLoggerConfig, StructuredLogEntry, LogLevel } from "./telemetry/structured-logger.js";
export { UsageDashboard } from "./telemetry/dashboard.js";
export type { UsageSummary, ProviderMetrics, ModelMetrics } from "./telemetry/dashboard.js";
export { BodyLogger } from "./telemetry/body-logger.js";
export type { BodyLoggerConfig, BodyLogEntry } from "./telemetry/body-logger.js";

// ─── Cost Optimization ──────────────────────────────────────────────────────
export { BudgetTracker } from "./cost/tracker.js";
export type { Reservation } from "./cost/tracker.js";
export type { CostEvent, CostReport, BudgetConfig } from "./cost/types.js";

// ─── Transport ──────────────────────────────────────────────────────────────
export type { Transport, TransportRequestInit } from "./transport/transport.js";
export { FetchTransport } from "./transport/fetch.js";
export { WebSocketTransport } from "./transport/websocket.js";

// ─── Reliability ────────────────────────────────────────────────────────────
export { CircuitBreaker, CircuitBreakerRegistry, getCircuitBreakerRegistry } from "./reliability/circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitBreakerStats, CircuitState } from "./reliability/circuit-breaker.js";

export { createRetryConfig, shouldRetry, shouldRetryNetworkError } from "./reliability/retry.js";
export type { RetryConfig } from "./reliability/retry.js";

export { createTimeoutSignal } from "./reliability/timeout.js";
export type { TimeoutConfig } from "./reliability/timeout.js";

export { calculateBackoff, sleep } from "./reliability/backoff.js";
export { resolvePolicy, getPreset } from "./reliability/presets.js";
export type { ExecutionPolicy, ResolvedPolicy, PolicyPreset } from "./types/policy.js";
export type { ExecutionPlan, ExecutionCandidate, ScoreBreakdown } from "./types/execution.js";
export { composeMiddlewares, authMiddleware, loggingMiddleware, retryMiddleware, rateLimitMiddleware, cacheMiddleware } from "./middleware/middleware.js";
export type { Middleware, MiddlewareContext } from "./middleware/middleware.js";
export { withDegradation, createDegradationChain } from "./reliability/degradation.js";
export type { DegradationLevel } from "./reliability/degradation.js";
export type { BackoffConfig } from "./reliability/backoff.js";

// ─── Reasoning ──────────────────────────────────────────────────────────────
export { ReasoningNormalizer } from "./reasoning/normalizer.js";

// ─── Tokens ────────────────────────────────────────────────────────────────
export { estimateTokens, estimateMessageTokens, estimateToolTokens, estimateCost } from "./tokens/counter.js";
export { cacheSystemMessage, cacheLastN, cacheAtIndex, autoCache, supportsCacheControl } from "./tokens/prompt-cache.js";
export type { TokenEstimate } from "./tokens/counter.js";
export type { CacheControl, CacheableMessage } from "./tokens/prompt-cache.js";

// ─── Config ───────────────────────────────────────────────────────────────
export { loadConfig, createConfig, validateConfig } from "./config/config.js";
export type { SDKConfig } from "./config/schema.js";
export { DEFAULT_CONFIG } from "./config/schema.js";
export { buildPrompt, buildToolSection, buildEnvironmentSection, buildCodingAgentPrompt } from "./config/prompts.js";

// ─── Credentials ────────────────────────────────────────────────────────────
export { DefaultCredentialProvider, getCredentialProvider, setCredentialProvider } from "./credentials/provider.js";
export type { CredentialSource, CredentialProvider } from "./credentials/provider.js";

// ─── Security (v0.9.3: SSRF guard) ─────────────────────────────────────────
export { validateBaseUrl } from "./security/url-guard.js";
export type { UrlGuardOptions, UrlGuardResult } from "./security/url-guard.js";

// ─── Adapters (advanced — usually not imported directly) ────────────────────
export { BUILTIN_MODELS, findModel, modelsForProvider } from "./catalog/models.js";
export type { ModelEntry } from "./catalog/models.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export { GoogleGenAIAdapter } from "./adapters/google-genai.js";
export { AzureAdapter } from "./adapters/azure.js";
export { GroqAdapter } from "./adapters/groq.js";
export { OllamaAdapter } from "./adapters/ollama.js";
export { GenericOpenAIAdapter } from "./adapters/openai-compatible.js";
export type { GenericOpenAIAdapterOptions } from "./adapters/openai-compatible.js";
export { MistralAdapter } from "./adapters/mistral.js";
export { DeepSeekAdapter } from "./adapters/deepseek.js";
export { XAIAdapter } from "./adapters/xai.js";
export { TogetherAdapter } from "./adapters/together.js";
export { FireworksAdapter } from "./adapters/fireworks.js";
export { CohereAdapter } from "./adapters/cohere.js";
export { PerplexityAdapter } from "./adapters/perplexity.js";
export { CerebrasAdapter } from "./adapters/cerebras.js";
export { DeepInfraAdapter } from "./adapters/deepinfra.js";
