/**
 * @hilbras/sdk — Error hierarchy
 *
 * All errors extend HilbrasSdkError for easy catching.
 * Each error carries context (provider name, status code, etc.)
 */

import { redact } from "../logging/logger.js";

export class HilbrasSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HilbrasSdkError";
  }
}

export class ProviderNotFoundError extends HilbrasSdkError {
  constructor(public readonly providerName: string) {
    super(`Provider '${providerName}' not found`);
    this.name = "ProviderNotFoundError";
  }
}

export class ModelNotFoundError extends HilbrasSdkError {
  constructor(
    public readonly modelId: string,
    public readonly providerName: string,
  ) {
    super(`Model '${modelId}' not found on provider '${providerName}'`);
    this.name = "ModelNotFoundError";
  }
}

export class ProviderRequestError extends HilbrasSdkError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly providerName: string,
  ) {
    // v0.9.3: redact API keys, bearer tokens, and JSON secret fields from
    // both the body stored on the instance and the rendered message. Provider
    // error bodies frequently echo the rejected API key on auth failures, and
    // the README example pattern (`console.error(...err.body)`) would otherwise
    // leak it into logs.
    const safeBody = redact(body);
    super(`Provider '${providerName}' returned HTTP ${status}: ${safeBody.slice(0, 200)}`);
    this.name = "ProviderRequestError";
    // Replace the public body with the redacted form.
    this.body = safeBody;
  }
}

export class StreamError extends HilbrasSdkError {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

export class InvalidFormatError extends HilbrasSdkError {
  constructor(public readonly format: string) {
    super(`Invalid or unsupported format: '${format}'`);
    this.name = "InvalidFormatError";
  }
}

export class ConfigurationError extends HilbrasSdkError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class CircuitBreakerOpenError extends HilbrasSdkError {
  constructor(public readonly providerName: string) {
    super(`Circuit breaker is open for provider '${providerName}' — requests blocked`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class ValidationError extends HilbrasSdkError {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
    public readonly lastRaw: string,
  ) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Structured output validation failed after ${attempts} attempt(s): ${msg.slice(0, 200)}`);
    this.name = "ValidationError";
  }
}
