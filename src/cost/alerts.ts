/**
 * @hilbras/sdk — Cost Alert Monitor
 *
 * Monitors budget thresholds and fires alerts via webhook or callback
 * when configured spending thresholds are crossed.
 *
 * Integration: pass a `BudgetConfig` with `onBudgetWarning`/`onBudgetExceeded`
 * callbacks to the HilbrasClient constructor. The CostAlertMonitor wraps
 * these callbacks to dispatch to configured channels.
 */

import type { BudgetTracker } from "./tracker.js";
import type { CostReport, BudgetConfig } from "./types.js";

/** An alert channel — either a webhook URL or a callback function */
export interface AlertChannel {
  /** Channel type */
  type: "webhook" | "callback";
  /** Webhook URL (for type "webhook") */
  url?: string;
  /** Callback function (for type "callback") */
  callback?: (alert: CostAlert) => void;
}

/** A single threshold configuration */
export interface ThresholdConfig {
  /** Percentage of session budget (0-100) that triggers the alert */
  percent: number;
  /** Channel to fire the alert through */
  channel?: AlertChannel;
}

/** An alert that was fired */
export interface CostAlert {
  /** Threshold percentage that was crossed */
  thresholdPercent: number;
  /** Current cost report at time of alert */
  report: CostReport;
  /** Timestamp of the alert */
  timestamp: number;
  /** Alert type */
  type: "threshold_reached" | "budget_exceeded";
}

/** Configuration for the cost alert monitor */
export interface CostAlertConfig {
  /** Thresholds to monitor (in addition to the built-in 80% warning and 100% exceeded) */
  thresholds?: ThresholdConfig[];
  /** Default channel for thresholds that don't specify one */
  defaultChannel?: AlertChannel;
  /**
   * Called when a channel fails to deliver an alert. A failed delivery does
   * not mark the threshold as fired, so the next check retries it.
   */
  onDispatchError?: (error: unknown, alert: CostAlert) => void;
}

/**
 * Creates a BudgetConfig that integrates with the CostAlertMonitor.
 *
 * Pass the returned `budget` to `new HilbrasClient({ budget })`.
 * The monitor fires alerts through configured channels when thresholds are crossed.
 *
 * @example
 * ```ts
 * const { budget, monitor } = createCostAlertBudget({
 *   sessionBudget: 10.00,
 *   thresholds: [
 *     { percent: 50, channel: { type: "callback", callback: (a) => console.log("50%!", a.report.totalActual) } },
 *     { percent: 75, channel: { type: "webhook", url: "https://hooks.slack.com/..." } },
 *   ],
 *   defaultChannel: { type: "callback", callback: (a) => console.warn("Cost alert:", a) },
 * });
 *
 * const client = new HilbrasClient({ budget });
 * ```
 */
export function createCostAlertBudget(
  config: CostAlertConfig & { sessionBudget?: number; perRequestBudget?: number },
): { budget: BudgetConfig; monitor: CostAlertMonitor } {
  const monitor = new CostAlertMonitor(config);

  const budget: BudgetConfig = {
    sessionBudget: config.sessionBudget,
    perRequestBudget: config.perRequestBudget,
    onBudgetWarning: (report) => {
      monitor.handleWarning(report);
    },
    onBudgetExceeded: (report) => {
      monitor.handleExceeded(report);
    },
  };

  return { budget, monitor };
}

/**
 * Monitors budget thresholds and fires alerts when spending
 * crosses configured levels.
 */
export class CostAlertMonitor {
  private _config: CostAlertConfig;
  private _firedThresholds = new Set<number>();
  private _firedExceeded = false;

  constructor(config: CostAlertConfig = {}) {
    this._config = config;
  }

  /**
   * Called by the BudgetConfig warning callback (80% threshold).
   * Fires all configured thresholds that haven't been fired yet.
   */
  handleWarning(report: CostReport): void {
    this._fireThresholds(report, "threshold_reached");
  }

  /**
   * Called by the BudgetConfig exceeded callback (100% threshold).
   * Fires the 100% threshold and any remaining thresholds.
   */
  handleExceeded(report: CostReport): void {
    this._fireThresholds(report, "budget_exceeded");
  }

  /**
   * Check current cost against all thresholds and fire any that
   * haven't been fired yet. Useful for polling-based setups.
   */
  check(tracker: BudgetTracker): CostAlert[] {
    const report = tracker.report();
    const alerts: CostAlert[] = [];

    if (report.budgetExceeded && !this._firedExceeded) {
      this._firedExceeded = true;
      this._firedThresholds.add(100);
      const alert = this._buildAlert(100, report, "budget_exceeded");
      alerts.push(alert);
      this._dispatch(alert, undefined, 100);
    }

    const percent = this._percent(report);
    if (percent !== null) {
      for (const threshold of this._config.thresholds ?? []) {
        if (percent >= threshold.percent && !this._firedThresholds.has(threshold.percent)) {
          this._firedThresholds.add(threshold.percent);
          const alert = this._buildAlert(threshold.percent, report, "threshold_reached");
          alerts.push(alert);
          this._dispatch(alert, threshold.channel, threshold.percent);
        }
      }
    }

    return alerts;
  }

  /**
   * Reset all fired thresholds (e.g., when starting a new budget period).
   */
  reset(): void {
    this._firedThresholds.clear();
    this._firedExceeded = false;
  }

  /**
   * Percent of the session budget consumed, counted on committed cost
   * (`totalActual + totalReserved`). The tracker's `remainingBudget` is
   * already net of reservations, so `totalActual` is the wrong numerator:
   * with $90 reserved and $0 spent it would report 0%.
   */
  private _percent(report: CostReport): number | null {
    if (report.remainingBudget === undefined || report.remainingBudget === null) return null;
    const committed = report.committedCost;
    const budget = committed + report.remainingBudget;
    if (budget <= 0) return report.budgetExceeded ? 100 : null;
    return Math.max(0, Math.min(100, (committed / budget) * 100));
  }

  private _fireThresholds(report: CostReport, type: CostAlert["type"]): void {
    const currentPercent = this._percent(report);
    if (currentPercent === null) return;

    const thresholds = type === "budget_exceeded"
      ? [...(this._config.thresholds ?? []), { percent: 100 }]
      : (this._config.thresholds ?? []);

    for (const threshold of thresholds) {
      if (threshold.percent > currentPercent || this._firedThresholds.has(threshold.percent)) continue;
      this._firedThresholds.add(threshold.percent);
      const alert = this._buildAlert(threshold.percent, report, type);
      this._dispatch(alert, threshold.channel, threshold.percent);
    }

    if (type === "budget_exceeded") {
      this._firedThresholds.add(100);
      this._firedExceeded = true;
    }
  }

  private _buildAlert(
    percent: number,
    report: CostReport,
    type: CostAlert["type"],
  ): CostAlert {
    return {
      thresholdPercent: percent,
      report,
      timestamp: Date.now(),
      type,
    };
  }

  /**
   * Deliver an alert. `percent` is the threshold it belongs to: the caller has
   * already marked it fired, and this releases it again if delivery fails, so
   * the next check retries instead of losing the alert.
   */
  private _dispatch(alert: CostAlert, channel?: AlertChannel, percent?: number): void {
    const target = channel ?? this._config.defaultChannel;
    if (!target) {
      this._settle(percent, true);
      return;
    }

    const settle = (ok: boolean, error?: unknown) => {
      this._settle(percent, ok);
      if (!ok) this._config.onDispatchError?.(error, alert);
    };

    if (target.type === "webhook" && target.url) {
      void fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      })
        .then((response) => {
          if (response.ok) {
            settle(true);
          } else {
            settle(false, new Error(`alert webhook returned HTTP ${response.status}`));
          }
        })
        .catch((error: unknown) => settle(false, error));
      return;
    }

    if (target.type === "callback" && target.callback) {
      try {
        target.callback(alert);
        settle(true);
      } catch (error) {
        settle(false, error);
      }
      return;
    }

    settle(true);
  }

  private _settle(percent: number | undefined, delivered: boolean): void {
    if (percent === undefined || delivered) return;
    this._firedThresholds.delete(percent);
    if (percent === 100) this._firedExceeded = false;
  }
}
