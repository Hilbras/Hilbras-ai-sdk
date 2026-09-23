"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useHilbrasClient } from "./provider.js";

export interface CostSnapshot {
  /** Total cost in dollars */
  totalCost: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total requests made */
  totalRequests: number;
  /** Average cost per request */
  avgCostPerRequest: number;
  /** Average tokens per request */
  avgTokensPerRequest: number;
  /** Cost breakdown by provider */
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  /** Cost breakdown by model */
  byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  /** Remaining budget (null if no budget set) */
  remainingBudget: number | null;
  /** Budget exceeded flag */
  budgetExceeded: boolean;
}

export interface UseCostOptions {
  /** Poll interval in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Whether to auto-poll (default: true) */
  enabled?: boolean;
}

export interface UseCostReturn {
  /** Current cost snapshot */
  snapshot: CostSnapshot;
  /** Manually refresh the snapshot */
  refresh: () => void;
  /** Whether budget is low (< 20% remaining) */
  isBudgetLow: boolean;
  /** Whether budget is exceeded */
  isBudgetExceeded: boolean;
}

/**
 * useCost — real-time cost tracking hook.
 *
 * @example
 * ```tsx
 * function CostDisplay() {
 *   const { snapshot, isBudgetLow } = useCost();
 *
 *   return (
 *     <div style={{ color: isBudgetLow ? "red" : "green" }}>
 *       Cost: ${snapshot.totalCost.toFixed(4)} | Tokens: {snapshot.totalTokens}
 *       {snapshot.remainingBudget != null && ` | Remaining: $${snapshot.remainingBudget.toFixed(2)}`}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCost(options: UseCostOptions = {}): UseCostReturn {
  const { pollIntervalMs = 1000, enabled = true } = options;
  const client = useHilbrasClient();

  const [snapshot, setSnapshot] = useState<CostSnapshot>({
    totalCost: 0,
    totalTokens: 0,
    totalRequests: 0,
    avgCostPerRequest: 0,
    avgTokensPerRequest: 0,
    byProvider: {},
    byModel: {},
    remainingBudget: null,
    budgetExceeded: false,
  });

  const refresh = useCallback(() => {
    try {
      const report = client.costReport();
      const byProvider = Object.fromEntries(
        Object.entries(report.byProvider).map(([provider, metrics]) => [
          provider,
          { cost: metrics.actual, tokens: 0, requests: metrics.requests },
        ]),
      );

      setSnapshot({
        totalCost: report.totalActual,
        totalTokens: 0, // Will be filled from hooks if available
        totalRequests: report.requestCount,
        avgCostPerRequest: report.requestCount > 0 ? report.totalActual / report.requestCount : 0,
        avgTokensPerRequest: 0,
        byProvider,
        byModel: {},
        remainingBudget: report.remainingBudget,
        budgetExceeded: report.budgetExceeded,
      });
    } catch {
      // Client may not have cost tracking enabled
    }
  }, [client]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, refresh]);

  const isBudgetLow = snapshot.remainingBudget != null && snapshot.remainingBudget < 1.0;
  const isBudgetExceeded = snapshot.budgetExceeded;

  return { snapshot, refresh, isBudgetLow, isBudgetExceeded };
}
