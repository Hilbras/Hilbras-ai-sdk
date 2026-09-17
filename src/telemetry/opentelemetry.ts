/**
 * @hilbras/sdk — OpenTelemetry Integration
 *
 * Zero-dependency OpenTelemetry bridge. When @opentelemetry/api is installed,
 * creates spans and metrics automatically. When not installed, acts as a no-op.
 *
 * Usage:
 *   import { OpenTelemetryExporter } from "@hilbras/sdk";
 *
 *   // Auto-detects @opentelemetry/api if installed
 *   const otel = new OpenTelemetryExporter({ serviceName: "my-app" });
 *   client.on("request.completed", (e) => otel.recordRequest(e));
 *   client.on("request.failed", (e) => otel.recordError(e));
 *
 *   // Or use the built-in hook adapter
 *   otel.instrumentClient(client);
 */

import type { HookEvent, RequestCompletedEvent, RequestFailedEvent, RetryEvent } from "../types/observability.js";

/** Configuration for the OpenTelemetry exporter */
export interface OpenTelemetryConfig {
  /** Service name for traces and metrics */
  serviceName?: string;
  /** Whether to record metrics (default: true) */
  metrics?: boolean;
  /** Whether to record traces/spans (default: true) */
  traces?: boolean;
  /** Whether to record logs (default: true) */
  logs?: boolean;
}

/** Internal span interface (matches OpenTelemetry Span shape) */
interface Span {
  setAttribute(key: string, value: string | number): void;
  setStatus(status: { code: number; message?: string }): void;
  end(endTime?: number): void;
}

/** Internal meter interface */
interface Meter {
  createHistogram(name: string, options?: { description?: string }): Histogram;
  createCounter(name: string, options?: { description?: string }): Counter;
  createGauge(name: string, options?: { description?: string }): Gauge;
}

interface Histogram {
  record(value: number, attributes?: Record<string, string | number>): void;
}

interface Counter {
  add(value: number, attributes?: Record<string, string | number>): void;
}

interface Gauge {
  record(value: number, attributes?: Record<string, string | number>): void;
}

/** Minimal OTel API shape used internally — avoids hard dependency on @opentelemetry/api types */
interface MinimalOtelApi {
  trace: { getTracer(name: string): unknown };
  metrics: { getMeter(name: string): unknown };
}

/** Try to import @opentelemetry/api at runtime */
function getOpenTelemetryApi(): MinimalOtelApi | null {
  try {
    // Dynamic import that doesn't fail if not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const otel = require("@opentelemetry/api");
    return otel as MinimalOtelApi;
  } catch {
    return null;
  }
}

/**
 * OpenTelemetry exporter that bridges SDK hook events to OTel spans and metrics.
 *
 * Works with or without @opentelemetry/api installed — gracefully degrades to no-op.
 */
export class OpenTelemetryExporter {
  private _config: Required<OpenTelemetryConfig>;
  private _tracer: { startSpan(name: string): Span } | null = null;
  private _meter: Meter | null = null;

  // Metrics
  private _requestDuration?: Histogram;
  private _requestCount?: Counter;
  private _errorCount?: Counter;
  private _tokenUsage?: Histogram;
  private _activeRequests?: Gauge;
  private _retryCount?: Counter;

  constructor(config?: OpenTelemetryConfig) {
    this._config = {
      serviceName: config?.serviceName ?? "hilbras-sdk",
      metrics: config?.metrics ?? true,
      traces: config?.traces ?? true,
      logs: config?.logs ?? true,
    };

    const otel = getOpenTelemetryApi();
    if (otel) {
      if (this._config.traces) {
        this._tracer = otel.trace.getTracer(this._config.serviceName) as unknown as { startSpan(name: string): Span };
      }
      if (this._config.metrics) {
        this._meter = otel.metrics.getMeter(this._config.serviceName) as unknown as Meter;
        this._initMetrics();
      }
    }
  }

  private _initMetrics(): void {
    if (!this._meter) return;

    this._requestDuration = this._meter.createHistogram("llm.request.duration", {
      description: "Duration of LLM requests in milliseconds",
    });

    this._requestCount = this._meter.createCounter("llm.request.count", {
      description: "Total number of LLM requests",
    });

    this._errorCount = this._meter.createCounter("llm.error.count", {
      description: "Total number of LLM request errors",
    });

    this._tokenUsage = this._meter.createHistogram("llm.tokens", {
      description: "Token usage per request",
    });

    this._activeRequests = this._meter.createGauge("llm.requests.active", {
      description: "Number of currently active LLM requests",
    });

    this._retryCount = this._meter.createCounter("llm.retry.count", {
      description: "Total number of retries",
    });
  }

  /** Record a completed request */
  recordRequest(event: RequestCompletedEvent): void {
    const attrs = {
      provider: event.provider,
      model: event.model,
      structured_output: String(event.structuredOutput),
    };

    this._requestDuration?.record(event.durationMs, attrs);
    this._requestCount?.add(1, attrs);

    if (event.inputTokens) {
      this._tokenUsage?.record(event.inputTokens, { ...attrs, token_type: "input" });
    }
    if (event.outputTokens) {
      this._tokenUsage?.record(event.outputTokens, { ...attrs, token_type: "output" });
    }

    // Trace span
    if (this._tracer) {
      const span = this._tracer.startSpan(`llm.complete`);
      span.setAttribute("llm.provider", event.provider);
      span.setAttribute("llm.model", event.model);
      span.setAttribute("llm.duration_ms", event.durationMs);
      if (event.inputTokens) span.setAttribute("llm.input_tokens", event.inputTokens);
      if (event.outputTokens) span.setAttribute("llm.output_tokens", event.outputTokens);
      span.setStatus({ code: 0 }); // OK
      span.end();
    }
  }

  /** Record a failed request */
  recordError(event: RequestFailedEvent): void {
    const attrs = {
      provider: event.provider,
      model: event.model,
      error: event.error,
    };

    this._errorCount?.add(1, attrs);
    this._requestDuration?.record(event.durationMs, attrs);

    if (this._tracer) {
      const span = this._tracer.startSpan(`llm.complete`);
      span.setAttribute("llm.provider", event.provider);
      span.setAttribute("llm.model", event.model);
      span.setAttribute("llm.error", event.error);
      span.setStatus({ code: 2, message: event.error }); // ERROR
      span.end();
    }
  }

  /** Record a retry event */
  recordRetry(event: RetryEvent): void {
    this._retryCount?.add(1, {
      provider: event.provider,
      reason: event.reason,
    });
  }

  /** Record active request count */
  recordActiveRequests(count: number): void {
    this._activeRequests?.record(count);
  }

  /**
   * Automatically instrument a HilbrasClient by subscribing to hook events.
   * Returns an unsubscribe function.
   */
  instrumentClient(client: { on: (event: string, listener: (e: HookEvent) => void) => () => void }): () => void {
    const unsub1 = client.on("request.completed", (e) => {
      if (e.type === "request.completed") this.recordRequest(e);
    });
    const unsub2 = client.on("request.failed", (e) => {
      if (e.type === "request.failed") this.recordError(e);
    });
    const unsub3 = client.on("request.retrying", (e) => {
      if (e.type === "request.retrying") this.recordRetry(e);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }

  /** Check if OpenTelemetry is available */
  get isAvailable(): boolean {
    return this._tracer !== null || this._meter !== null;
  }
}
