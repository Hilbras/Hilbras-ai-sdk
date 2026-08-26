# Cost & Budget Enforcement

`@hilbras/sdk` has built-in cost tracking and budget enforcement with
atomic reservations. Every request — both `complete()` and `stream()` — is
budgeted starting in v0.9.3.

## Quick start

```typescript
const client = new HilbrasClient({
  budget: {
    sessionBudget: 1.00,       // Max total cost for the session
    perRequestBudget: 0.10,    // Max cost per individual request
    onBudgetWarning: (r) => console.warn(`80% budget used: $${r.totalActual.toFixed(4)}`),
    onBudgetExceeded: (r) => console.error(`Budget exhausted`),
  },
});

// Reservations happen automatically. After requests, get the full report.
const report = client.costReport();
console.log(`Total spent: $${report.totalActual.toFixed(4)}`);
console.log(`Remaining: $${report.remainingBudget?.toFixed(4)}`);
```

## How it works

1. **Per-request check**: estimated cost is computed from input tokens and
   the model's pricing.
2. **Atomic reservation**: `BudgetTracker.reserve(requestId, estimated)`
   runs synchronously — no `await` between check and reserve. In a
   single-threaded runtime this is atomic. If the session has spent too
   much, the reservation is rejected.
3. **Settle on completion**: when the request completes, the actual cost
   is settled. If the actual is less than the estimate, the difference is
   refunded. If more, the difference is consumed.
4. **Release on failure**: if the request fails before completion, the
   reservation is released.

The reservation lifecycle is the same for streaming and non-streaming
requests in v0.9.3+. The only difference is *when* settlement happens:

- `complete()` settles on completion (the provider's response).
- `stream()` settles on the **first `usage` chunk** with the actual cost
  reported by the provider, or at end-of-stream with the estimate if no
  usage chunk arrived.

## Budget configuration

```typescript
interface BudgetConfig {
  /** Max total cost for the entire session. */
  sessionBudget?: number;
  /** Max cost per individual request. */
  perRequestBudget?: number;
  /** Fires when committed cost reaches 80% of sessionBudget. */
  onBudgetWarning?: (report: CostReport) => void;
  /** Fires when committed cost reaches 100% of sessionBudget. */
  onBudgetExceeded?: (report: CostReport) => void;
}
```

## Reading the cost report

```typescript
const report = client.costReport();
report.totalEstimated;       // Sum of in-flight estimates
report.totalActual;          // Sum of settled actual costs
report.totalReserved;        // Sum of currently-reserved amounts
report.committedCost;        // totalActual + totalReserved
report.remainingBudget;      // sessionBudget - committedCost (or null)
report.activeReservations;   // Number of in-flight requests
report.byProvider;           // Per-provider breakdown
report.byPhase;              // Per-phase breakdown (execute vs fallback)
report.requestCount;         // Total settled requests
report.budgetExceeded;       // Boolean: is committedCost >= sessionBudget
```

## Programmatic access

If you need direct control over the lifecycle (e.g. for custom request
shapes), the `BudgetTracker` is exposed via `client.cost`:

```typescript
const tracker = client.cost;

const reservation = tracker.reserve("my-req-1", 0.05);
if (reservation) {
  // do the work
  tracker.settle("my-req-1", 0.04, { provider: "OpenAI", model: "gpt-5.6-sol", phase: "execute" });
  // or, on failure:
  tracker.release("my-req-1");
}
```

## Cost estimation utilities

Standalone helpers are also exported for ad-hoc use:

```typescript
import { estimateTokens, estimateCost } from "@hilbras/sdk";

const tokens = estimateTokens("Hello, world!");     // ~3

const cost = estimateCost(1000, 500, "openai", "gpt-5.6-sol");
// { inputCost: 0.004, outputCost: 0.01, totalCost: 0.014, currency: "USD" }
```

## Migration notes

The reservation lifecycle is a hard contract starting in v0.9.0. If you
were using the older `BudgetTracker.record()` API (now `@deprecated`),
it still works for backward compatibility, but does not pair with
`reserve()`/`settle()`. New code should use the reservation lifecycle.
