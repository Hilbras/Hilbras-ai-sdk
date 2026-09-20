# Contributor-Friendly Issues for Community Launch

## Good First Issues

### 1. Add Mistral Adapter
**Labels:** `good first issue`, `adapter`, `enhancement`
**Description:** Add a Mistral AI adapter following the existing adapter pattern. Mistral uses an OpenAI-compatible API format, so this should extend `OpenAICompatibleAdapter`. Include streaming support, tool calling, and vision (if supported by the model).

**Files to reference:** `src/adapters/openai-compatible.ts`, `src/adapters/openai.ts`

---

### 2. Add Replicate Adapter
**Labels:** `good first issue`, `adapter`, `enhancement`
**Description:** Add a Replicate adapter for running open-source models via Replicate's API. Focus on text generation with streaming support.

**Files to reference:** `src/adapters/openai-compatible.ts` (for pattern)

---

### 3. Add Together AI Adapter
**Labels:** `good first issue`, `adapter`, `enhancement`
**Description:** Add a Together AI adapter. Together AI uses an OpenAI-compatible API, so extend `OpenAICompatibleAdapter`.

**Files to reference:** `src/adapters/openai-compatible.ts`

---

### 4. Add Per-Request Cost Limit
**Labels:** `good first issue`, `cost`, `enhancement`
**Description:** Allow setting a per-request cost limit in the client config. If the estimated cost exceeds this limit, reject the request before calling the provider. This should work alongside the existing session budget.

**Files to reference:** `src/cost/tracker.ts`, `src/client/client.ts`

---

### 5. Add Streaming Token Count in Real-Time
**Labels:** `good first issue`, `streaming`, `enhancement`
**Description:** Emit a `usage` chunk during streaming that includes the running token count as chunks arrive, not just at the end. This enables real-time cost display in dashboards.

**Files to reference:** `src/client/pipeline.ts`, `src/types/streams.ts`

---

### 6. Add Model Capability Auto-Detection
**Labels:** `good first issue`, `router`, `enhancement`
**Description:** When adding a provider from the catalog, automatically detect model capabilities (vision, tools, reasoning) from the model metadata rather than requiring manual specification.

**Files to reference:** `src/providers/catalog.ts`, `src/types/models.ts`

---

## Medium Issues

### 7. Next.js Example App
**Labels:** `example`, `nextjs`, `documentation`
**Description:** Create a complete Next.js example app demonstrating:
- Streaming chat with `@hilbras/sdk`
- Structured output for form generation
- Cost tracking display
- Error handling with actionable messages

**Location:** `examples/nextjs/`

---

### 8. SvelteKit Example App
**Labels:** `example`, `sveltekit`, `documentation`
**Description:** Create a SvelteKit example app demonstrating the same features as the Next.js example.

**Location:** `examples/sveltekit/`

---

### 9. Hono Example App
**Labels:** `example`, `hono`, `documentation`
**Description:** Create a Hono (edge runtime) example app demonstrating streaming, structured output, and cost tracking in a lightweight API server.

**Location:** `examples/hono/`

---

### 10. Add OpenTelemetry Span Attributes
**Labels:** `telemetry`, `opentelemetry`, `enhancement`
**Description:** Enhance the existing `OpenTelemetryExporter` to include custom span attributes for: provider name, model ID, token counts, cost estimate, circuit breaker state, routing score.

**Files to reference:** `src/telemetry/opentelemetry.ts`

---

### 11. Add Cost Projection Before Streaming
**Labels:** `cost`, `enhancement`
**Description:** Before starting a stream, calculate and emit a `cost_projection` hook event with the estimated total cost based on input tokens and model pricing. This enables UIs to show "estimated cost: $0.03" before the stream completes.

**Files to reference:** `src/cost/tracker.ts`, `src/client/pipeline.ts`

---

### 12. Add Retry-After Header Parsing
**Labels:** `reliability`, `enhancement`
**Description:** When a provider returns a 429 with a `Retry-After` header, parse it and use it as the retry delay instead of the configured backoff. Already partially implemented in `ProviderRequestError` — needs to be wired into the retry logic.

**Files to reference:** `src/reliability/retry.ts`, `src/errors/index.ts`

---

## Documentation Issues

### 13. API Reference Documentation
**Labels:** `documentation`, `good first issue`
**Description:** Generate API reference documentation from the TypeScript source. Could use TypeDoc or a similar tool. Output should be hosted on GitHub Pages.

---

### 14. Migration Guide from Vercel AI SDK
**Labels:** `documentation`, `migration`
**Description:** Write a migration guide for developers coming from Vercel AI SDK. Cover: provider setup, streaming, tool calling, structured output, error handling differences.

---

### 15. Architecture Decision Records
**Labels:** `documentation`, `architecture`
**Description:** Create ADRs for key design decisions:
- Why zero dependencies
- Why not extend Vercel AI SDK
- Error hierarchy design
- Circuit breaker implementation
- SSRF validation approach
