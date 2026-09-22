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
export { messageToDict, dictToMessage, isContentParts, extractText, textContent, imageContent, audioContent } from "./types/messages.js";
export type { ContentPart, TextContentPart, ImageContentPart, AudioContentPart } from "./types/messages.js";

export type { Tool, ToolFunction, ToolParameters, ToolParameter } from "./types/tools.js";

export type { StreamChunk, TextChunk, ReasoningChunk, ToolCallChunk, UsageChunk, ErrorChunk, FinishChunk, PerformanceChunk } from "./types/streams.js";
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
export type { SchemaValidator, StructuredOutputConfig, StreamObjectOptions, StreamObjectChunk } from "./types/schema.js";
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
export { MiddlewareTransport } from "./transport/middleware-transport.js";

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
export { estimateTokens, estimateMessageTokens, estimateToolTokens, estimateCost, setTokenizer, getTokenizer } from "./tokens/counter.js";
export { cacheSystemMessage, cacheLastN, cacheAtIndex, autoCache, supportsCacheControl } from "./tokens/prompt-cache.js";
export type { TokenEstimate, Tokenizer } from "./tokens/counter.js";
export type { CacheControl, CacheableMessage } from "./tokens/prompt-cache.js";

// ─── Config ───────────────────────────────────────────────────────────────
export { loadConfig, createConfig, validateConfig } from "./config/config.js";
export type { SDKConfig } from "./config/schema.js";
export { DEFAULT_CONFIG } from "./config/schema.js";
export { buildPrompt, buildToolSection, buildEnvironmentSection, buildCodingAgentPrompt } from "./config/prompts.js";

// ─── Credentials ────────────────────────────────────────────────────────────
export { DefaultCredentialProvider, getCredentialProvider, setCredentialProvider } from "./credentials/provider.js";
export type { CredentialSource, CredentialProvider } from "./credentials/provider.js";

// ─── Security (v0.9.3: SSRF guard, v0.14.0: HMAC signing, PII, audit) ──────
export { validateBaseUrl } from "./security/url-guard.js";
export type { UrlGuardOptions, UrlGuardResult } from "./security/url-guard.js";
export { RequestSigner, signingMiddleware } from "./security/request-signer.js";
export type { RequestSignerConfig, SignedRequest } from "./security/request-signer.js";
export { redactPii, detectPii, createPiiRedactor } from "./security/pii-guard.js";
export type { PiiType, PiiMatch, PiiGuardConfig } from "./security/pii-guard.js";
export { AuditLogger, createRetentionPolicy } from "./security/audit-logger.js";
export type { AuditCategory, AuditSeverity, AuditEntry, AuthAuditEntry, DataAccessAuditEntry, ConfigChangeAuditEntry, SecurityAuditEntry, AuditLoggerConfig } from "./security/audit-logger.js";
export { RateLimiter, createRateLimiter, RateLimiterRegistry } from "./security/rate-limiter.js";
export type { RateLimiterConfig, ThrottleInfo, RateLimiterStats } from "./security/rate-limiter.js";

// ─── Security: Prompt Injection ──────────────────────────────────────────────
export {
  detectInjection,
  scanMessages,
  createInjectionGuard,
  INJECTION_PATTERNS,
} from "./security/prompt-injection-guard.js";
export type {
  InjectionDetection,
  InjectionMatch,
  InjectionGuardConfig,
} from "./security/prompt-injection-guard.js";

// ─── Security: Enhanced SSRF ─────────────────────────────────────────────────
export {
  validateResolvedAddress,
  normalizeHostname,
  validateUrlForTransport,
} from "./security/url-guard.js";

// ─── OIDC Credentials ───────────────────────────────────────────────────────
export { OidcCredentialProvider, OidcError, oidcSource } from "./credentials/oidc.js";
export type { OidcConfig } from "./credentials/oidc.js";

// ─── UIMessage Protocol ─────────────────────────────────────────────────────
export type {
  UIMessage,
  UIToolInvocation,
  DataAnnotation,
  UIProtocolMessage,
  UseChatOptions,
  UseChatState,
  UseChatActions,
  UseCompletionOptions,
  UseCompletionState,
  UseCompletionActions,
} from "./types/ui-protocol.js";

// ─── Catalog ────────────────────────────────────────────────────────────────
export { BUILTIN_MODELS, findModel, modelsForProvider } from "./catalog/models.js";
export type { ModelEntry } from "./catalog/models.js";
export { loadCatalog, listProviders, getProviderCatalog, searchModels, getModelsForProvider } from "./catalog/index.js";
export type { CatalogModel, CatalogProvider, ProviderCatalog } from "./catalog/index.js";

// ─── Adapters (advanced — usually not imported directly) ────────────────────
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
export { BedrockAdapter } from "./adapters/bedrock.js";
export type { BedrockAdapterConfig } from "./adapters/bedrock.js";
export { VertexAIAdapter } from "./adapters/google-vertex.js";
export type { VertexAIAdapterConfig } from "./adapters/google-vertex.js";
export { HuggingFaceAdapter } from "./adapters/huggingface.js";
export type { HuggingFaceAdapterConfig } from "./adapters/huggingface.js";
export { DeepgramAdapter } from "./adapters/deepgram.js";
export { ElevenLabsAdapter } from "./adapters/elevenlabs.js";
export type { ElevenLabsAdapterConfig } from "./adapters/elevenlabs.js";
export { VoyageAIAdapter } from "./adapters/voyageai.js";
export { CohereRerankAdapter } from "./adapters/cohere-rerank.js";
export type { CohereRerankAdapterConfig } from "./adapters/cohere-rerank.js";

// ─── MCP ────────────────────────────────────────────────────────────────────
export { MCPClient, createMCPToolExecution } from "./mcp/index.js";
export type { MCPServerConfig, MCPTool, MCPResource, MCPPrompt, MCPConnection } from "./mcp/index.js";

// ─── Realtime ───────────────────────────────────────────────────────────────
export { RealtimeSession } from "./realtime/index.js";
export type { RealtimeSessionConfig, RealtimeEvent, RealtimeEventHandler } from "./realtime/index.js";

// ─── DevTools ───────────────────────────────────────────────────────────────
export { DevTools, DevToolsDashboard } from "./devtools/index.js";
export type {
  DevToolsConfig, LogEntry, RequestMetrics,
  DashboardConfig, DashboardSnapshot, RequestTimelineEntry,
  ProviderHealth, CostSnapshot, RoutingDecision, ThroughputSample,
} from "./devtools/index.js";

// ─── SSE Streaming Utilities ────────────────────────────────────────────────
export {
  createSSEStream,
  createSSEResponse,
  createObjectSSEStream,
  createObjectSSEResponse,
} from "./utils/sse-writer.js";
export type { SSEWriterOptions } from "./utils/sse-writer.js";

// ─── Plugin System (v3.0.0) ────────────────────────────────────────────────
export type { Plugin, PluginRequestContext, PluginResponseContext, PluginErrorContext } from "./plugin/types.js";
export { PluginRegistry } from "./plugin/registry.js";

// ─── RBAC (v3.0.0) ─────────────────────────────────────────────────────────
export { createRBACMiddleware, checkPermission } from "./security/rbac.js";
export type { RBACRole, RBACConfig, PermissionCheck } from "./security/rbac.js";

// ─── Cost Alerts (v3.0.0) ──────────────────────────────────────────────────
export { CostAlertMonitor, createCostAlertBudget } from "./cost/alerts.js";
export type { AlertChannel, ThresholdConfig, CostAlert, CostAlertConfig } from "./cost/alerts.js";

// ─── A/B Prompt Testing (v3.0.0) ───────────────────────────────────────────
export { runABTest } from "./features/eval/ab-test.js";
export type { PromptVariant, ABTestConfig, VariantResult, ABTestResult } from "./features/eval/ab-test.js";

// ─── SLA Monitoring (v3.0.0) ───────────────────────────────────────────────
export { SLAMonitor } from "./telemetry/sla.js";
export type { SLADefinition, SLABreach, SLAStatus, SLAReport, SLAMetric } from "./telemetry/sla.js";
