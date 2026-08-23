/**
 * @hilbras/sdk — Budget Tracker
 *
 * Tracks costs across requests and enforces budget limits.
 * Thread-safe (no shared mutable state between requests).
 *
 * Usage:
 *   const tracker = new BudgetTracker({ sessionBudget: 1.00, perRequestBudget: 0.10 });
 *   const estimate = tracker.estimate("gpt-5.6-sol", 1000, 500);
 *   // ... execute request ...
 *   tracker.record({ requestId, provider, model, estimatedCost, actualCost, ... });
 *   const report = tracker.report();
 */

import type { CostEvent, CostReport, BudgetConfig } from "./types.js";
import { estimateCost } from "../tokens/counter.js";

export class BudgetTracker {
  private _events: CostEvent[] = [];
  private _budget: BudgetConfig;
  private _totalEstimated = 0;
  private _totalActual = 0;
  private _byProvider: Record<string, { estimated: number; actual: number; requests: number }> = {};
  private _byPhase: Record<string, number> = {};
  private _budgetWarningFired = false;
  private _budgetExceededFired = false;

  constructor(budget?: BudgetConfig) {
    this._budget = budget ?? {};
  }

  /**
   * Estimate cost before execution.
   * Returns the estimated cost in USD, or 0 if unknown.
   */
  estimate(model: string, provider: string, inputTokens: number, outputTokens: number): number {
    const result = estimateCost(inputTokens, outputTokens, provider, model);
    return result.totalCost;
  }

  /**
   * Check if a request would exceed the per-request budget.
   * Returns true if the request should be rejected.
   */
  wouldExceedBudget(estimatedCost: number): boolean {
    if (this._budget.perRequestBudget == null) return false;
    return estimatedCost > this._budget.perRequestBudget;
  }

  /**
   * Check if the session budget is exhausted.
   */
  isBudgetExhausted(): boolean {
    if (this._budget.sessionBudget == null) return false;
    return this._totalActual >= this._budget.sessionBudget;
  }

  /**
   * Record a cost event.
   */
  record(event: CostEvent): void {
    this._events.push(event);
    this._totalEstimated += event.estimatedCost;
    this._totalActual += event.actualCost;

    // Track by provider
    if (!this._byProvider[event.provider]) {
      this._byProvider[event.provider] = { estimated: 0, actual: 0, requests: 0 };
    }
    this._byProvider[event.provider].estimated += event.estimatedCost;
    this._byProvider[event.provider].actual += event.actualCost;
    this._byProvider[event.provider].requests++;

    // Track by phase
    this._byPhase[event.phase] = (this._byPhase[event.phase] ?? 0) + event.actualCost;

    // Budget warnings — track exceeded and warning independently
    if (this._budget.sessionBudget != null) {
      const pct = this._totalActual / this._budget.sessionBudget;

      if (pct >= 1 && !this._budgetExceededFired) {
        this._budgetExceededFired = true;
        this._budget.onBudgetExceeded?.(this.report());
      }

      if (pct >= 0.8 && !this._budgetWarningFired) {
        this._budgetWarningFired = true;
        this._budget.onBudgetWarning?.(this.report());
      }
    }
  }

  /**
   * Get the current cost report.
   */
  report(): CostReport {
    const remaining = this._budget.sessionBudget != null
      ? Math.max(0, this._budget.sessionBudget - this._totalActual)
      : null;

    return {
      totalEstimated: this._totalEstimated,
      totalActual: this._totalActual,
      requestCount: this._events.length,
      byProvider: { ...this._byProvider },
      byPhase: { ...this._byPhase },
      budgetExceeded: this.isBudgetExhausted(),
      remainingBudget: remaining,
    };
  }

  /**
   * Get all cost events.
   */
  events(): readonly CostEvent[] {
    return this._events;
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this._events = [];
    this._totalEstimated = 0;
    this._totalActual = 0;
    this._byProvider = {};
    this._byPhase = {};
    this._budgetWarningFired = false;
    this._budgetExceededFired = false;
  }
}
