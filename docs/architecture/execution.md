# Execution Architecture (v3.2.0)

The v3.2 execution layer is an **internal** architecture boundary. It is not
exported from the root package yet; existing `HilbrasClient` APIs remain the
supported public contract.

## Logical request and attempts

A logical request has one request ID, one budget reservation, one plugin
lifecycle, and one terminal outcome. A request may contain multiple provider
attempts:

```text
HilbrasClient
      ↓
RequestPipeline
      ├── request context and lifecycle
      ├── reserve → execute → settle/release
      ├── retry and fallback decisions
      └── terminal events
      ↓
RequestExecutor
      ↓
one provider attempt
      ↓
Provider adapter
```

- `src/core/execution/request-context.ts` describes the logical request and
  its attempt metadata.
- `src/core/execution/execution-result.ts` retains the original provider error
  or value without changing public error identity.
- `src/core/execution/request-executor.ts` owns policy preparation, circuit
  state, timeout scopes, and one adapter invocation.
- `src/core/execution/request-pipeline.ts` owns retries, fallback candidates,
  budget lifecycle, plugin hooks, and terminal events.
- `src/core/execution/ports.ts` keeps the execution layer independent from
  `HilbrasClient` and concrete registries.

These modules are internal until the public API stability review in the v4.x
program. Existing root exports, including `ExecutionPlan`, are unchanged.

## Timeout semantics

`ExecutionPolicy.timeout.requestTimeoutMs` is a logical-request deadline. The
primary retry chain shares one deadline, and fallback candidates are constrained
by the same original deadline. A `0` value disables the internal deadline.

Caller cancellation and internal timeout are distinct outcomes:

- caller cancellation is terminal and is not recorded as a provider/circuit
  failure;
- internal timeout may be classified as a provider attempt failure;
- backoff is abort-aware and does not invoke another attempt after cancellation.

Scoped timeout timers and parent-signal listeners are cleared when an execution
path completes.

## Budget lifecycle

The pipeline uses one logical reservation for a request's primary retry chain.
On success, the reservation is settled. On terminal failure or cancellation it
is released. Fallback candidates use explicit candidate reservations so their
cost can be accounted independently; the pipeline filters candidates using the
resolved `maxFallbackCost` policy.

Multimodal operations remain outside budget reservation in v3.2.0. This is an
explicit compatibility decision, not an omission: provider-specific pricing and
reservation semantics must be defined before charging those operations.

## Plugin and event lifecycle

Plugins run once for the logical request. A successful fallback reports the
provider/model that actually served the request. Streaming never retries or
falls back after a visible chunk has escaped to the consumer. Consumer
cancellation releases any active reservation.

Existing public event names and payload fields remain compatible. New internal
attempt metadata is not yet a public API.

## Release build

The production build uses `tsconfig.build.json`, which omits source and
declaration maps to keep the measured npm artifact below the repository's
1,900 KB size gate. Type checking still uses the full `tsconfig.json` contract.

## Migration boundary

No new root exports are required for the v3.2 refactor. Applications should
continue using:

```ts
await client.complete({ ... });
for await (const chunk of client.stream({ ... })) {
  // ...
}
```

The execution contracts will be reconsidered for public classification during
the v3.9/v4 architecture-boundary work.
