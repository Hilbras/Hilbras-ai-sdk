/**
 * @hilbras/sdk — Cost Optimization Types
 */

/** A single cost event in the execution lifecycle */
export interface CostEvent {
  /** Unique request ID */
  requestId: string;
  /** Provider name */
  provider: string;
  /** Model ID */
  model: string;
  /** Phase: "estimate" | "execute" | "retry" | "fallback" | "repair" */
  phase: string;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Actual cost in USD (0 if estimated) */
  actualCost: number;
  /** Input tokens */
  inputTokens?: number;
  /** Output tokens */
  outputTokens?: number;
  /** Timestamp */
  timestamp: number;
}

/** Aggregated cost report for a budget period */
export interface CostReport {
  /** Total estimated cost across all requests */
  totalEstimated: number;
  /** Total actual cost across all requests */
  totalActual: number;
  /** Total currently reserved (pending execution) */
  totalReserved: number;
  /** Committed cost = totalActual + totalReserved */
  committedCost: number;
  /** Number of requests tracked */
  requestCount: number;
  /** Number of active reservations */
  activeReservations: number;
  /** Cost by provider */
  byProvider: Record<string, { estimated: number; actual: number; requests: number }>;
  /** Cost by phase */
  byPhase: Record<string, number>;
  /** Whether budget was exceeded */
  budgetExceeded: boolean;
  /** Remaining budget (null = no budget set) */
  remainingBudget: number | null;
}

/** Budget configuration */
export interface BudgetConfig {
  /** Maximum total cost for the session (null = unlimited) */
  sessionBudget?: number;
  /** Maximum cost per individual request (null = unlimited) */
  perRequestBudget?: number;
  /** Callback when budget threshold is reached */
  onBudgetWarning?: (report: CostReport) => void;
  /** Callback when budget is exceeded */
  onBudgetExceeded?: (report: CostReport) => void;
}
