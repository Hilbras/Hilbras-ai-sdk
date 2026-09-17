/**
 * @hilbras/sdk — Telemetry Module tests
 *
 * Tests OpenTelemetry exporter, structured logger, usage dashboard,
 * and body logger.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenTelemetryExporter } from "../src/telemetry/opentelemetry.js";
import { StructuredLogger } from "../src/telemetry/structured-logger.js";
import { UsageDashboard } from "../src/telemetry/dashboard.js";
import { BodyLogger } from "../src/telemetry/body-logger.js";
import type { RequestCompletedEvent, RequestFailedEvent, RetryEvent, StreamFirstChunkEvent } from "../src/types/observability.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function completedEvent(overrides?: Partial<RequestCompletedEvent>): RequestCompletedEvent {
  return {
    type: "request.completed",
    requestId: "req_1",
    timestamp: 0,
    provider: "openai",
    model: "gpt-5.6",
    durationMs: 150,
    attempts: 1,
    structuredOutput: false,
    ...overrides,
  };
}

function failedEvent(overrides?: Partial<RequestFailedEvent>): RequestFailedEvent {
  return {
    type: "request.failed",
    requestId: "req_2",
    timestamp: 0,
    provider: "anthropic",
    model: "claude-4",
    durationMs: 300,
    attempts: 3,
    error: "rate_limit_exceeded",
    ...overrides,
  };
}

function retryEvent(overrides?: Partial<RetryEvent>): RetryEvent {
  return {
    type: "request.retrying",
    requestId: "req_3",
    timestamp: 0,
    provider: "openai",
    attempt: 0,
    delayMs: 1000,
    reason: "429 rate limit",
    ...overrides,
  };
}

function firstChunkEvent(overrides?: Partial<StreamFirstChunkEvent>): StreamFirstChunkEvent {
  return {
    type: "stream.first_chunk",
    requestId: "req_4",
    timestamp: 0,
    latencyMs: 200,
    ...overrides,
  };
}

// ─── OpenTelemetry Exporter ─────────────────────────────────────────────────

describe("OpenTelemetryExporter", () => {
  it("creates without @opentelemetry/api installed (no-op mode)", () => {
    const otel = new OpenTelemetryExporter();
    expect(otel.isAvailable).toBe(false);
  });

  it("creates with custom config", () => {
    const otel = new OpenTelemetryExporter({
      serviceName: "test-service",
      metrics: false,
      traces: false,
      logs: false,
    });
    expect(otel.isAvailable).toBe(false);
  });

  it("recordRequest does not throw in no-op mode", () => {
    const otel = new OpenTelemetryExporter();
    expect(() => otel.recordRequest(completedEvent())).not.toThrow();
  });

  it("recordError does not throw in no-op mode", () => {
    const otel = new OpenTelemetryExporter();
    expect(() => otel.recordError(failedEvent())).not.toThrow();
  });

  it("recordRetry does not throw in no-op mode", () => {
    const otel = new OpenTelemetryExporter();
    expect(() => otel.recordRetry(retryEvent())).not.toThrow();
  });

  it("recordActiveRequests does not throw in no-op mode", () => {
    const otel = new OpenTelemetryExporter();
    expect(() => otel.recordActiveRequests(5)).not.toThrow();
  });

  it("instrumentClient wires hook events and returns unsubscribe", () => {
    const otel = new OpenTelemetryExporter();
    const listeners = new Map<string, Set<(e: any) => void>>();

    const mockClient = {
      on: vi.fn((event: string, listener: (e: any) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return () => listeners.get(event)?.delete(listener);
      }),
    };

    const unsub = otel.instrumentClient(mockClient as any);
    expect(mockClient.on).toHaveBeenCalledTimes(3);
    expect(mockClient.on).toHaveBeenCalledWith("request.completed", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("request.failed", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("request.retrying", expect.any(Function));

    unsub();
  });
});

// ─── Structured Logger ──────────────────────────────────────────────────────

describe("StructuredLogger", () => {
  it("outputs NDJSON to console.log by default", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new StructuredLogger({ level: "info" });

    logger.logRequest(completedEvent());
    expect(logSpy).toHaveBeenCalledTimes(1);

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output).toMatchObject({
      level: "info",
      category: "request",
      service: "hilbras-sdk",
      provider: "openai",
      model: "gpt-5.6",
      success: true,
    });
    expect(output.timestamp).toBeDefined();
    logSpy.mockRestore();
  });

  it("respects log level filtering", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({
      level: "warn",
      destination: (e) => entries.push(e),
    });

    logger.debug("test", {});
    logger.info("test", {});
    logger.warn("test", {});
    logger.error("test", {});

    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe("warn");
    expect(entries[1].level).toBe("error");
  });

  it("redacts sensitive data in entries", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({
      redact: true,
      destination: (e) => entries.push(e),
    });

    logger.logRequest(completedEvent({ error: undefined }));
    logger.logError(failedEvent({ error: "sk-proj-abc123def456ghi789jkl012mno" }));

    const errorEntry = entries.find((e) => e.level === "error");
    expect(errorEntry.error).not.toContain("sk-proj-abc123def456ghi789jkl012mno");
    expect(errorEntry.error).toContain("[REDACTED]");
  });

  it("includes default fields in every entry", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({
      defaultFields: { env: "production", region: "us-east-1" },
      destination: (e) => entries.push(e),
    });

    logger.info("custom", { requestId: "req_1" });
    expect(entries[0].env).toBe("production");
    expect(entries[0].region).toBe("us-east-1");
  });

  it("logRequest includes token counts", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({ destination: (e) => entries.push(e) });

    logger.logRequest(completedEvent({ inputTokens: 100, outputTokens: 50 }));
    expect(entries[0].tokens).toEqual({ input: 100, output: 50, total: 150 });
  });

  it("logError sets success to false", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({ destination: (e) => entries.push(e) });

    logger.logError(failedEvent());
    expect(entries[0].success).toBe(false);
    expect(entries[0].error).toBe("rate_limit_exceeded");
  });

  it("logRetry uses warn level", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({ destination: (e) => entries.push(e) });

    logger.logRetry(retryEvent());
    expect(entries[0].level).toBe("warn");
    expect(entries[0].category).toBe("retry");
  });

  it("logFirstChunk uses debug level", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({ level: "debug", destination: (e) => entries.push(e) });

    logger.logFirstChunk(firstChunkEvent());
    expect(entries[0].level).toBe("debug");
    expect(entries[0].category).toBe("stream");
    expect(entries[0].durationMs).toBe(200);
  });

  it("can change level at runtime", () => {
    const entries: any[] = [];
    const logger = new StructuredLogger({ level: "error", destination: (e) => entries.push(e) });

    logger.info("test", {});
    expect(entries).toHaveLength(0);

    logger.level = "info";
    logger.info("test", {});
    expect(entries).toHaveLength(1);
  });

  it("instrumentClient wires all events", () => {
    const logger = new StructuredLogger({ destination: () => {} });
    const mockClient = {
      on: vi.fn(() => () => {}),
    };

    const unsub = logger.instrumentClient(mockClient as any);
    expect(mockClient.on).toHaveBeenCalledTimes(4);

    unsub();
  });

  it("swallows destination errors", () => {
    const logger = new StructuredLogger({
      destination: () => { throw new Error("dest error"); },
    });

    expect(() => logger.info("test", {})).not.toThrow();
  });
});

// ─── Usage Dashboard ────────────────────────────────────────────────────────

describe("UsageDashboard", () => {
  let dashboard: UsageDashboard;

  beforeEach(() => {
    dashboard = new UsageDashboard({ maxRecords: 100 });
  });

  it("starts empty", () => {
    expect(dashboard.size).toBe(0);
    const s = dashboard.summary();
    expect(s.totalRequests).toBe(0);
    expect(s.totalErrors).toBe(0);
    expect(s.errorRate).toBe(0);
  });

  it("records completed requests", () => {
    dashboard.recordRequest(completedEvent({ inputTokens: 100, outputTokens: 50 }));
    dashboard.recordRequest(completedEvent({ inputTokens: 200, outputTokens: 80 }));

    expect(dashboard.size).toBe(2);
    const s = dashboard.summary();
    expect(s.totalRequests).toBe(2);
    expect(s.totalInputTokens).toBe(300);
    expect(s.totalOutputTokens).toBe(130);
    expect(s.totalTokens).toBe(430);
  });

  it("records failed requests", () => {
    dashboard.recordRequest(completedEvent());
    dashboard.recordError(failedEvent());

    expect(dashboard.size).toBe(2);
    const s = dashboard.summary();
    expect(s.totalRequests).toBe(2);
    expect(s.totalErrors).toBe(1);
    expect(s.errorRate).toBe(0.5);
  });

  it("computes latency percentiles", () => {
    // Generate 100 requests with latencies 1..100
    for (let i = 1; i <= 100; i++) {
      dashboard.recordRequest(completedEvent({ durationMs: i }));
    }

    const s = dashboard.summary();
    expect(s.avgLatencyMs).toBe(50.5);
    expect(s.p50LatencyMs).toBe(50);
    expect(s.p95LatencyMs).toBe(95);
    expect(s.p99LatencyMs).toBe(99);
  });

  it("byProvider groups correctly", () => {
    dashboard.recordRequest(completedEvent({ provider: "openai", model: "gpt-5.6", inputTokens: 100 }));
    dashboard.recordRequest(completedEvent({ provider: "openai", model: "gpt-5.6", inputTokens: 200 }));
    dashboard.recordRequest(completedEvent({ provider: "anthropic", model: "claude-4", inputTokens: 150 }));
    dashboard.recordError(failedEvent({ provider: "anthropic", model: "claude-4" }));

    const providers = dashboard.byProvider();
    expect(providers).toHaveLength(2);

    const openai = providers.find((p) => p.provider === "openai")!;
    expect(openai.requestCount).toBe(2);
    expect(openai.errorCount).toBe(0);
    expect(openai.totalInputTokens).toBe(300);
    expect(openai.errorRate).toBe(0);

    const anthropic = providers.find((p) => p.provider === "anthropic")!;
    expect(anthropic.requestCount).toBe(2);
    expect(anthropic.errorCount).toBe(1);
    expect(anthropic.errorRate).toBe(0.5);
  });

  it("byModel groups correctly", () => {
    dashboard.recordRequest(completedEvent({ provider: "openai", model: "gpt-5.6" }));
    dashboard.recordRequest(completedEvent({ provider: "openai", model: "gpt-5.6-mini" }));
    dashboard.recordRequest(completedEvent({ provider: "anthropic", model: "claude-4" }));

    const models = dashboard.byModel();
    expect(models).toHaveLength(3);
    expect(models[0].model).toBe("gpt-5.6");
    expect(models[0].requestCount).toBe(1);
  });

  it("summary includes top providers and models", () => {
    for (let i = 0; i < 5; i++) {
      dashboard.recordRequest(completedEvent({ provider: "openai", model: "gpt-5.6" }));
    }
    dashboard.recordRequest(completedEvent({ provider: "anthropic", model: "claude-4" }));

    const s = dashboard.summary();
    expect(s.topProviders.length).toBeGreaterThan(0);
    expect(s.topModels.length).toBeGreaterThan(0);
    expect(s.topProviders[0].provider).toBe("openai");
  });

  it("resets data", () => {
    dashboard.recordRequest(completedEvent());
    expect(dashboard.size).toBe(1);

    dashboard.reset();
    expect(dashboard.size).toBe(0);
  });

  it("trims to maxRecords", () => {
    const small = new UsageDashboard({ maxRecords: 3 });
    for (let i = 0; i < 5; i++) {
      small.recordRequest(completedEvent({ durationMs: i * 100 }));
    }
    expect(small.size).toBe(3);
  });

  it("handles empty state gracefully", () => {
    const s = dashboard.summary();
    expect(s.avgLatencyMs).toBe(0);
    expect(s.p50LatencyMs).toBe(0);
    expect(s.p95LatencyMs).toBe(0);
    expect(s.p99LatencyMs).toBe(0);
    expect(s.topProviders).toEqual([]);
    expect(s.topModels).toEqual([]);
  });
});

// ─── Body Logger ────────────────────────────────────────────────────────────

describe("BodyLogger", () => {
  it("captures request bodies", () => {
    const logger = new BodyLogger();
    logger.logRequest("openai", "POST", "/v1/chat/completions", { model: "gpt-5.6" });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("request");
    expect(entries[0].provider).toBe("openai");
    expect(entries[0].method).toBe("POST");
    expect(entries[0].url).toBe("/v1/chat/completions");
    expect(entries[0].body).toContain("gpt-5.6");
  });

  it("captures response bodies", () => {
    const logger = new BodyLogger();
    logger.logResponse("openai", 200, { choices: [] }, 150);

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("response");
    expect(entries[0].status).toBe(200);
    expect(entries[0].durationMs).toBe(150);
  });

  it("captures errors", () => {
    const logger = new BodyLogger();
    logger.logError("openai", new Error("timeout"));

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("error");
    expect(entries[0].body).toContain("timeout");
  });

  it("redacts sensitive data by default", () => {
    const logger = new BodyLogger({ redact: true });
    logger.logRequest("openai", "POST", "/v1/chat/completions", {
      authorization: "Bearer sk-proj-abc123def456ghi789jkl012mno345pqr",
    });

    const entries = logger.getEntries();
    expect(entries[0].body).not.toContain("sk-proj-abc123def456ghi789jkl012mno345pqr");
    expect(entries[0].body).toContain("[REDACTED]");
  });

  it("redacts authorization headers", () => {
    const logger = new BodyLogger({ redact: true });
    logger.logRequest("openai", "POST", "/v1/chat/completions", {}, {
      Authorization: "Bearer secret123",
      "Content-Type": "application/json",
    });

    const entries = logger.getEntries();
    expect(entries[0].headers?.Authorization).toBe("[REDACTED]");
    expect(entries[0].headers?.["Content-Type"]).toBe("application/json");
  });

  it("truncates long bodies", () => {
    const logger = new BodyLogger({ maxBodyLength: 50 });
    const longBody = "x".repeat(100);
    logger.logRequest("openai", "POST", "/v1/chat/completions", longBody);

    const entries = logger.getEntries();
    expect(entries[0].body.length).toBeLessThan(100);
    expect(entries[0].body).toContain("[truncated]");
  });

  it("respects enabled flag", () => {
    const logger = new BodyLogger({ enabled: false });
    logger.logRequest("openai", "POST", "/v1/chat/completions", {});
    logger.logResponse("openai", 200, {});
    logger.logError("openai", new Error("test"));

    expect(logger.getEntries()).toHaveLength(0);
  });

  it("can toggle enabled at runtime", () => {
    const logger = new BodyLogger({ enabled: false });
    logger.enabled = true;
    logger.logRequest("openai", "POST", "/v1/chat/completions", {});
    expect(logger.getEntries()).toHaveLength(1);

    logger.enabled = false;
    logger.logRequest("openai", "POST", "/v1/chat/completions", {});
    expect(logger.getEntries()).toHaveLength(1);
  });

  it("respects maxEntries limit", () => {
    const logger = new BodyLogger({}, 3);
    for (let i = 0; i < 5; i++) {
      logger.logRequest("openai", "POST", "/v1/chat/completions", { i });
    }
    expect(logger.size).toBe(3);
  });

  it("getEntries respects limit parameter", () => {
    const logger = new BodyLogger();
    for (let i = 0; i < 5; i++) {
      logger.logRequest("openai", "POST", "/v1/chat/completions", { i });
    }
    expect(logger.getEntries(2)).toHaveLength(2);
  });

  it("clears entries", () => {
    const logger = new BodyLogger();
    logger.logRequest("openai", "POST", "/v1/chat/completions", {});
    logger.clear();
    expect(logger.size).toBe(0);
  });

  it("calls destination function", () => {
    const dest = vi.fn();
    const logger = new BodyLogger({ destination: dest });
    logger.logRequest("openai", "POST", "/v1/chat/completions", {});

    expect(dest).toHaveBeenCalledTimes(1);
    expect(dest).toHaveBeenCalledWith(expect.objectContaining({ type: "request" }));
  });

  it("swallows destination errors", () => {
    const logger = new BodyLogger({
      destination: () => { throw new Error("dest error"); },
    });

    expect(() => logger.logRequest("openai", "POST", "/v1/chat/completions", {})).not.toThrow();
  });

  it("stringifies non-string bodies", () => {
    const logger = new BodyLogger();
    logger.logRequest("openai", "POST", "/v1/chat/completions", { nested: { key: "value" } });

    const entries = logger.getEntries();
    expect(typeof entries[0].body).toBe("string");
    expect(entries[0].body).toContain("nested");
  });
});
