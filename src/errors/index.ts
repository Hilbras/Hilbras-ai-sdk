/**
 * @hilbras/sdk — Error hierarchy
 *
 * All errors extend HilbrasSdkError for easy catching.
 * Each error carries structured context: provider, request ID, model,
 * cost impact, and actionable hints for resolution.
 */

import { redact } from "../logging/logger.js";

/**
 * Structured context attached to every SDK error
 */
export interface ErrorContext {
  /** Request ID for correlation with logs/hooks */
  requestId?: string;
  /** Provider name */
  provider?: string;
  /** Model ID */
  model?: string;
  /** Estimated or actual cost in dollars */
  cost?: number;
  /** Human-readable hint for resolution */
  hint?: string;
  /** Whether this error is retryable */
  retryable?: boolean;
  /** Suggested retry delay in ms */
  retryAfterMs?: number;
}

export class HilbrasSdkError extends Error {
  public readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = "HilbrasSdkError";
    this.context = context;
  }

  /** Formatted summary for logging */
  toSummary(): string {
    const parts: string[] = [this.message];
    if (this.context.requestId) parts.push(`request=${this.context.requestId}`);
    if (this.context.provider) parts.push(`provider=${this.context.provider}`);
    if (this.context.model) parts.push(`model=${this.context.model}`);
    if (this.context.cost != null) parts.push(`cost=$${this.context.cost.toFixed(4)}`);
    if (this.context.hint) parts.push(`hint="${this.context.hint}"`);
    return parts.join(" | ");
  }
}

export class ProviderNotFoundError extends HilbrasSdkError {
  constructor(
    public readonly providerName: string,
    availableProviders?: string[],
  ) {
    const hint = availableProviders?.length
      ? `Available providers: ${availableProviders.join(", ")}`
      : `Check provider name spelling and ensure it is registered via HilbrasClient constructor`;
    super(`Provider '${providerName}' not found`, {
      provider: providerName,
      hint,
    });
    this.name = "ProviderNotFoundError";
  }
}

export class ModelNotFoundError extends HilbrasSdkError {
  constructor(
    public readonly modelId: string,
    public readonly providerName: string,
    availableModels?: string[],
  ) {
    const hint = availableModels?.length
      ? `Available models on ${providerName}: ${availableModels.slice(0, 10).join(", ")}${availableModels.length > 10 ? ` (+${availableModels.length - 10} more)` : ""}`
      : `Check model ID spelling and ensure it is supported by ${providerName}`;
    super(`Model '${modelId}' not found on provider '${providerName}'`, {
      provider: providerName,
      model: modelId,
      hint,
    });
    this.name = "ModelNotFoundError";
  }
}

/** HTTP status code → actionable hint mapping */
function httpHint(status: number, providerName: string): string | undefined {
  switch (status) {
    case 401: return `Invalid or missing API key for ${providerName}. Check your API_KEY environment variable or provider config`;
    case 403: return `Access denied by ${providerName}. Your API key may lack required permissions or the model may not be available on your plan`;
    case 404: return `Resource not found on ${providerName}. Check the model ID and endpoint URL`;
    case 408: return `${providerName} request timed out. Try increasing timeoutMs or reducing input size`;
    case 413: return `Request payload too large for ${providerName}. Reduce input token count or use a model with a larger context window`;
    case 422: return `Invalid request parameters sent to ${providerName}. Check model capabilities and parameter compatibility`;
    case 429: return `Rate limited by ${providerName}. Implement exponential backoff or reduce request frequency`;
    case 500: return `${providerName} internal server error. This is usually transient — retry the request`;
    case 502: return `${providerName} gateway error. The service may be temporarily unavailable — retry with backoff`;
    case 503: return `${providerName} service unavailable. The provider may be experiencing high load — retry later`;
    case 529: return `${providerName} API is overloaded. Reduce request frequency and retry later`;
    default:
      if (status >= 500) return `${providerName} server error (${status}). This is likely transient — retry with exponential backoff`;
      if (status >= 400) return `Client error (${status}) from ${providerName}. Review the error body for details`;
      return undefined;
  }
}

export class ProviderRequestError extends HilbrasSdkError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly providerName: string,
    ctx?: { requestId?: string; model?: string; cost?: number },
  ) {
    const safeBody = redact(body);
    const hint = httpHint(status, providerName);
    super(`Provider '${providerName}' returned HTTP ${status}: ${safeBody.slice(0, 200)}`, {
      requestId: ctx?.requestId,
      provider: providerName,
      model: ctx?.model,
      cost: ctx?.cost,
      hint,
      retryable: status === 429 || status === 500 || status === 502 || status === 503 || status === 529,
      retryAfterMs: status === 429 ? parseRetryAfter(safeBody) : undefined,
    });
    this.name = "ProviderRequestError";
    this.body = safeBody;
  }
}

function parseRetryAfter(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.retry_after === "number") return parsed.retry_after * 1000;
    if (typeof parsed.retryAfter === "number") return parsed.retryAfter * 1000;
    if (parsed.error?.metadata?.retry_after) return parsed.error.metadata.retry_after * 1000;
  } catch { /* ignore */ }
  return undefined;
}

export class StreamError extends HilbrasSdkError {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly retryable = false,
    ctx?: { requestId?: string; model?: string },
  ) {
    super(message, {
      requestId: ctx?.requestId,
      provider: providerName,
      model: ctx?.model,
      retryable,
      hint: retryable
        ? `Stream interrupted on ${providerName} — this is usually transient, retry the request`
        : `Stream error on ${providerName} — check input validity and provider status`,
    });
    this.name = "StreamError";
  }
}

export class InvalidFormatError extends HilbrasSdkError {
  constructor(public readonly format: string) {
    super(`Invalid or unsupported format: '${format}'`, {
      hint: `Supported formats: json, text, image, audio, video. Check the format parameter`,
    });
    this.name = "InvalidFormatError";
  }
}

export class ConfigurationError extends HilbrasSdkError {
  constructor(message: string, hint?: string) {
    super(message, { hint });
    this.name = "ConfigurationError";
  }
}

export class CircuitBreakerOpenError extends HilbrasSdkError {
  constructor(
    public readonly providerName: string,
    ctx?: { failureCount?: number; retryAfterMs?: number },
  ) {
    const retryHint = ctx?.retryAfterMs
      ? `Circuit will half-open in ~${Math.round(ctx.retryAfterMs / 1000)}s`
      : `Circuit will half-open after the configured timeout`;
    super(`Circuit breaker is open for provider '${providerName}' — requests blocked`, {
      provider: providerName,
      hint: `${retryHint}. Alternatively, configure a different provider as fallback`,
      retryable: false,
      retryAfterMs: ctx?.retryAfterMs,
    });
    this.name = "CircuitBreakerOpenError";
  }
}

export class ValidationError extends HilbrasSdkError {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
    public readonly lastRaw: string,
    ctx?: { requestId?: string; model?: string; cost?: number },
  ) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Structured output validation failed after ${attempts} attempt(s): ${msg.slice(0, 200)}`, {
      requestId: ctx?.requestId,
      model: ctx?.model,
      cost: ctx?.cost,
      hint: `The model returned output that doesn't match the expected schema. Try: (1) simplifying the schema, (2) adding format instructions to the prompt, (3) using a model with better structured output support`,
    });
    this.name = "ValidationError";
  }
}
