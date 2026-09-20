"use client";

import { useChatBox } from "../ChatBox.js";
import type { CostBadgeProps } from "../CostBadge.js";

export function TailwindCostBadge({ showTokens = true, showBudget = true, render, className }: CostBadgeProps) {
  const { totalCost, totalTokens, costSnapshot } = useChatBox();

  if (render) {
    return <span className={`text-sm ${className ?? ""}`}>{render({ cost: totalCost, tokens: totalTokens, remainingBudget: costSnapshot.remainingBudget })}</span>;
  }

  return (
    <span className={`text-sm text-gray-500 ${className ?? ""}`} aria-label="Cost tracker">
      ${totalCost.toFixed(4)}
      {showTokens && <span> / {totalTokens} tokens</span>}
      {showBudget && costSnapshot.remainingBudget != null && (
        <span> / ${costSnapshot.remainingBudget.toFixed(2)} left</span>
      )}
    </span>
  );
}
