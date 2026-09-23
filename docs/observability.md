# Observability

`@hilbras/sdk` emits typed lifecycle events for every request. Subscribe
to the events you care about to wire up OpenTelemetry, Datadog, Grafana,
or any custom backend.

## Subscribing to events

```typescript
const client = new HilbrasClient();

client.on("request.start", (event) => {
  console.log(`→ ${event.provider}/${event.model} (req ${event.requestId})`);
});

client.on("request.completed", (event) => {
  console.log(`← ${event.provider}/${event.model} took ${event.durationMs}ms`);
  console.log(`  Tokens: ${event.inputTokens}/${event.outputTokens}`);
});

client.on("request.failed", (event) => {
  console.error(`✗ ${event.provider}/${event.model}: ${event.error}`);
});
```

`on()` returns an unsubscribe function:

```typescript
const off = client.on("request.completed", handler);
// later
off();
```

## Event reference

| Event | When | Key fields |
|---|---|---|
| `request.start` | Request initiated | `requestId`, `provider`, `model`, `task` |
| `routing.resolved` | Router picked a model | `requestId`, `provider`, `model`, `score`, `reasons` |
| `request.completed` | Success with latency, tokens | `requestId`, `provider`, `model`, `durationMs`, `attempts`, `inputTokens`, `outputTokens` |
| `request.failed` | Failure after all retries | `requestId`, `provider`, `model`, `durationMs`, `attempts`, `error` |
| `request.retrying` | Before retry sleep | `requestId`, `attempt`, `delayMs`, `reason` |
| `fallback.started` | Fallback to alternate model | `requestId`, `originalProvider`, `originalModel`, `fallbackProvider`, `fallbackModel` |
| `circuit_breaker.open` | Circuit breaker blocked request | `requestId`, `provider` |
| `structured.validate.pass` | Schema validation succeeded | `requestId` |
| `structured.validate.fail` | Schema validation failed | `requestId`, `attempt`, `error` |
| `stream.first_chunk` | First chunk yielded | `requestId`, `latencyMs` |

Every event includes a `requestId` for correlation.

## Removing listeners

```typescript
client.off("request.completed", handler);   // remove one
client.removeAllListeners("request.completed"); // remove all for one event
client.removeAllListeners();                 // remove everything
```

## Logging

For lower-level HTTP-level logging, use the `redact` helper exported from the
root package before sending text to a custom logger. See
[Security & SSRF Protection](security.md) for the redaction patterns.

## Zero overhead

The event emitter is a synchronous listener iteration. When no listeners
are attached, the `emit` call short-circuits to a no-op. There's no
async overhead and no per-event allocation when no one is listening.

---

## SLA Monitoring — v3.1.0

Track latency, error rate, and availability against defined SLA
thresholds. The monitor subscribes to client lifecycle events
automatically.

### Setup

```typescript
import { SLAMonitor } from "@hilbras/sdk";

const monitor = new SLAMonitor(client, [
  { name: "p95 latency", metric: "latency_p95", threshold: 2000, windowMs: 60_000 },
  { name: "availability", metric: "availability", threshold: 0.99, windowMs: 300_000 },
  { name: "error rate", metric: "error_rate", threshold: 0.05, windowMs: 60_000 },
]);
```

### SLA metrics

| Metric | Description | Threshold meaning |
|--------|-------------|-------------------|
| `latency_p95` | 95th percentile latency (ms) | Breach if **above** threshold |
| `latency_p99` | 99th percentile latency (ms) | Breach if **above** threshold |
| `error_rate` | Fraction of failed requests (0-1) | Breach if **above** threshold |
| `availability` | Fraction of successful requests (0-1) | Breach if **below** threshold |
| `cost_per_request` | Average cost per request ($) | Breach if **above** threshold |

### Checking compliance

```typescript
const report = monitor.report();

console.log(`All SLAs met: ${report.allCompliant}`);

for (const sla of report.slas) {
  console.log(`${sla.name}: ${sla.compliant ? "✓" : "✗"} (${sla.currentValue} / ${sla.threshold})`);
  if (sla.lastBreach) {
    console.log(`  Last breach: ${sla.lastBreach.actual} at ${new Date(sla.lastBreach.timestamp).toISOString()}`);
  }
}
```

### Breach alerts

Configure a callback to fire on SLA breaches:

```typescript
const monitor = new SLAMonitor(client, [
  {
    name: "p95 latency",
    metric: "latency_p95",
    threshold: 2000,
    windowMs: 60_000,
    alertOnBreach: (breach) => {
      console.error(`SLA BREACH: ${breach.sla} — ${breach.actual} exceeded ${breach.threshold}`);
      // Send to Slack, PagerDuty, etc.
    },
  },
]);
```

### Manual recording

For external integrations, record requests manually:

```typescript
monitor.record(durationMs: 150, success: true, cost: 0.002);
monitor.record(durationMs: 5000, success: false);
```

### Cleanup

```typescript
monitor.dispose(); // unsubscribes from client events
```

---

## Cost Alerts — v3.1.0

Get notified when spending crosses configurable thresholds.

### Setup with helper

```typescript
import { createCostAlertBudget } from "@hilbras/sdk";

const { budget, monitor } = createCostAlertBudget({
  sessionBudget: 10.00,
  thresholds: [
    { percent: 50, channel: { type: "callback", callback: (a) => console.log(`50%: $${a.report.totalActual}`) } },
    { percent: 75, channel: { type: "webhook", url: "https://hooks.slack.com/services/..." } },
    { percent: 90, channel: { type: "callback", callback: (a) => pageOnCall(a) } },
  ],
  defaultChannel: { type: "callback", callback: (a) => console.warn("Cost alert:", a.type) },
});

const client = new HilbrasClient({ budget });
```

### Alert types

- **`threshold_reached`** — Fired when spending crosses a configured percentage
- **`budget_exceeded`** — Fired when the session budget is fully consumed

### Alert object

```typescript
interface CostAlert {
  thresholdPercent: number;  // e.g. 75
  report: CostReport;        // full cost report at time of alert
  timestamp: number;         // Date.now()
  type: "threshold_reached" | "budget_exceeded";
}
```

### Resetting thresholds

```typescript
monitor.reset(); // allows thresholds to fire again (new budget period)
```
