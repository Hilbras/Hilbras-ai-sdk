/**
 * @hilbras/sdk — Cost Alert Monitor Tests
 */

import { describe, it, expect, vi } from "vitest";
import { CostAlertMonitor, createCostAlertBudget } from "../../src/cost/alerts.js";
import { BudgetTracker } from "../../src/cost/tracker.js";

describe("CostAlertMonitor", () => {
  it("fires threshold alerts via callback", () => {
    const cb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [
        { percent: 50, channel: { type: "callback", callback: cb } },
      ],
    });

    // Simulate a budget config that triggers the warning
    const report = {
      totalActual: 50,
      totalEstimated: 50,
      totalReserved: 0,
      committedCost: 50,
      requestCount: 10,
      activeReservations: 0,
      byProvider: {},
      byPhase: {},
      budgetExceeded: false,
      remainingBudget: 50,
    };

    monitor.handleWarning(report);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdPercent: 50, type: "threshold_reached" }),
    );
  });

  it("does not fire same threshold twice", () => {
    const cb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [
        { percent: 50, channel: { type: "callback", callback: cb } },
      ],
    });

    const report = {
      totalActual: 50, totalEstimated: 50, totalReserved: 0,
      committedCost: 50, requestCount: 10, activeReservations: 0,
      byProvider: {}, byPhase: {}, budgetExceeded: false, remainingBudget: 50,
    };

    monitor.handleWarning(report);
    monitor.handleWarning(report);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires exceeded alerts", () => {
    const cb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [
        { percent: 100, channel: { type: "callback", callback: cb } },
      ],
    });

    const report = {
      totalActual: 100, totalEstimated: 100, totalReserved: 0,
      committedCost: 100, requestCount: 20, activeReservations: 0,
      byProvider: {}, byPhase: {}, budgetExceeded: true, remainingBudget: 0,
    };

    monitor.handleExceeded(report);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: "budget_exceeded" }),
    );
  });

  it("resets fired thresholds", () => {
    const cb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [
        { percent: 50, channel: { type: "callback", callback: cb } },
      ],
    });

    const report = {
      totalActual: 50, totalEstimated: 50, totalReserved: 0,
      committedCost: 50, requestCount: 10, activeReservations: 0,
      byProvider: {}, byPhase: {}, budgetExceeded: false, remainingBudget: 50,
    };

    monitor.handleWarning(report);
    expect(cb).toHaveBeenCalledOnce();

    monitor.reset();
    monitor.handleWarning(report);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("uses default channel when threshold has no channel", () => {
    const defaultCb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [{ percent: 50 }],
      defaultChannel: { type: "callback", callback: defaultCb },
    });

    const report = {
      totalActual: 50, totalEstimated: 50, totalReserved: 0,
      committedCost: 50, requestCount: 10, activeReservations: 0,
      byProvider: {}, byPhase: {}, budgetExceeded: false, remainingBudget: 50,
    };

    monitor.handleWarning(report);
    expect(defaultCb).toHaveBeenCalledOnce();
  });

  it("check() fires alerts based on tracker state", () => {
    const cb = vi.fn();
    const monitor = new CostAlertMonitor({
      thresholds: [{ percent: 50, channel: { type: "callback", callback: cb } }],
    });

    const tracker = new BudgetTracker({ sessionBudget: 100 });
    // Reserve and settle to put some cost through
    const r = tracker.reserve("r1", 60);
    expect(r).not.toBeNull();
    tracker.settle("r1", 60, { provider: "test", model: "m", phase: "execute" });

    const alerts = monitor.check(tracker);
    expect(alerts.length).toBe(1);
    expect(alerts[0].thresholdPercent).toBe(50);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("createCostAlertBudget", () => {
  it("returns a BudgetConfig with callbacks wired to the monitor", () => {
    const cb = vi.fn();
    const { budget, monitor } = createCostAlertBudget({
      sessionBudget: 100,
      thresholds: [{ percent: 50, channel: { type: "callback", callback: cb } }],
    });

    expect(budget.sessionBudget).toBe(100);
    expect(budget.onBudgetWarning).toBeDefined();
    expect(budget.onBudgetExceeded).toBeDefined();

    // Simulate warning callback
    budget.onBudgetWarning!({
      totalActual: 50, totalEstimated: 50, totalReserved: 0,
      committedCost: 50, requestCount: 5, activeReservations: 0,
      byProvider: {}, byPhase: {}, budgetExceeded: false, remainingBudget: 50,
    });

    expect(cb).toHaveBeenCalledOnce();
  });
});
