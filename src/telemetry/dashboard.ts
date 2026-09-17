/**
 * @hilbras/sdk — Usage Dashboard
 *
 * Aggregates token usage, latency, and error metrics for dashboard display.
 * Collects data from hook events and produces summary reports.
 *
 * Usage:
 *   import { UsageDashboard } from "@hilbras/sdk";
 *
 *   const dashboard = new UsageDashboard();
 *   client.on("request.completed", (e) => dashboard.recordRequest(e));
 *   client.on("request.failed", (e) => dashboard.recordError(e));
 *
 *   // Get summary
 *   console.log(dashboard.summary());
 *
 *   // Get per-provider breakdown
 *   console.log(dashboard.byProvider());
 *
 *   // Get per-model breakdown
 *   console.log(dashboard.byModel());
 */

import type { RequestCompletedEvent, RequestFailedEvent } from "../types/observability.js";

/** Provider-level metrics */
export interface ProviderMetrics {
  provider: string;
  requestCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
}

/** Model-level metrics */
export interface ModelMetrics {
  model: string;
  provider: string;
  requestCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  errorRate: number;
}

/** Overall summary */
export interface UsageSummary {
  totalRequests: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  topProviders: ProviderMetrics[];
  topModels: ModelMetrics[];
}

/** Individual request record for percentile calculation */
interface RequestRecord {
  provider: string;
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  timestamp: number;
}

/**
 * Aggregates usage metrics from hook events for dashboard display.
 * Thread-safe — all operations are synchronous with no external state.
 */
export class UsageDashboard {
  private _requests: RequestRecord[] = [];
  private _maxRecords: number;

  constructor(options?: { maxRecords?: number }) {
    this._maxRecords = options?.maxRecords ?? 10_000;
  }

  /** Record a completed request */
  recordRequest(event: RequestCompletedEvent): void {
    this._requests.push({
      provider: event.provider,
      model: event.model,
      durationMs: event.durationMs,
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      success: true,
      timestamp: event.timestamp,
    });
    this._trim();
  }

  /** Record a failed request */
  recordError(event: RequestFailedEvent): void {
    this._requests.push({
      provider: event.provider,
      model: event.model,
      durationMs: event.durationMs,
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      timestamp: event.timestamp,
    });
    this._trim();
  }

  /** Get an overall usage summary */
  summary(): UsageSummary {
    const total = this._requests.length;
    const errors = this._requests.filter((r) => !r.success).length;
    const latencies = this._requests.map((r) => r.durationMs).sort((a, b) => a - b);

    return {
      totalRequests: total,
      totalErrors: errors,
      totalInputTokens: this._requests.reduce((sum, r) => sum + r.inputTokens, 0),
      totalOutputTokens: this._requests.reduce((sum, r) => sum + r.outputTokens, 0),
      totalTokens: this._requests.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0),
      avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      errorRate: total > 0 ? errors / total : 0,
      topProviders: this.byProvider().slice(0, 10),
      topModels: this.byModel().slice(0, 10),
    };
  }

  /** Get per-provider metrics */
  byProvider(): ProviderMetrics[] {
    const map = new Map<string, RequestRecord[]>();
    for (const r of this._requests) {
      const arr = map.get(r.provider) ?? [];
      arr.push(r);
      map.set(r.provider, arr);
    }

    return Array.from(map.entries())
      .map(([provider, records]) => {
        const successes = records.filter((r) => r.success);
        const latencies = successes.map((r) => r.durationMs).sort((a, b) => a - b);
        return {
          provider,
          requestCount: records.length,
          errorCount: records.length - successes.length,
          totalInputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
          totalOutputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
          totalTokens: records.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
          avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
          p50LatencyMs: percentile(latencies, 50),
          p95LatencyMs: percentile(latencies, 95),
          p99LatencyMs: percentile(latencies, 99),
          errorRate: records.length > 0 ? (records.length - successes.length) / records.length : 0,
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount);
  }

  /** Get per-model metrics */
  byModel(): ModelMetrics[] {
    const map = new Map<string, RequestRecord[]>();
    for (const r of this._requests) {
      const key = `${r.provider}/${r.model}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }

    return Array.from(map.entries())
      .map(([key, records]) => {
        const [provider, model] = key.split("/", 2);
        const successes = records.filter((r) => r.success);
        return {
          model,
          provider,
          requestCount: records.length,
          errorCount: records.length - successes.length,
          totalInputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
          totalOutputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
          avgLatencyMs: successes.length
            ? successes.reduce((s, r) => s + r.durationMs, 0) / successes.length
            : 0,
          errorRate: records.length > 0 ? (records.length - successes.length) / records.length : 0,
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount);
  }

  /** Reset all collected data */
  reset(): void {
    this._requests = [];
  }

  /** Number of recorded requests */
  get size(): number {
    return this._requests.length;
  }

  private _trim(): void {
    if (this._requests.length > this._maxRecords) {
      this._requests = this._requests.slice(-this._maxRecords);
    }
  }
}

/** Calculate percentile from a sorted array */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
