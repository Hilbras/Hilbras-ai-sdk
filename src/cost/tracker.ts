/**
 * @hilbras/sdk — Budget Tracker with Atomic Reservations
 *
 * Tracks costs and enforces budgets using a reservation-based model.
 * Prevents concurrent requests from collectively exceeding the budget
 * by requiring an atomic check+reserve before execution.
 *
 * Lifecycle: RESERVE → EXECUTE → SETTLE (actual > estimated releases delta)
 *
 * Usage:
 *   const tracker = new BudgetTracker({ sessionBudget: 1.00 });
 *   const reservation = tracker.reserve("req_1", 0.60);
 *   // ... execute request ...
 *   tracker.settle("req_1", 0.45); // actual < reserved → refund $0.15
 *   // OR
 *   tracker.release("req_1"); // failed before execution → release all
 */

import type { CostEvent, CostReport, BudgetConfig } from "./types.js";
import { estimateCost } from "../tokens/counter.js";

export interface Reservation {
  id: string;
  amount: number;
  timestamp: number;
}

export class BudgetTracker {
  private _events: CostEvent[] = [];
  private _budget: BudgetConfig;
  private _totalActual = 0;
  private _totalReserved = 0;
  private _totalEstimated = 0;
  private _reservations = new Map<string, Reservation>();
  private _byProvider: Record<string, { estimated: number; actual: number; requests: number }> = {};
  private _byPhase: Record<string, number> = {};
  private _budgetWarningFired = false;
  private _budgetExceededFired = false;

  constructor(budget?: BudgetConfig) {
    this._budget = budget ?? {};
  }

  /**
   * Estimate cost before execution.
   */
  estimate(model: string, provider: string, inputTokens: number, outputTokens: number): number {
    const result = estimateCost(inputTokens, outputTokens, provider, model);
    return result.totalCost;
  }

  /**
   * Check if a request would exceed the per-request budget.
   */
  wouldExceedBudget(estimatedCost: number): boolean {
    if (this._budget.perRequestBudget == null) return false;
    return estimatedCost > this._budget.perRequestBudget;
  }

  /**
   * Check if the session budget is exhausted.
   * Uses committed cost (reserved + actual) for accurate enforcement.
   */
  isBudgetExhausted(): boolean {
    if (this._budget.sessionBudget == null) return false;
    const committed = this._totalActual + this._totalReserved;
    return committed >= this._budget.sessionBudget;
  }

  /**
   * Atomically check and reserve budget.
   * Returns the reservation if successful, null if budget exceeded.
   *
   * This is synchronous — no await between check and reserve.
   * In JavaScript's single-threaded event loop, this is atomic.
   */
  reserve(requestId: string, estimatedCost: number): Reservation | null {
    if (estimatedCost < 0 || !Number.isFinite(estimatedCost)) return null;

    // Per-request check
    if (this.wouldExceedBudget(estimatedCost)) return null;

    // Session check — committed = actual + reserved
    if (this._budget.sessionBudget != null) {
      const committed = this._totalActual + this._totalReserved;
      if (committed + estimatedCost > this._budget.sessionBudget) return null;
    }

    // Atomic reservation
    const reservation: Reservation = { id: requestId, amount: estimatedCost, timestamp: Date.now() };
    this._reservations.set(requestId, reservation);
    this._totalReserved += estimatedCost;
    this._totalEstimated += estimatedCost;

    return reservation;
  }

  /**
   * Settle a reservation with actual cost.
   * Releases the difference if actual < reserved.
   * If actual > reserved, consumes additional budget.
   */
  settle(requestId: string, actualCost: number, event: Omit<CostEvent, "timestamp" | "estimatedCost" | "actualCost" | "requestId">): void {
    const reservation = this._reservations.get(requestId);
    if (!reservation) return;

    // Guard against invalid actual cost — clamp negative/NaN to 0, cap Infinity at session budget
    const safeActual = actualCost < 0 || Number.isNaN(actualCost) ? 0
      : actualCost === Infinity ? (this._budget.sessionBudget ?? 1e15)
      : actualCost;
    const reserved = reservation.amount;
    this._reservations.delete(requestId);
    this._totalReserved = Math.max(0, this._totalReserved - reserved);

    // Record actual cost
    const costEvent: CostEvent = {
      ...event,
      requestId,
      estimatedCost: reserved,
      actualCost: safeActual,
      timestamp: Date.now(),
    };
    this._events.push(costEvent);
    this._totalActual += safeActual;

    // Update provider tracking
    if (!this._byProvider[event.provider]) {
      this._byProvider[event.provider] = { estimated: 0, actual: 0, requests: 0 };
    }
    this._byProvider[event.provider].estimated += reserved;
    this._byProvider[event.provider].actual += safeActual;
    this._byProvider[event.provider].requests++;

    // Update phase tracking
    this._byPhase[event.phase] = (this._byPhase[event.phase] ?? 0) + safeActual;

    // Budget callbacks
    this._checkBudgetCallbacks();
  }

  /**
   * Release a reservation without recording actual cost.
   * Use when execution fails before provider call.
   */
  release(requestId: string): void {
    const reservation = this._reservations.get(requestId);
    if (!reservation) return;

    this._totalReserved = Math.max(0, this._totalReserved - reservation.amount);
    this._reservations.delete(requestId);
  }

  /**
   * Legacy: record a cost event without reservation (backward compatible).
   */
  record(event: CostEvent): void {
    this._events.push(event);
    this._totalEstimated += event.estimatedCost;
    this._totalActual += event.actualCost;

    if (!this._byProvider[event.provider]) {
      this._byProvider[event.provider] = { estimated: 0, actual: 0, requests: 0 };
    }
    this._byProvider[event.provider].estimated += event.estimatedCost;
    this._byProvider[event.provider].actual += event.actualCost;
    this._byProvider[event.provider].requests++;

    this._byPhase[event.phase] = (this._byPhase[event.phase] ?? 0) + event.actualCost;

    this._checkBudgetCallbacks();
  }

  /**
   * Get the current cost report.
   */
  report(): CostReport {
    const committed = this._totalActual + this._totalReserved;
    const remaining = this._budget.sessionBudget != null
      ? Math.max(0, this._budget.sessionBudget - committed)
      : null;

    return {
      totalEstimated: this._totalEstimated,
      totalActual: this._totalActual,
      totalReserved: this._totalReserved,
      committedCost: committed,
      requestCount: this._events.length,
      activeReservations: this._reservations.size,
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
   * Get all active reservations.
   */
  reservations(): readonly Reservation[] {
    return [...this._reservations.values()];
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this._events = [];
    this._totalEstimated = 0;
    this._totalActual = 0;
    this._totalReserved = 0;
    this._reservations.clear();
    this._byProvider = {};
    this._byPhase = {};
    this._budgetWarningFired = false;
    this._budgetExceededFired = false;
  }

  private _checkBudgetCallbacks(): void {
    if (this._budget.sessionBudget != null) {
      const committed = this._totalActual + this._totalReserved;
      const pct = committed / this._budget.sessionBudget;

      if (pct >= 1 && !this._budgetExceededFired) {
        this._budgetExceededFired = true;
        try { this._budget.onBudgetExceeded?.(this.report()); } catch { /* notification-only */ }
      }

      if (pct >= 0.8 && !this._budgetWarningFired) {
        this._budgetWarningFired = true;
        try { this._budget.onBudgetWarning?.(this.report()); } catch { /* notification-only */ }
      }
    }
  }
}
