# Hilbras SDK — Upgrade Plan: Surpassing the Vercel AI SDK

**Target:** `@hilbras/sdk` v1.1.1 (154 source files, 68 test files, zero runtime deps)
**Benchmark:** Vercel AI SDK `ai@7.x` — pnpm/Turborepo monorepo, ~80 published packages, Apache-2.0
**Basis:** Deep codebase audit (`HILBRAS-SDK-DEEP-CODEBASE-AUDIT.md`, §1–26) + live Vercel docs recon
**Status:** plan only — no code changed

---

## 0. Executive Summary

Hilbras will not beat Vercel by copying Vercel. Vercel's moat is distribution: ~80 packages, UI bindings for nine frameworks, 514 MDX docs pages, and templates for every stack. Rebuilding 80-package parity head-on is a multi-year, losing race.

Hilbras beats Vercel by winning on the axes Vercel is structurally weak in, then buying the ecosystem victory with three surgical moves instead of eighty packages:

1. **Correctness first (Phase 0).** The audit found 9 bugs, 2 config-system splits, and unwired subsystems. No plan survives a P0. BUG-01 (env-var API keys redacted into uselessness) alone makes the documented quickstart broken.
2. **Ship what already exists (Phase 1).** ~13 modules — telemetry sinks, credentials, degradation, PII guard — are built, tested, and disconnected. Wiring them converts dead code into differentiators at near-zero risk.
3. **Split the UI layer out (Phase 2).** `src/frameworks/*` (useChat/useObject/generative UI for 9 frameworks) compiles React/Vue/Svelte imports into the core package. Extract to `@hilbras/react`, `@hilbras/vue`, etc. — this is the single highest-impact competitive move.
4. **Differentiate on governance (Phase 3).** Hard budget enforcement, SSRF-safe provider registration, circuit breaking, cost observability are features Vercel does not lead with. Make them headline, not footnote.
5. **Then the long tail (Phase 4).** Edge tests, changesets, docs, playground, community surfaces.

**Definition of "better" (measurable):** a developer choosing an SDK for a production AI feature picks Hilbras over `ai@7` when any of these hold — and we make all of them hold by v2.0:

| # | Criterion | Vercel today | Hilbras target |
|---|---|---|---|
| 1 | Hard spend cap per request/session | none built-in | enforced reservation-based budgets |
| 2 | Works on a fresh `npm i` with zero transitive deps | core near-zero, adapters pull vendor SDKs | strictly zero, CI-verified |
| 3 | Policy-based routing + fallback | manual model strings | built-in router, 5 presets |
| 4 | Cost/latency observability out of the box | TelemetryDispatcher (BYO) | 3 sinks + dashboard, one config flag |
| 5 | SSRF-safe multi-tenant provider registration | not addressed | url-guard on every registration + realtime |
| 6 | React UI hooks parity | useChat/useObject/generative UI | parity + same API shape |
| 7 | Agents/tool-loop + MCP | Agent class, tool(), MCP | agent feature + real MCP client |
| 8 | Edge/browser safe | edge-tested in CI | node-free core barrel, edge smoke test |
| 9 | Docs depth | 514 MDX + llms.txt | docs-site + llms.txt + SKILL.md |

Items 1–5 are wins we already have or are one wiring pass away from; items 6–9 are the actual work.

---

## 1. Current State (verified this session)

| Fact | Value |
|---|---|
| Version | 1.1.1 (`package.json:3`) |
| Source | 154 `.ts` files under `src/` |
| Tests | 68 `*.test.ts` under `tests/` |
| Runtime deps | zero |
| Packages dir | only `cli` and `create-hilbras-app` — **no framework packages** |
| Framework hooks | `src/frameworks/{react,vue,svelte,angular,qwik,solid,astro,nextjs,remix}` compiled into core dist |
| MCP client | stub (`mcp/index.ts` returns fake "Called X on Y") |
| Realtime | OpenAI-only partial, bypasses SSRF guard (SEC-01) |
| Telemetry | StructuredLogger, OTel (broken `require()`), UsageDashboard — all unwired from client |
| Config | two unreconciled systems (`SDKConfig` loader vs `HilbrasClientConfig`); env path broken by BUG-01 |
| Catalog | two model catalogs + two pricing tables (SDK + CLI) |
| Docs | 6 markdown files + `docs-site/index.html` single page; stale v0.9.3-era analysis docs |
| CI | single workflow, Node 22/24, lint+build+test |
| God file | `src/client/client.ts` 1,217 lines; retry+fallback loops duplicated between stream/complete |

**Prior-audit note:** `docs/analysis/comparison.md` compares against v0.9.4 and a ~80-package Vercel tree. Its numbers are stale but its strategic conclusion stands and is adopted here: *"ai-main is a product; Hilbras SDK is a library."* The goal of this plan is to reverse that sentence.
## 2. Competitive Gap Matrix

Legend: ✅ shipped · 🟡 built but unwired/partial · ❌ absent · 🔴 broken as shipped

| Capability | Vercel ai@7 | Hilbras today | Plan ref |
|---|---|---|---|
| generateText / streamText / generateObject | ✅ | ✅ `complete`/`stream`; `streamObject` skips validation 🔴 BUG-04 | P0 |
| Tool calling + type-safe tool builder | ✅ `tool()` | ✅ | keep |
| Multi-step agent loop | ✅ Agent | 🟡 `features/agent` exists, not integrated with router/budget | P3 |
| MCP | ✅ | 🔴 stub | P3 |
| React useChat/useObject/generative UI | ✅ own package | 🟡 compiled into core dist | **P2 split** |
| Vue/Svelte/Solid/Qwik/Angular hooks | ✅ per-package | 🟡 same problem | **P2 split** |
| Next.js RSC / server-action helpers | ✅ | 🟡 `frameworks/nextjs` inside core | P2 |
| Embeddings, image, speech, transcription, rerank | partial | ✅ all five | keep — marketing gap only |
| Structured output + schema validation + repair | ✅ | ✅ non-streaming only | P0 |
| Reasoning normalization | provider-specific | 🟡 state leaks across chunks (BUG-02) | P0 |
| Hard budget enforcement | ❌ | ✅ reservation tracker (best-in-class) | keep, headline |
| Cost estimation + pricing tables | ❌ | 🟡 two unreconciled catalogs | P1 dedup |
| Circuit breaker / retry / timeout | manual | ✅ presets + breaker registry | keep |
| SSRF guard on provider URLs | ❌ | ✅ but realtime bypasses it (SEC-01) | P0/P1 |
| Telemetry sinks | dispatcher interface | 🟡 3 sinks + audit logger, zero wired | P1 |
| Env-var/file config | ❌ BYO | 🔴 loader exists, client ignores it (C5) + BUG-01 | P0 |
| Provider count | 20+ packages | 23 adapters, one package | keep |
| Edge runtime | ✅ CI-tested | ❌ `node:*` imports via root barrel (D3) | P2 |
| Docs | 514 MDX + llms.txt | single HTML page | P4 |
| Templates / scaffold | vercel.com/templates | `create-hilbras-app` exists | P4 |
| Release engineering | changesets + OIDC | manual publish | P4 |

**Reading of the matrix:** Hilbras's feature breadth already rivals Vercel's. The deficits are **correctness** (5 P0 rows), **wiring** (5 🟡 rows that are one pass away), and **distribution** (4 rows). That dictates the phase order.

---

## 3. Guiding Principles

1. **Never break the zero-dependency guarantee.** Every new feature must ship with zero runtime deps. This is the #1 thing Vercel cannot match in its core and the reason enterprises with strict supply-chain requirements would pick Hilbras. It is CI-enforced from Phase 1.
2. **Wire before build.** Any subsystem already built and tested gets wired before any new subsystem is created. Roughly 13 modules are waiting.
3. **One config surface.** Kill the `SDKConfig`/`HilbrasClientConfig` split (C5). Everything configures through one resolved object; env vars and files feed it.
4. **UI goes behind peer deps.** The core barrel must never import React/Vue/Svelte. Framework hooks become their own packages; the core keeps only transport-agnostic stream parsing.
5. **Audit-first quality gates.** Every phase ends with the audit discipline: regression tests named per bug, no silent catch, no dead exports added.
## 4. Phase 0 — Correctness (weeks 1–3) · `v1.2.0`

Goal: every audit P0/P1 fixed with a named regression test. Nothing new gets built before this ships.

### 4.1 BUG-01 — env-var API keys are redacted before storage (P0)

- `config/config.ts:79` passes `HILBRAS_PROVIDER_KEY` through `redact()`, so the stored credential is the literal string `"[REDACTED]"`.
- **Fix:** separate the *display mirror* (redacted) from the *credential value* (raw). The redaction pass must never touch fields consumed by adapters.
- **Gate:** test that `loadConfig()` with `HILBRAS_PROVIDER_KEY` set yields a provider whose credential resolves end-to-end through a mocked adapter `_headers()`.

### 4.2 C5 — unify the two config systems (P0)

- `SDKConfig` (loader) and `HilbrasClientConfig` (client) are disjoint; the env-var system configures nothing the client reads.
- **Fix:** one canonical `HilbrasClientConfig`. `loadConfig()` returns it (or a shaped override merged into it). `SDKConfig` remains only as a deprecated alias for one minor version.
- **Gate:** docs example `HILBRAS_PROVIDER_KEY=sk-… HILBRAS_DEFAULT_PROVIDER=openai hilbras chat` works without extra code.

### 4.3 BUG-02 — ReasoningNormalizer state leak (P1)

- Buffer state survives across streams in long-lived clients; user prose after a reasoning block is misclassified as reasoning.
- **Fix:** move `pendingProse`/tag-buffer state into a per-stream instance; clear on flush/end; add a multi-chunk prose-then-tag regression test.

### 4.4 BUG-04 — streamObject bypasses validation (P1)

- The non-streaming path validates + auto-repairs; the streaming path does not. Same feature, two contracts.
- **Fix:** route `streamObject` through `validateAndRepair` (validate the assembled value on completion), reusing `output/structured.ts`.
- **Gate:** a `streamObject` test with an invalid provider response asserts repair attempt and typed failure.

### 4.5 A2/A3 — Anthropic adapter wire-format bugs (P1)

- Array-content blocks are string-concatenated (`[object Object]` risk); `role:"tool"` messages forwarded verbatim instead of translated to Anthropic `tool_use`/`tool_result` blocks.
- **Fix:** proper content-block mapping and a tool-message translator; add wire-shape tests mirroring `openai-adapter.test.ts` coverage.

### 4.6 BUG-03/05/06/07/08/09 — the P2 batch

| Bug | Fix |
|---|---|
| BUG-03 double slot release | idempotent release in `FetchTransport` |
| BUG-05 global tokenizer | per-client tokenizer option; deprecate global setter |
| BUG-06 interval leak | clear stats interval in `dispose()` |
| BUG-07 half-open counter | guard `_halfOpenCalls` around transitions |
| BUG-08 budget error conflation | distinct `duplicate_request` error class |
| BUG-09 extractJson | return `null` (not raw text) when no JSON found |

### 4.7 SEC-01 — realtime SSRF gap (P2)

`RealtimeSession` builds a WebSocket URL that skips `validateOutboundUrl`. Route it through the guard with the same allow-insecure escape hatch as HTTP.

### 4.8 Phase 0 exit gate

- `npm test` green with one regression test per bug ID above.
- `npm run lint` clean.
- Zero behaviour change for users who do not touch the affected paths.
- CHANGELOG: "correctness release — 12 fixes, 0 breaking."

---
## 5. Phase 1 — Wire What Exists (weeks 3–6) · `v1.3.0`

Goal: convert ~13 built-but-disconnected modules into working, documented features. Highest value-to-risk ratio in the entire plan — this is where "dead code" becomes "the reason to switch."

### 5.1 Telemetry becomes a config flag, not a ritual

Today: `instrumentClient(client)` exists three times (StructuredLogger, OTel, UsageDashboard) and no user ever calls them.

- Add `telemetry?: TelemetrySink | TelemetrySink[]` to `HilbrasClientConfig`.
- Constructor wires each sink through the existing `ClientHooks` `on` API.
- Fix `telemetry/otel.ts` first: it uses CommonJS `require()` inside the ESM build — replace with a zero-dep OTLP-JSON exporter over `fetch` (keeps principle #1 intact).
- **Gate:** `new HilbrasClient({ telemetry: [structuredLogger(), dashboard()] })` produces JSON logs and aggregate stats with zero other code. Test in `tests/telemetry-wiring.test.ts`.

### 5.2 Audit logging

`AuditLogger` has no hook bridge. Give it the same `instrumentClient` treatment so compliance users get a request/response/metadata trail out of the box. This is a compliance-market differentiator Vercel does not advertise.

### 5.3 Credential resolution

`credentials/provider.ts` (`resolve(source)`) is built and tested but never called by the SDK.

- Accept `credentials?: CredentialProvider` in `HilbrasClientConfig` (or per-`ProviderConfig`).
- Adapters call it inside `_headers()` before falling back to static keys.
- **Gate:** a test resolves a key from a fake vault provider; static-key path unchanged for users who don't opt in.

### 5.4 Graceful degradation chain

`reliability/degradation.ts` already handles 413/400 by stripping media, shrinking context. Wire it into `pipeline.ts` ahead of final failure. Presets: `autoDowngrade` boolean in `ExecutionPolicy`.

### 5.5 PII guard on logs

`security/pii-guard.ts` plugs into logging/telemetry. Wire so `telemetry: [..., piiGuard()]` scrubs message content before sinks persist it. Governance story complete: budgets + audit + PII + SSRF.

### 5.6 Model catalog unification

- One source of truth: `catalog/models.ts` generates `provider-catalog.json` in a build step.
- CLI imports the same JSON (D7 resolved); delete the CLI's parallel `MODEL_PRICING` table.
- Add a build-time test: every `BUILTIN_MODELS` entry has a pricing entry or an explicit `noPricing` tag so `estimateCost` returns `null` instead of a silent `$0.00`.

### 5.7 Finish the pipeline extraction

Move retry + fallback loops from `stream()`/`complete()` into `pipeline.ts`; both methods become thin adapters. Target: `client.ts` < ~600 lines. This de-risks every later phase (agent loop, realtime, MCP all reuse one pipeline).

### 5.8 Phase 1 exit gate

- All §21-Category-B modules either wired or consciously removed (not just left exported).
- Docs updated: one "Observability in 60 seconds" page, one "Budgets" page.
- No new runtime dependencies. Bundle size checked (`tools/check-size.mjs`).

---
## 6. Phase 2 — Ecosystem Split (weeks 6–14) · `v2.0.0`

Goal: Hilbras ships `@hilbras/react`, `@hilbras/vue`, `@hilbras/svelte`, `@hilbras/nextjs` — peer-dependency packages mirroring Vercel's structure, while the core stays zero-dep and UI-agnostic.

### 6.1 Why this phase is the whole game

Today `src/frameworks/*` (9 frameworks: react, vue, svelte, angular, qwik, solid, astro, nextjs, remix) compiles into the core dist. Every user of `@hilbras/sdk` — CLI, server, headless — pays the React/Vue/Svelte bundle cost and the framework-specific type imports. Vercel ships these as separate packages with peer deps, so a Node-only user imports nothing framework-related.

The split does three things at once:
1. **Matches Vercel's surface** (useChat/useObject/generative UI per framework).
2. **Keeps the zero-dep promise** for the core (principle #1, now CI-enforced).
3. **Opens the distribution channel** — each framework package is a separate npm install, a separate README, a separate docs page.

### 6.2 The split mechanics

```
src/frameworks/react/          →  packages/react-ai-sdk/
  use-chat.ts                 →    src/use-chat.ts
  use-completion.ts           →    src/use-completion.ts
  use-object.ts               →    src/use-object.ts
  generative-ui.ts            →    src/generative-ui.ts
  stream-parser.ts            →    src/stream-parser.ts (shared, keep in core)
src/frameworks/vue/           →  packages/vue-ai-sdk/
src/frameworks/svelte/        →  packages/svelte-ai-sdk/
src/frameworks/nextjs/        →  packages/nextjs-ai-sdk/
... (angular, qwik, solid, astro, remix)
```

- `stream-parser.ts` stays in core — it is framework-agnostic SSE decoding.
- Each framework package declares `peerDependencies: { react: ">=18" }` (or vue/svelte/nextjs), and `dependencies: { "@hilbras/sdk": "^2.0" }`.
- Each package re-exports the same hook surface shape as Vercel (`useChat`, `useCompletion`, `useObject`) so a migration is a package-name swap.
- Generative UI (`generative-ui.ts`) becomes `@hilbras/react`'s headline feature — Vercel's differentiator, now ours.

### 6.3 Migration contract

A Hilbras app today:
```ts
import { useChat } from "@hilbras/sdk/react";
```
After the split:
```ts
import { useChat } from "@hilbras/react";
```
The subpath export `@hilbras/sdk/react` stays as a re-export shim for one minor version to avoid breaking existing users.

### 6.4 Edge runtime safety (D3)

- Root barrel (`src/index.ts`) must not transitively import `node:crypto`, `node:fs`, or any framework package.
- CI gate: a build-time lint rule (or `tools/check-size.mjs` extension) asserts the core dist has zero `node:` imports and zero framework imports.
- Add an `edge` test config (mirroring Vercel's `vitest.edge`) that runs the core suite against a minimal edge-like runtime.

### 6.5 Phase 2 exit gate

- `@hilbras/react` published with `useChat`/`useCompletion`/`useObject` + generative UI, peer-dep on React 18+.
- Core dist: zero framework imports, zero `node:*` imports, zero runtime deps — verified by CI.
- A Next.js app-router example and a SvelteKit example in `examples/` (replacing the current `showcase/`).
- `v2.0.0` — the first major bump, justified by the package split.

---
## 7. Phase 3 — Governance Differentiation (weeks 14–26) · `v2.1.0`

Goal: make Hilbras the default choice for regulated, cost-sensitive, multi-tenant, and embedded deployments — markets Vercel's consumer-first posture does not serve.

### 7.1 Hard budget enforcement — the headline

Vercel has no built-in cost cap; a misconfigured retry policy can multiply a token bill by 6x. Hilbras already has a reservation-based `BudgetTracker` (the audit calls it best-in-class). Make it unmissable:

- `budget?: { perSession?: number; perRequest?: number; perWindow?: number }` in `HilbrasClientConfig`.
- Every `stream()`/`complete()` reserves before the request, settles on completion, releases on abort/error.
- A `BudgetExceededError` thrown **before** the provider call — no surprise bills, no partial charges.
- `@hilbras/cost` subpath: `estimateCost()`, `pricing()`, `UsageDashboard` — a first-party cost-forecasting API.
- **Marketing:** "We cap your bill before the model runs. Vercel charges after."

### 7.2 SSRF-safe multi-tenant provider registration

`url-guard.ts` already blocks private IPs and DNS rebinding at registration. Make it the default and advertise it:

- `addProvider()` validates every URL through `validateOutboundUrl` — no opt-in flag needed.
- Fix SEC-01 so `RealtimeSession` uses the same guard.
- Document the attack surface: a Hilbras app that lets users supply base URLs cannot be tricked into proxying to `127.0.0.1`, `169.254.169.254`, or a rebinding hostname.
- **Marketing:** "Your users' API keys never touch your infrastructure. Your infrastructure never touches your own host."

### 7.3 Observability as a first-party surface

Phase 1 wires the sinks. Phase 3 makes them a product:

- `@hilbras/telemetry` subpath: `instrument()`, `createSpan()`, `createMetric()`, `dashboard()`.
- OTLP-JSON over `fetch` (zero deps) — no `@opentelemetry/*` to install.
- `HilbrasClient.on("start" | "chunk" | "end" | "error" | "budget" | "retry" | "fallback")` — typed events, no framework coupling.
- A `telemetry.jsonl` file sink for local dev, a JSON sink for prod, an OTLP sink for observability platforms — all one line apart.

### 7.4 Agents + tool loop

`features/agent` exists (`PlanAndExecuteAgent`, `ToolLoopAgent`) but is unwired from the router and budget. Integrate:

- `agent.run({ goal, tools, model, budget })` → uses `ModelRouter` to pick the model per step, `BudgetTracker` to cap spend, `pipeline.ts` for reliability.
- Fix G1: `PlanAndExecuteAgent.replanOnFailure` actually re-plans instead of failing.
- Expose `@hilbras/agent` subpath.

### 7.5 MCP — deliver or delete

`mcp/index.ts` is a stub. A real implementation (stdio + SSE, JSON-RPC) unlocks tool discovery, which is the feature that most benefits the agent layer.

- **Option A:** implement `MCPClient` properly (stdio transport, tool listing, tool calling through the existing adapter/tool surfaces). ~300 lines, high value.
- **Option B:** remove it from the barrel and document `@hilbras/mcp` as a future package.
- **Recommendation:** Option A. It closes the gap with Vercel's MCP support and gives agents a real tool discovery path.

### 7.6 Realtime completion

`realtime/index.ts` is OpenAI-only partial and bypasses the SSRF guard. Complete it:

- WebSocket transport with reconnect, timeout on `connect()` (fix R1), and SSRF validation.
- Voice + text channels; event shape matching the existing `StreamChunk` types so UI hooks consume it uniformly.
- **Marketing:** "Voice out of the box, SSRF-safe."

### 7.7 Phase 3 exit gate

- Budget enforcement demonstrable in a published benchmark (`tests/benchmarks/`): a session hitting its cap throws before the provider call.
- SSRF test suite: 6 attack vectors (IPv4 private, IPv6 private, DNS rebinding, localhost variants, metadata endpoint, URL re-resolution) all blocked at registration and at realtime connect.
- Agent loop integrated with router + budget; MCP client functional against a real server.
- `v2.1.0` — the "governance release."

---
## 8. Phase 4 — Distribution and Long Tail (weeks 26–40+) · `v2.2.0+`

Goal: Hilbras becomes findable, installable, and learnable in the same breath as Vercel. This phase is mostly content work and is the slowest-moving; it runs in parallel with Phase 3.

### 8.1 Docs as a product

Today: 6 markdown files + a single `docs-site/index.html`. Vercel: 514 MDX + `llms.txt`.

- Build a real docs site: `docs/` as MDX source, a lightweight static generator (zero runtime deps — keep the theme in `tools/`), published to `docs.hilbras.ai`.
- **`llms.txt`** — one file, ~200 lines, the entire API surface in Markdown. This is the Cursor/Windsurf/Copilot/Claude entry point and is the single highest-leverage docs move available.
- **`SKILL.md` files** (per Vercel's pattern): `adding-a-provider.md`, `adding-a-budget.md`, `adding-a-telemetry-sink.md` — packaged for coding agents, not just humans.
- **Migration guide** `migrate-from-vercel-ai-sdk.md` already exists — promote it to the docs homepage. It is the best conversion asset in the repo.

### 8.2 Templates and scaffolding

`create-hilbras-app` exists. Upgrade it:

- Framework templates: `nextjs`, `sveltekit`, `vue`, `solid`, `remix`, `expo` — each a one-command `npx create-hilbras-app@latest my-app --template nextjs`.
- A "governance starter" template: preconfigured budgets, telemetry, and SSRF-safe provider registration — the Hilbras demo, not the Vercel demo.
- Publish to `vercel.com/templates`-equivalent directory and `create-ai-app`-equivalent registry.

### 8.3 Release engineering

- **Changesets** (`@changesets/cli` — a dev dep, zero runtime): per-package changelogs, automated minor/major bumps, `main` branch gating. Mirrors Vercel's process without adopting its 80-package complexity.
- **OIDC publish**: `npm publish --provenance` via GitHub Actions on tag push. No tokens in the repo.
- **`prepublishOnly`** in `package.json`: ensure `dist/` is fresh before every publish.
- **CI matrix**: add Node 26, add an edge-runtime test config, add a Windows job for MCP. Three workflows total (mirroring Vercel's 12 in proportion, not scope).
- **Dependabot**: weekly npm + actions updates (already configured — keep).

### 8.4 Community surfaces

- **Discord / community** — one channel, active maintainers. Vercel's community is a moat; a smaller one is better than none.
- **`CONTRIBUTING.md`** already exists — expand with the `SKILL.md` agent workflows so contributors using Claude Code / Copilot / Cursor get first-class onboarding.
- **Issue templates**: one for bugs (with "reproduce with a minimal client" checklist), one for features (with "governance impact" field — this is a Hilbras-specific signal).
- **Benchmark suite**: `tests/benchmarks/performance.bench.ts` exists but was never run. Publish a `benchmarks/` page with latency/cost/size numbers against Vercel equivalents. Numbers convert.

### 8.5 Phase 4 exit gate

- `docs.hilbras.ai` live with `llms.txt`.
- `npx create-hilbras-app@latest` produces a working app in 6 framework templates.
- `npm publish --provenance` works from CI on tag push.
- One community channel with >100 members and weekly activity.

---
## 9. Measurement and Success Gates

A plan without numbers is a wish. Each phase ships with a measurable gate.

### 9.1 Quantitative targets

| Metric | Baseline (v1.1.1) | v2.0.0 target | v2.2.0 target |
|---|---|---|---|
| Core dist size (KB) | ~108 KB | ≤108 KB (zero framework imports) | ≤108 KB |
| Runtime dependencies | 0 | 0 | 0 |
| Source files | 154 | ~160 (pipeline refactor) | ~170 (MCP, realtime) |
| Test files | 68 | 75+ (wiring + integration tests) | 90+ |
| `client.ts` lines | 1,217 | <600 | <600 |
| Framework packages | 0 | 4 (react, vue, svelte, nextjs) | 9 |
| Docs pages | 6 markdown + 1 HTML | 30+ MDX + llms.txt | 100+ MDX + llms.txt |
| CI jobs | 3 (lint/build/test, Node 22/24) | 5 (+ edge, + Windows) | 8 (+ matrix) |
| Published packages | 1 | 5 | 10+ |
| SSRF test vectors | 0 | 6 | 6 |
| Budget test vectors | 0 | 4 (per-session/request/window + exceeded) | 4 |

### 9.2 Qualitative gates (the ones that actually decide "better")

- **A developer on the Hilbras subreddit or Discord can install `@hilbras/react` and build a chat UI in one command.** (Phase 2)
- **A security reviewer reading the docs sees a paragraph on SSRF-safe registration that is technically correct and demonstrable.** (Phase 3)
- **A finance lead reading the docs sees a budget cap that fires before the model call.** (Phase 3)
- **A Vercel user can copy-paste their `useChat` code into a Hilbras app and change one import.** (Phase 2)
- **A coding agent (Cursor/Claude) can answer "how do I add a provider to Hilbras?" from the SKILL.md alone.** (Phase 4)

### 9.3 The single most important measurement

**Time from `npm i @hilbras/sdk` to a working streaming chat.** Vercel's is ~2 minutes with `create-ai-app`. Hilbras's is currently longer because the quickstart is broken (BUG-01 + C5). Phase 0 fixes that. Everything else is leverage on this number.

---
## 10. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Scope creep into Vercel-copying.** The temptation to rebuild 80 packages is strong and the losing race is real. | High | Critical | Principle #1–6 are binding. Every proposal is scored against "does this win on zero-deps, budgets, or SSRF?" If no, it is Phase 4 content, not code. |
| R2 | **Phase 0 stalls the release train.** 12 fixes in 3 weeks is aggressive for a single maintainer. | Medium | High | Ship fixes incrementally; tag `v1.2.0` after the first 6. A partial correctness release beats a perfect one that never ships. |
| R3 | **Framework package split breaks existing users.** `@hilbras/sdk/react` subpath export is the migration shim — if it is dropped, apps break. | Medium | High | Keep the shim for one minor version. Add a deprecation warning in the subpath. |
| R4 | **Zero-deps promise is eroded by telemetry.** OTel exporters pull `@opentelemetry/*`. | Medium | High | OTLP-JSON over `fetch` only. CI gate asserts zero runtime deps after every PR. |
| R5 | **MCP implementation is a rabbit hole.** stdio + SSE + JSON-RPC + tool discovery is real work and easy to under-deliver. | Medium | Medium | Timebox to 2 weeks. If not shippable, delete the stub and document `@hilbras/mcp` as a roadmap item. A loud failure beats a silent one. |
| R6 | **Agent loop competes with Vercel's Agent class.** Vercel has a head start and framework integration. | Medium | Medium | Do not compete on features. Compete on governance: agent + budget + SSRF + cost. That combination does not exist in Vercel. |
| R7 | **Docs work is never "done" and always deprioritised.** | High | Medium | Make docs a Phase 4 *gate*, not a Phase 4 *afterthought*: no `v2.2.0` without `llms.txt` and `docs.hilbras.ai`. |
| R8 | **Single-maintainer bandwidth.** The plan assumes consistent weekly throughput. | High | High | Each phase is independently shippable. If bandwidth drops, Phases 0–1 alone are a defensible release. |
| R9 | **Competitive copycat.** Vercel could add budgets/SSRF/zero-deps tomorrow. | Low | Medium | Execution speed + the audit/test discipline (named regression tests, no dead exports) are hard to copy. The moat is the culture, not the feature. |
| R10 | **Node 18 deprecation.** `engines: ">=18"` will eventually bite. | Low | Low | Monitor; bump to `>=22` in a future major when Node 18 EOL is confirmed. |

---
6. **Reversibility.** Each phase is independently shippable. If a phase stalls, earlier phases still stand alone as a release.
## 11. Closing Summary

**The strategy in one sentence:** Hilbras beats Vercel not by matching Vercel's breadth, but by owning the three axes Vercel's consumer-first architecture cannot lead on — zero-dependency governance, hard budget enforcement, and SSRF-safe multi-tenant registration — while buying the ecosystem victory with a UI-layer split instead of eighty packages.

**The phase order is deliberate:**

- **Phase 0 (correctness)** comes first because a plan to out-compete anyone is worthless if the documented quickstart is broken. BUG-01 and C5 are the two that make the difference between "interesting" and "installable."
- **Phase 1 (wiring)** comes second because it converts ~600 lines of dead code into features at near-zero risk, and because every later phase depends on the pipeline refactor it forces.
- **Phase 2 (ecosystem split)** is the competitive leap. It is the only phase that closes a real gap with Vercel's product surface (framework packages) while simultaneously strengthening Hilbras's existing differentiator (zero-dep core).
- **Phase 3 (governance)** is where Hilbras becomes the default choice for the markets Vercel does not serve: regulated, cost-sensitive, multi-tenant, embedded.
- **Phase 4 (distribution)** is the slowest-moving and the most honest acknowledgment that a library that nobody can find is a library nobody uses.

**What this plan does not do:**

- It does not propose rewriting the adapter layer (it is good).
- It does not propose replacing the circuit breaker (it works).
- It does not propose a DI container (the registry pattern is sufficient).
- It does not propose matching Vercel's 20+ provider packages — Hilbras already has 23 adapters in one package, which is a different and in some ways better shape.
- It does not propose a monorepo for its own sake. The framework packages will be real packages with real peer deps and real CI, but they will be built and maintained by the same small team with the same audit discipline.

**The single risk worth naming:** this plan assumes the maintainership chooses to *ship* rather than to *perfect*. Every phase is independently shippable; a partial Phase 0 + Phase 1 is already a defensible release that fixes the two things most likely to make a evaluator close the tab. The plan is written so that doing something is better than doing everything perfectly.

---

*Plan basis: `HILBRAS-SDK-DEEP-CODEBASE-AUDIT.md` (§1–26), `docs/analysis/comparison.md`, live Vercel docs recon. No source code was modified. Target: `@hilbras/sdk` v2.2.0+ surpassing `ai@7` on zero-dependency governance, budget enforcement, and SSRF-safe registration, with framework-package parity by v2.0.0.*

---

---