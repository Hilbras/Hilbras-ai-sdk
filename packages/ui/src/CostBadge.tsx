"use client";

import { useChatBox } from "./ChatBox.js";

export interface CostBadgeProps {
  /** Show token count */
  showTokens?: boolean;
  /** Show remaining budget */
  showBudget?: boolean;
  /** Custom render function */
  render?: (data: { cost: number; tokens: number; remainingBudget: number | null }) => React.ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Headless CostBadge — real-time cost/token display.
 */
export function CostBadge({ showTokens = true, showBudget = true, render, className }: CostBadgeProps) {
  const { totalCost, totalTokens, costSnapshot } = useChatBox();

  if (render) {
    return <span className={className}>{render({ cost: totalCost, tokens: totalTokens, remainingBudget: costSnapshot.remainingBudget })}</span>;
  }

  return (
    <span className={className} aria-label="Cost tracker">
      ${totalCost.toFixed(4)}
      {showTokens && <span> / {totalTokens} tokens</span>}
      {showBudget && costSnapshot.remainingBudget != null && (
        <span> / ${costSnapshot.remainingBudget.toFixed(2)} left</span>
      )}
    </span>
  );
}
