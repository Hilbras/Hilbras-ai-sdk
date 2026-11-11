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
  const { costSnapshot } = useChatBox();
  // `costSnapshot` is where the real figures live. The hook's own `totalCost`
  // and `totalTokens` are only ever set to 0, so the badge displayed $0.0000
  // no matter how much was spent.
  const cost = costSnapshot.totalCost;
  const tokens = costSnapshot.totalTokens;

  if (render) {
    return <span className={className}>{render({ cost, tokens, remainingBudget: costSnapshot.remainingBudget })}</span>;
  }

  return (
    <span className={className} aria-label="Cost tracker">
      ${cost.toFixed(4)}
      {showTokens && <span> / {tokens} tokens</span>}
      {showBudget && costSnapshot.remainingBudget != null && (
        <span> / ${costSnapshot.remainingBudget.toFixed(2)} left</span>
      )}
    </span>
  );
}
