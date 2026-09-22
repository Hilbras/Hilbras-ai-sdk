/**
 * @hilbras/sdk — SLA Monitoring
 *
 * Tracks latency, error rate, and availability against defined
 * SLA thresholds, firing alerts on breaches.
 */

import type { HilbrasClient } from "../client/client.js";
import type { HookEventType, RequestCompletedEvent, RequestFailedEvent } from "../types/observability.js";

/** Supported SLA metric types */
export type SLAMetric =
  | "latency_p95"
  | "latency_p99"
  | "error_rate"
  | "availability"
  | "cost_per_request";

/** An SLA definition */
export interface SLADefinition {
  /** Human-readable SLA name */
  name: string;
  /** The metric to monitor */
  metric: SLAMetric;
  /** Threshold value (latency in ms, rates as 0-1, cost in dollars) */
  threshold: number;
  /** Sliding window duration in milliseconds */
  windowMs: number;
  /** Callback fired on breach */
  alertOnBreach?: (breach: SLABreach) => void;
}

/** An SLA breach event */
export interface SLABreach {
  /** SLA name that was breached */
  sla: string;
  /** Metric that was breached */
  metric: SLAMetric;
  /** The threshold that was exceeded */
  threshold: number;
  /** The actual measured value */
  actual: number;
  /** Timestamp of the breach */
  timestamp: number;
}

/** SLA compliance status for a single definition */
export interface SLAStatus {
  /** SLA name */
  name: string;
  /** Whether the SLA is currently being met */
  compliant: boolean;
  /** Current measured value */
  currentValue: number;
  /** The threshold */
  threshold: number;
  /** Number of breaches in the tracking window */
  breachCount: number;
  /** Last breach (if any) */
  lastBreach?: SLABreach;
}

/** Complete SLA report */
export interface SLAReport {
  /** Status of each SLA */
  slas: SLAStatus[];
  /** Whether all SLAs are compliant */
  allCompliant: boolean;
  /** Report timestamp */
  timestamp: number;
}

interface RequestRecord {
  timestamp: number;
  durationMs: number;
  success: boolean;
  cost?: number;
}

/**
 * Monitors SLA compliance by tracking request metrics in sliding
 * windows and comparing against defined thresholds.
 *
 * @example
 * ```ts
 * const monitor = new SLAMonitor(client, [
 *   { name: "p95 latency", metric: "latency_p95", threshold: 2000, windowMs: 60_000 },
 *   { name: "availability", metric: "availability", threshold: 0.99, windowMs: 300_000 },
 * ]);
 *
 * // Later:
 * const report = monitor.report();
 * if (!report.allCompliant) {
 *   console.error("SLA breach!", report.slas.filter(s => !s.compliant));
 * }
 * ```
 */
export class SLAMonitor {
  private _records: RequestRecord[] = [];
  private _breaches: SLABreach[] = [];
  private _definitions: SLADefinition[];
  private _unsubscribers: (() => void)[] = [];
  private _maxRecords: number;

  constructor(
    client: HilbrasClient,
    definitions: SLADefinition[],
    options?: { maxRecords?: number },
  ) {
    this._definitions = definitions;
    this._maxRecords = options?.maxRecords ?? 10_000;

    // Subscribe to client lifecycle events
    this._unsubscribers.push(
      client.on("request.completed", (event: RequestCompletedEvent) => {
        this._records.push({
          timestamp: event.timestamp,
          durationMs: event.durationMs,
          success: true,
        });
        this._trimRecords();
        this._checkBreach();
      }),
    );

    this._unsubscribers.push(
      client.on("request.failed", (event: RequestFailedEvent) => {
        this._records.push({
          timestamp: event.timestamp,
          durationMs: event.durationMs,
          success: false,
        });
        this._trimRecords();
        this._checkBreach();
      }),
    );
  }

  /** Get the current SLA compliance report */
  report(): SLAReport {
    const now = performance.now();
    const slas: SLAStatus[] = this._definitions.map((def) => {
      const windowRecords = this._getWindowRecords(def.windowMs, now);
      const currentValue = this._computeMetric(def.metric, windowRecords);
      const breaches = this._getBreachesFor(def.name, def.windowMs, now);

      return {
        name: def.name,
        compliant: this._isCompliant(def, currentValue),
        currentValue,
        threshold: def.threshold,
        breachCount: breaches.length,
        lastBreach: breaches[breaches.length - 1],
      };
    });

    return {
      slas,
      allCompliant: slas.every((s) => s.compliant),
      timestamp: now,
    };
  }

  /** Manually record a request (for external integrations) */
  record(durationMs: number, success: boolean, cost?: number): void {
    this._records.push({
      timestamp: performance.now(),
      durationMs,
      success,
      cost,
    });
    this._trimRecords();
    this._checkBreach();
  }

  /** Dispose event subscriptions */
  dispose(): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers.length = 0;
  }

  private _getWindowRecords(windowMs: number, now: number): RequestRecord[] {
    const cutoff = now - windowMs;
    return this._records.filter((r) => r.timestamp >= cutoff);
  }

  private _getBreachesFor(slaName: string, windowMs: number, now: number): SLABreach[] {
    const cutoff = now - windowMs;
    return this._breaches.filter(
      (b) => b.sla === slaName && b.timestamp >= cutoff,
    );
  }

  private _computeMetric(metric: SLAMetric, records: RequestRecord[]): number {
    if (records.length === 0) {
      // No data: availability defaults to 1.0, others to 0
      return metric === "availability" ? 1 : 0;
    }

    switch (metric) {
      case "latency_p95": {
        const sorted = records.map((r) => r.durationMs).sort((a, b) => a - b);
        const idx = Math.ceil(sorted.length * 0.95) - 1;
        return sorted[Math.max(0, idx)];
      }
      case "latency_p99": {
        const sorted = records.map((r) => r.durationMs).sort((a, b) => a - b);
        const idx = Math.ceil(sorted.length * 0.99) - 1;
        return sorted[Math.max(0, idx)];
      }
      case "error_rate": {
        const failures = records.filter((r) => !r.success).length;
        return failures / records.length;
      }
      case "availability": {
        const successes = records.filter((r) => r.success).length;
        return successes / records.length;
      }
      case "cost_per_request": {
        const withCost = records.filter((r) => r.cost !== undefined);
        if (withCost.length === 0) return 0;
        const total = withCost.reduce((sum, r) => sum + (r.cost ?? 0), 0);
        return total / withCost.length;
      }
      default:
        return 0;
    }
  }

  private _isCompliant(def: SLADefinition, currentValue: number): boolean {
    // For error_rate: lower is better (compliant if <= threshold)
    // For availability: higher is better (compliant if >= threshold)
    // For latency: lower is better (compliant if <= threshold)
    // For cost: lower is better (compliant if <= threshold)
    switch (def.metric) {
      case "availability":
        return currentValue >= def.threshold;
      default:
        return currentValue <= def.threshold;
    }
  }

  private _checkBreach(): void {
    const now = performance.now();
    const status = this.report();

    for (const slaStatus of status.slas) {
      if (!slaStatus.compliant) {
        const def = this._definitions.find((d) => d.name === slaStatus.name);
        if (!def) continue;

        // Don't re-breach within the same window for the same SLA
        const recentBreaches = this._getBreachesFor(def.name, def.windowMs, now);
        if (recentBreaches.length > 0) continue;

        const breach: SLABreach = {
          sla: def.name,
          metric: def.metric,
          threshold: def.threshold,
          actual: slaStatus.currentValue,
          timestamp: now,
        };

        this._breaches.push(breach);
        def.alertOnBreach?.(breach);
      }
    }
  }

  private _trimRecords(): void {
    if (this._records.length > this._maxRecords) {
      this._records = this._records.slice(-this._maxRecords);
    }
  }
}
