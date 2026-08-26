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

For lower-level HTTP-level logging, `sdkLogger` (re-exported as
`redact` for the underlying redaction function) is also available. See
[Security & SSRF Protection](security.md) for the redaction patterns.

## Zero overhead

The event emitter is a synchronous listener iteration. When no listeners
are attached, the `emit` call short-circuits to a no-op. There's no
async overhead and no per-event allocation when no one is listening.
