# SPEC v3.8.0 — Audit Fixes

Source: the whole-repo audit run on `main` at `d47fa29` (v3.7.0). Every finding
below was confirmed by reading the cited code and, where possible, by running
the built `dist/`. Nothing here is a style preference.

The release is **correctness and safety**, not features. Two goals:

1. Close the findings that lose money, leak data, or break at the expected load.
2. Delete the code the audit showed should not exist.

Load assumed: a long-lived server process handling many concurrent LLM
requests, plus developers who trust the shipped security features (RBAC,
injection guard, audit log) and the framework route handlers.

Compatibility: no public export is removed except the MCP stubs (see L1) and
the two dead `AuthorizationVerdict` fields (L4). Everything else is a behavior
fix at the same signature.

---

## Group A — Money and cost correctness

### A1. Cost-alert percentage uses the wrong denominator

- **Files:** `src/cost/alerts.ts:137-140`, `:164-169`
- **Bug:** percent = `totalActual / (totalActual + remainingBudget)`. The
  tracker's `remainingBudget` already subtracts reserved cost
  (`src/cost/tracker.ts:189-192`), so the denominator is
  `sessionBudget - reserved`, not the budget. The tracker itself divides by
  `sessionBudget` (`tracker.ts:241`).
- **Repro:** budget $100, `reserve("r", 90)` in flight, `actual 0` → 0%; a 50%
  threshold never fires though 90% is committed.
- **Fix:** one helper used by both `check()` and `_currentPercent()`:
  `committedCost / (committedCost + remainingBudget)`.
- **Test:** extend `tests/cost/alerts.test.ts` with reports that carry active
  reservations (current tests only use `remainingBudget` with none).
- **Accept:** percent equals the tracker's `committed/sessionBudget` for every
  reservation state.

### A2. Webhook budget alert is marked fired before dispatch, and failures are swallowed

- **Files:** `src/cost/alerts.ts:180-183`, `:205-221`
- **Bug:** `_firedThresholds.add(percent)` runs before `_dispatch`, and
  `_dispatch`'s `catch {}` swallows every error. A Slack 500 or DNS failure
  loses the alert forever.
- **Fix:** for `type === "webhook"`, add to `_firedThresholds` only after the
  fetch resolves ok; on failure call an `onDispatchError` hook (new optional
  config) and do not mark fired. Guard against double-fire while in flight.
- **Test:** new `tests/cost/alert-dispatch.test.ts` with a stubbed fetch that
  rejects, then succeeds.
- **Accept:** a failed webhook does not mark the threshold fired; a retry
  delivers it.

### A3. Anthropic / Gemini / Vertex / Ollama report zero cost and never emit `finish`

- **Files:** `src/adapters/anthropic.ts:207-232`, `google-genai.ts:172-193`,
  `google-vertex.ts:212-233`, `groq.ts:171-198`, `ollama.ts:138-165`
- **Bug:** none of the five yields a `{type:"finish"}` chunk (`grep '"finish"'`
  = 0); genai/vertex/ollama also never yield `usage`. `src/client/client.ts:1372`
  runs final structured-output validation only on `finish`, so
  `client.stream({output: schema})` on Claude/Gemini never finalizes or
  repairs. Anthropic reads prompt tokens from the wrong event
  (`anthropic.ts:224-231`, `message_delta` instead of `message_start`), so
  prompt tokens record 0.
- **Fix:** yield `finish` on `message_stop` / last candidate `finishReason` /
  `done:true`; map native usage for genai/vertex/ollama; accumulate Anthropic
  usage across `message_start` + `message_delta`.
- **Test:** per-adapter `finish`-chunk assertion and a usage-totals assertion;
  `tests/anthropic-adapter.test.ts` currently hand-writes `input_tokens` into
  `message_delta`, masking the bug — replace with the real event shape.
- **Accept:** structured streaming finalizes on all five; recorded prompt
  tokens are non-zero for a request that billed tokens.

### A4. Router cost/capability weighting is inert

- **Files:** `src/router/model-router.ts:259`, `:291-311`;
  `src/tokens/counter.ts:211`
- **Bug:** an unknown price returns `{input:0,output:0}`, and `cost === 0`
  scores 100, so unpriced models are preferred. Separately `finalScore` clamps
  to 100 while the weighted sum can reach ~155, so 34 of 39 models tie and
  `sort` falls back to catalog order. Ran it: a cost-weighted `writing` task
  returns the openai flagship, not the cheapest.
- **Fix:** score unknown price as worst (sentinel), and scale weights to sum
  ≤100 or drop the clamp.
- **Test:** `tests/router.test.ts` — assert a cost-weighted task picks the
  cheapest capable model, and that an unpriced model is not preferred.
- **Accept:** cost weighting changes the winner; no spurious ties.

### A5. `plan()` fallbacks report `estimatedCost: 0` and blank reasons

- **Files:** `src/router/model-router.ts:137`
- **Bug:** the fallback map hardcodes `estimatedCost: 0` and
  `reasons: [f.rejectionReason ?? ""]`, but fallbacks carry no
  `rejectionReason`.
- **Fix:** carry `s.estimatedCost` from `evaluate`; emit real reason strings.
- **Test:** `tests/router.test.ts` — fallback cost is non-zero and reasons are
  non-empty.
- **Accept:** an execution plan's fallback cost reflects the model list.

---

## Group B — Security and data safety

### B1. Audit logger writes secrets verbatim to the log sink

- **Files:** `src/security/audit-logger.ts:338-341`
- **Bug:** only `description` goes through `redactPii`; `meta`,
  `previousValue`, `newValue`, and `error` are copied raw, and the default sink
  is `console.log(JSON.stringify(entry))` (`:155`).
- **Repro (ran):** `logConfigChange({newValue:{apiKey:"sk-live-SECRET123"},
  meta:{token:"ghp_SECRET"}})` prints both secrets.
- **Fix:** a `redactDeep` helper that runs `redactPii` over every string
  reachable in `meta`/`previousValue`/`newValue`/`error`.
- **Test:** `tests/security-hardening.test.ts` (audit section) — a nested
  secret in `meta` and `newValue` is absent from the emitted entry.
- **Accept:** no key-shaped string from any field reaches the sink.

### B2. Injection guard "strip" mode removes only the first of a repeated payload

- **Files:** `src/security/prompt-injection-guard.ts:401-415`
- **Bug:** detections are deduped, then the loop replaces only the first
  `indexOf` match.
- **Repro (ran):** `"Ignore all previous instructions. Then Ignore all previous
  instructions."` → the second survives.
- **Fix:** replace every occurrence (`split(matchedText).join(placeholder)`).
- **Test:** `tests/prompt-injection-guard.test.ts` — a payload repeated twice is
  fully removed.
- **Accept:** no residual injection text for any repeat count.

### B3. Injection guard "strip" mode drops non-text content parts

- **Files:** `src/security/prompt-injection-guard.ts:417`
- **Bug:** the sanitized message is rebuilt with `content: sanitized` (a
  string) even when `content` was a `ContentPart[]`, silently deleting image
  and audio parts.
- **Repro (ran):** a `[text, image_url]` message comes back as a string.
- **Fix:** when content is an array, map only the text parts; keep the rest.
- **Test:** `tests/prompt-injection-guard.test.ts` — a multimodal message
  survives with its image part and a stripped text part.
- **Accept:** enabling strip mode does not change non-text parts.

### B4. `jsonSchema` accepts a non-object for an `object` schema

- **Files:** `src/output/schema-helpers.ts:140`
- **Bug:** the mismatch branch excludes `type === "object"`, and the object
  branch only runs when data is already an object.
- **Repro (ran):** `jsonSchema({type:"object"}).schema.safeParse("oops")` →
  `{success:true, data:"oops"}`; no repair prompt.
- **Fix:** for `type === "object"`, reject when data is not a non-null,
  non-array object.
- **Test:** `tests/schema-helpers.test.ts` — object schema vs string, number,
  null, and array all fail.
- **Accept:** malformed output triggers the repair loop.

### B5. Config snapshot crashes and leaks secrets

- **Files:** `src/config/resolved-config.ts:53-66`;
  `src/config/config-resolver.ts:136`; `src/config/sources/environment.ts:109`
- **Bug 1:** `safe.providers.map` with no array check. Ran
  `resolveConfig({overrides:{providers:null},strict:false}).safeSnapshot()` →
  `TypeError: Cannot read properties of null`.
- **Bug 2:** webhook URLs are not treated as secrets — ran a config with
  `costAlerts.defaultChannel.url = ".../SUPERSECRETTOKEN"` and the token
  appears in `safeSnapshot()`. `validateBaseUrl`'s reason also echoes the raw
  URL, so a key in a query string reaches `getConfigDiagnostics()`.
- **Fix:** guard/coerce `providers`; redact `AlertChannel.url`; make
  diagnostics omit the URL value.
- **Test:** `tests/config/` — snapshot of a null-providers config does not
  throw; a webhook URL and a `?api_key=` baseUrl are absent from
  snapshot/diagnostics.
- **Accept:** snapshot never throws on a malformed config and never contains a
  credential-bearing URL.

### B6. MCPClient returns fabricated tool results and is exported publicly

- **Files:** `src/mcp/index.ts:62-89`; `src/index.ts:259-260`
- **Bug:** `connect()` opens nothing, `callTool` returns
  `{result:"Called X on Y"}`, `readResource` returns empty text. Exported as a
  feature.
- **Fix:** remove the MCP exports (and the `./mcp` subpath) until a real
  transport exists, or throw "not implemented". Decision: **remove for now**
  (see L1); it is a stub, and shipping a stub that returns fake tool output is
  worse than shipping nothing.
- **Test:** remove `tests/mcp.test.ts` with the feature, or keep it only if the
  decision is "throw".
- **Accept:** no public API returns fabricated model/tool output.

---

## Group C — Execution and reliability

### C1. One request timeout per logical request kills retries and fallback

- **Files:** `src/core/execution/request-executor.ts:70-87`;
  `src/core/execution/request-pipeline.ts:210-215`, `:458-463`, `:786-791`
- **Bug:** `prepare()` builds one `ScopedTimeout` reused for the whole logical
  request. The fallback re-`prepare()` passes the primary's signal as the
  parent (`callerSignal: prepared.signal`), and `executeComplete` returns
  `AbortError` immediately when the parent is aborted
  (`request-executor.ts:123-125`). After a primary timeout, the fallback never
  runs and each retry fails instantly while still sleeping the backoff.
- **Fix:** create the timeout per attempt; pass `input.callerSignal` (not
  `prepared.signal`) to the three fallback `prepare()` calls.
- **Test:** `tests/execution-pipeline-audit.test.ts` — a primary that times out
  with a fallback configured calls the fallback and succeeds.
- **Accept:** fallback runs after a primary timeout; retries after a timeout
  make a real attempt.

### C2. Circuit breaker half-open slots leak into a permanent lockout

- **Files:** `src/reliability/circuit-breaker.ts:81-86`;
  `src/core/execution/request-executor.ts:123-132`
- **Bug:** `isAvailable()` increments `_halfOpenCalls`; only
  `recordSuccess`/`recordFailure` (`:96`, `:115`) give it back. Executor paths
  that return before recording (`callerSignal?.aborted`, provider-not-found)
  leak the slot. The `half_open` branch has no time escape (only `open` does,
  `:75`), so filled slots return `false` forever.
- **Fix:** give `half_open` the same elapsed-time escape as `open`; count the
  transition call.
- **Test:** `tests/circuit-breaker-audit.test.ts` — fill half-open slots with
  aborted calls, advance the clock past `timeoutMs`, assert availability.
- **Accept:** an aborted probe cannot lock a provider out.

### C3. Multimodal client path retries non-retryable HTTP statuses

- **Files:** `src/client/client.ts:950-951`
- **Bug:** `(status > 0 && shouldRetry(...)) || shouldRetryNetworkError(...)` —
  the second clause ignores status and defaults true, so a 401/403/404 is
  retried with full backoff and `recordFailure` runs once per attempt. The
  pipeline gates correctly (`request-pipeline.ts:171-172`).
- **Fix:** `status > 0 ? shouldRetry(status, attempt, cfg) : shouldRetryNetworkError(...)`.
- **Test:** `tests/` — a 401 from the multimodal path is attempted once.
- **Accept:** non-retryable statuses are attempted once and do not inflate the
  breaker.

### C4. Retry and abort hygiene

- **Files:** `src/client/client.ts:941-958`; `src/reliability/backoff.ts:25-28`;
  `src/reliability/retry.ts:19-27`; `src/reliability/timeout.ts:83-84`
- **Bug 1:** the retry loop never checks `signal.aborted` and `sleep(delay)` is
  not cancellable → a cancelled request keeps retrying for minutes.
- **Bug 2 (ran):** jitter is added after the cap → 38 980 ms against a 30 000 ms
  `maxDelayMs`.
- **Bug 3 (ran):** `createRetryConfig` spreads `DEFAULT_RETRY` by reference, so
  `createRetryConfig().retryableStatuses.add(418)` mutates the module default;
  an unrelated client then retries 418.
- **Bug 4:** `createTimeoutSignal` discards `cancel()`, leaking a timer and a
  parent-signal listener per call.
- **Fix:** check `signal.aborted` and pass the signal to `sleep`; clamp after
  jitter; copy the Set; return the `ScopedTimeout` so callers can cancel.
- **Test:** `tests/reliability/` — aborted signal stops retrying; backoff never
  exceeds `maxDelayMs`; two configs do not share a Set.
- **Accept:** cancellation is honored; delays respect the cap; configs are
  independent.

### C5. `runStructuredComplete` releases the primary reservation twice

- **Files:** `src/core/execution/request-pipeline.ts:772` vs `:842`
- **Bug:** line 772 calls `budget.release(...)` directly, bypassing the
  `budgetReleased` guard, then line 842 releases again. Masked today because
  `release()` is idempotent, but it is the wrong invariant in the money path
  and any non-idempotent `BudgetPort` corrupts.
- **Fix:** replace line 772 with `releaseBudget()`.
- **Test:** `tests/execution-pipeline-audit.test.ts` — a counting `BudgetPort`
  sees exactly one release per request on the structured fallback path.
- **Accept:** release happens once on every path.

### C6. `runStructuredComplete` classifies network errors differently from `runComplete`

- **Files:** `src/core/execution/request-pipeline.ts:745-749` vs `:166-172`
- **Bug:** the structured path omits `isNetworkFailure`, so a socket
  `ECONNRESET`/`ENOTFOUND` never retries there but does on `complete()`.
- **Fix:** extract one `classifyRetryable(error)` used by all three loops.
- **Test:** `tests/execution-pipeline-audit.test.ts` — a network error retries
  on both paths.
- **Accept:** retry classification is identical across complete/stream/structured.

### C7. `stream.first_chunk.latencyMs` is hardcoded 0 and never emitted on fallback

- **Files:** `src/core/execution/request-pipeline.ts:330-338`, `:466-490`
- **Bug:** the emit passes `latencyMs: 0` though the event contract says
  "time to first chunk"; a fallback stream emits no `first_chunk` at all.
- **Fix:** emit `now() - input.startTime`; emit the same event on the first
  fallback chunk.
- **Test:** `tests/core/execution/request-pipeline.test.ts` — assert a non-zero
  latency (the harness currently uses `now: () => 0`, so give it a clock).
- **Accept:** TTFT is correct on primary and fallback.

---

## Group D — Adapters and parsing

### D1. Reasoning normalizer loses the answer when thinking and reply share one delta

- **Files:** `src/reasoning/normalizer.ts:37-41`, `:57`
- **Repro (ran):** `feedText("<thinking>2+2=4</thinking>The answer is 4")` →
  reasoning text `"2+2=4</thinking>The answer is 4"`; the answer is emitted as
  reasoning. All 9 adapters call `feedText`.
- **Fix:** after entering the tag, slice at the close tag when present; use an
  unanchored close-tag regex for the strip.
- **Test:** `tests/reasoning-normalization.test.ts` — a single delta with a full
  thinking block plus reply yields both a reasoning part and a text part.
- **Accept:** the answer is never swallowed by the reasoning part.

### D2. SSE parsing breaks on CRLF framing and multi-line `data:` (20 hand-rolled copies)

- **Files:** `src/utils/sse.ts:59`, `:90`, plus the inline copies in
  openai/openai-compatible/azure/groq/ollama/huggingface/anthropic/cohere/
  genai/vertex/bedrock
- **Bug:** `split("\n\n")` never matches `\r\n\r\n`, so a CRLF proxy yields zero
  events and the buffer grows for the whole response; `startsWith("data: ")`
  rejects legal `data:{...}`; the adapter copies keep only the last `data:`
  line of an event.
- **Fix:** one shared parser (accept both terminators, optional space after
  `data:`, concatenate multi-line data); call it from every adapter.
- **Test:** `tests/sse-utils.test.ts` — CRLF stream, `data:` without space,
  multi-line payload.
- **Accept:** all 20 call sites use the shared parser and pass the CRLF cases.

### D3. Adapter correctness batch

- **Files / bugs:**
  - `src/adapters/bedrock.ts:383-404` — phantom tool call for text blocks
    (`contentBlockStop` always yields a tool_call), re-quoted argument
    fragments produce invalid JSON, and the delta/stop ids differ from the
    start id.
  - `src/adapters/cohere.ts:61-79` — the last user turn is sent twice
    (`chatHistory` plus top-level `message`), and `role:"tool"` messages are
    dropped.
  - `src/adapters/groq.ts:57-91`, `:171-198`; `src/adapters/ollama.ts:45-70` —
    `tools` are never sent and the `<tool_call>` text parser is never used,
    though the docstrings and the catalog claim tools support.
  - `src/adapters/ollama.ts:215` — `embed` posts to `${baseUrl}/api/embeddings`
    where the catalog baseUrl already ends in `/v1` → 404.
  - `src/adapters/ollama.ts:63` — `maxTokens` sent as `body.options.num_predict`
    which `/v1/chat/completions` ignores.
  - `src/adapters/google-genai.ts:363`, `google-vertex.ts:394` —
    `btoa(String.fromCharCode(...bytes))` throws `RangeError: Maximum call
    stack size exceeded` for audio > ~100 KB.
  - `src/adapters/cohere.ts:287` — `dimensions` sets `embedding_types` instead
    of `output_dimension`.
- **Fix:** one item at a time, each with its own test.
- **Test:** extend the per-adapter test files.
- **Accept:** each bug has a failing-then-passing test.

---

## Group E — Frameworks and transport

### E1. Streaming route returns HTTP 200 with the provider's error text; `onError` never fires

- **Files:** `src/frameworks/nextjs/route-handlers.ts:119-138`;
  `src/utils/sse-writer.ts:143-153`
- **Bug:** `client.streamText` is a lazy generator, so the provider call runs
  after the 200 was returned. A 401/429 is written to the browser as
  `data: {"type":"error","error":<provider body>}` and `options.onError` is
  never called, contradicting the module contract at `route-handlers.ts:90-92`.
- **Fix:** wrap the iterable before `createSSEResponse` so a first-chunk failure
  is reported to `onError` and replaced with a generic message.
- **Test:** `tests/frameworks/` — a rejecting provider yields an error event
  with a generic message and invokes `onError`.
- **Accept:** provider error text never reaches the client; operators see the
  failure.

### E2. Framework handler pool leaks a client per failed request

- **Files:** `src/frameworks/shared/handler-core.ts:208-216`
- **Bug:** `owned.add(client)` (`:209`) runs before
  `addProviderFromCatalog` (`:214`), which throws for a model not in the
  catalog. The client is left in the unbounded `owned` set and out of `cache`.
  `owned` never shrinks until `dispose()`.
- **Fix:** move `owned.add(client)` after the call; and swap `pool.get()` /
  `onRequest` order in `route-handlers.ts:93,97` so an unauthenticated caller
  cannot force client creation.
- **Test:** `tests/frameworks/handlers.test.ts` — N bad-model requests do not
  grow `owned`; `onRequest` runs before any client is built.
- **Accept:** a bad request allocates nothing retained.

### E3. Framework hooks never abort on unmount

- **Files:** `src/frameworks/react/use-chat.ts:46-98`,
  `vue/use-chat.ts:42-48`, `svelte/use-chat.ts:55-75`
- **Bug:** the controller is stored and `stop()` exists, but no unmount cleanup
  is registered, so a stream keeps running and writing state after the
  component is gone.
- **Fix:** `useEffect(() => () => abortRef.current?.abort(), [])` (React),
  `onUnmounted` (Vue), `onDestroy` (Svelte).
- **Test:** framework tests — unmount aborts the in-flight controller.
- **Accept:** no state write after unmount.

### E4. `nextjs` `use-chat.append()` has no in-flight guard

- **Files:** `src/frameworks/nextjs/use-chat.ts:82-99`
- **Bug:** two concurrent `append` calls interleave into the same message slot
  and only the second is abortable.
- **Fix:** `if (isLoading.value) return;` at the top of `append`/`reload`.
- **Test:** `tests/nextjs.test.ts` — a second `append` while loading is a no-op.
- **Accept:** one stream at a time.

### E5. react-client `retry()` duplicates the user turn

- **Files:** `src/frameworks/react-client/use-chat.ts:251-262`, `:140-147`
- **Bug:** `retry` removes the assistant message then calls `sendMessage(last)`,
  which appends the user message again → the provider sees the question twice.
- **Fix:** append and start the stream directly, or add a `skipAppend` flag.
- **Test:** `tests/frameworks/react-client.test.ts` — after `retry`, messages
  contain the user turn once.
- **Accept:** the transcript is not duplicated.

### E6. `FetchTransport` frees the connection slot and deregisters the controller at headers

- **Files:** `src/transport/fetch.ts:156-173`
- **Bug:** `requestFn`'s `finally` runs when `fetch()` resolves (headers), so
  `maxConnectionsPerOrigin` does not limit streams and `abort()`/`destroy()`
  cannot abort a live stream body.
- **Fix:** release the slot and delete the controller when the body completes
  (wrap `res.body`), not at headers.
- **Test:** `tests/transport/` — concurrent streams respect the cap; abort
  during streaming stops the reader.
- **Accept:** the cap holds for streams; shutdown aborts in-flight bodies.

---

## Group F — Router, config, catalog

### F1. `safeSnapshot` / diagnostics / catalog coverage

- Covered by B5 (snapshot crash + secret leak), A4/A5 (router).
- **F1a catalog consistency:** `src/catalog/provider-catalog.ts:28-31` and
  `src/catalog/models.ts:39` disagree (e.g. `gpt-5.6-sol` context window
  1050000 vs 1048576; `claude-fable-5-1` vs `claude-fable-5`), and
  `DEFAULT_CONFIG.defaultModel = "gpt-4o"` is absent from the router catalog
  (`config-schema.ts:76`). Add a test asserting per-id equality between the two
  tables.
- **F1b unknown price:** `src/tokens/counter.ts:211` — an unpriced model costs
  0 and `PRICING` is rebuilt per call. Return a sentinel and hoist the table.
- **Accept:** a catalog consistency test passes; unknown price never scores best.

---

## Group G — Lean (delete what should not exist)

### L1. Remove the MCP stub

- Delete the exports (`src/index.ts:259-260`), the `./mcp` subpath in
  `package.json`, `src/mcp/**`, and `tests/mcp.test.ts`. The subpath table
  checker (`tools/gen-subpath-table.mjs`) and `docs/` mention it — update both.

### L2. Delete `packages/next/`

- Untracked build remnant (`dist/` only, no `package.json`, no `src`). The
  Next.js integration lives at `@hilbras/sdk/nextjs/*`.

### L3. Delete the dead execution-layer surface

- `src/core/execution/ports.ts:44-53` — `clock` and `budget` are declared and
  never read.
- `src/core/execution/request-context.ts` — `deriveRequestContext`,
  `toTelemetryContext`, and the `executionSignal`/`attempt`/`phase` fields are
  referenced only by `tests/core/execution/context.test.ts`.
- `providerTimeoutMs: 0` is inert because the policy timeout short-circuits it
  (`request-executor.ts:70`).
- Delete the unused surface; keep only what `src/` reads.

### L4. Delete the unreachable 429 verdict branch

- `src/security/rbac.ts:273-275` and `src/security/authorization.ts:143-154` —
  nothing sets `status: 429` or `retryAfterMs` on a verdict (rate limiting
  answers directly at `rbac.ts:207`). Delete the branch and the two fields.

### L5. Delete `streamIdleTimeoutMs`

- `src/reliability/timeout.ts:11`, `:16` — defined and read nowhere, so the
  documented stream idle timeout does not exist. Either implement it in the
  stream loops or delete the field and the doc claim. Decision: **delete**;
  file a follow-up if idle enforcement is wanted.

### L6. Consolidate presets and fix duplicate 429

- `src/reliability/presets.ts:59,72` list `429` twice; `:87` re-implements
  `getPreset("balanced")` — replace with `return getPreset("balanced")`.

### L7. Collapse the 20 SSE parsers

- Covered by D2 (one shared parser used everywhere). Counts as lean too.

### L8. `createTimeoutSignal` returns a `{signal, cancel}` handle

- Covered by C4 bug 4; the handle is the simpler API than a bare signal.

---

## Group H — RBAC and remaining correctness

### H1. RBAC `checkPermission` fails open when provider/model is unresolved

- **Files:** `src/security/rbac.ts:62-79` → `src/security/authorization.ts:370-381`
- **Bug:** `checkPermission` hardcodes `enforcement: "permissive"`, so a
  declared restriction whose subject is empty returns `allow:true`.
  `checkPermission({allowedProviders:["openai"],...}, "", "gpt-4o")` →
  `{allowed:true}`.
- **Fix:** add an `enforcement` parameter defaulting to `"strict"` for this
  helper and forward it.
- **Test:** `tests/security/rbac.test.ts` — an empty provider with a provider
  restriction is denied under the default.
- **Accept:** the gate does not answer "yes" for what it cannot evaluate.

### H2. `degradation` loses `lastError` when every level returns 400

- **Files:** `src/reliability/degradation.ts:106-115`
- **Fix:** set `lastError` for the 400 case too, so the caller gets the real
  cause instead of a generic message.
- **Test:** `tests/degradation.test.ts`.

### H3. `AuditLogger.cloneValue` corrupts non-plain values and does not detach cycles

- **Files:** `src/security/audit-logger.ts:127-137`
- **Repro:** `cloneValue(new Date(...))` → `{}`; a cyclic `meta` keeps a live
  reference the caller can still mutate.
- **Fix:** pass through non-plain objects; on the seen-cycle branch return
  `undefined` rather than the live object.
- **Test:** `tests/security-hardening.test.ts`.

### H4. `countByCategory` returns a partial object

- **Files:** `src/security/audit-logger.ts:296-302`
- **Fix:** seed all categories at 0 before counting.
- **Test:** `tests/security-hardening.test.ts` — every category key exists.

---

## Group I — Release hygiene

### I1. Enforce or remove the coverage thresholds

- `vitest.config.ts:28-33` declares 80/70/80/80, but CI never runs
  `test:coverage` and the committed `coverage/coverage-summary.json` (68/62/69/66)
  is below all of them. Either add `npm run test:coverage` to CI and get above
  the thresholds, or lower them to the real floor and record why. Decision:
  add the gate; raise coverage with the tests this release already adds.

### I2. Fix stale numbers in `README.md`

- Badge says "1939 passing"; the dev section says "1611 tests"; actual is 1990.
  Update both, and the `packages/next`-era references if any remain.

### I3. `node:crypto` / `node:fs` on the main import path

- `src/index.ts:144,172-173,245` re-export `config.ts` (`node:fs`),
  `request-signer.ts` (`node:crypto`), and `bedrock.js` (`node:crypto`);
  `getDefaultAdapterRegistry` imports Bedrock eagerly and `HilbrasClient` calls
  it at construction (`client.ts:216`). The README claims browser/edge support.
  This overlaps `ROADMAP-v4.0.0.md` item 8 — keep the plan consistent with that
  decision; if deferred, downgrade the README claim and record it.

### I4. `@hilbras/ui` `CostBadge` always renders `$0.0000`

- `packages/ui/src/CostBadge.tsx:20-28` reads `totalCost` from `useChatBox()`,
  which is only ever `setTotalCost(0)` (`react-client/use-chat.ts:125`). The
  real value is `costSnapshot.totalCost`.
- **Fix:** read `costSnapshot.totalCost`.
- **Test:** `packages/ui/tests/components.test.tsx` currently asserts the bug;
  update it.

---

## Verification gates for the release

1. `npx tsc --noEmit` — clean.
2. `npm test` — all green, including the new failing-first tests.
3. `npm run lint` — clean.
4. `npm run build && npm run check:package && npm run size` — size under the
   1900 KB gate.
5. `npm run check:subpaths` — updated if L1 removes a subpath.
6. `npm run test:coverage` — above the thresholds once I1 lands.
7. `npm run test:packages` — `@hilbras/ui` fix (I4) builds and passes.

## Out of scope

- Features (`ROADMAP-v4.0.0.md` items: agent schema enforcement, per-role
  budget attribution, browser credential isolation). Tracked there, not here.
- DNS-pinning SSRF (documented out of scope in `url-guard.ts:417-427`).
