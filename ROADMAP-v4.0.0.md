# v4.0.0 Implementation Plan

Derived from the deferred list, with every item measured against the code on
`main` at `c905078` rather than restated from the ledger. Where measurement
contradicted the ledger, the ledger is wrong and this plan says so.

Two items were reclassified after measurement. **DNS/egress SSRF controls** are
*mostly done* — the ledger implies they are outstanding, but `client.ts:390`
calls `validateBaseUrl` on every request and only the DNS-resolution hop is
missing. **Coverage** is not a single number to fix but a concentrated
deficit, and the largest contributor is nine zero-covered adapter files.

---

## Ordering

Ordered by (breaking-ness × security value) / effort, which puts the work that
can ship on a minor release first and defers what forces a major.

| # | Item | Impact | Effort | Release | State |
|---|------|--------|--------|---------|-------|
| 1 | Coverage: nine 0%-covered adapters | quality | M | 3.7.0 | **done** — `src/adapters` 67.9% → 76.0% |
| 2 | Coverage: `frameworks` at 25% | quality | M | 3.7.0 | open — 11 files still at 0% |
| 3 | `trustClientFields` default flip → `false` | breaking | S | 4.0.0 |
| 4 | Signature profile default flip → `v2` | breaking | S | 4.0.0 |
| 5 | Browser credential isolation | security | M | 4.0.0 |
| 6 | Agent runtime schema enforcement | security | M | 4.0.0 |
| 7 | DNS/egress SSRF (the missing hop only) | security | L | 4.0.0 |
| 8 | `node:crypto` → WebCrypto | blocking for edge/browser | L | 4.0.0 |
| — | Per-role budget attribution | feature | M | 4.1.0 |

Items 1–2 are minor-release work that needs no decision from you and should not
wait for the v4.0.0 discussion. Items 3–8 need one design decision each,
recorded below.

---

## Item 1 — Coverage: nine adapters at 0%

**Measured.** 20 files sit at 0% statements; nine are adapters —
`{cerebras,deepinfra,deepseek,fireworks,mistral,openai-compatible,perplexity,together,xai}.ts`.
`src/adapters` rolls up to 67.9% overall. The full list of 20 is in
`coverage/coverage-summary.json`; the rest are framework hooks and
`transport/websocket.ts`.

**Why it matters beyond the number.** Nine providers ship untested. Most are
`openai-compatible` shapes, so the leverage is high: one contract test against
the shared base class likely covers most of them.

**Approach.** Characterise first — read each file and classify it as either a
thin `openai-compatible` subclass (covered by a single shared contract test) or
genuinely distinct (needs its own). Do not write one test per file by default;
that produces 9 shallow files instead of 1 meaningful one.

**Guard.** `tools/mutation-adapters.sh` — 16 mutations, all killed, no holes.

**Done: 76.0%, short of the 80% target.** The remaining gap is the
`openai-compatible` file itself at partial coverage, not the eight subclasses —
they are fully covered through the shared contract. Whether to push the last
4% by covering SSE edge cases, or accept 76% and move on, is a judgement call;
item 2 has a larger deficit for the same effort.

**Three findings from this work.** Four of the first version's assumptions were
wrong and the tests caught them: `complete()` returns a plain string;
`stream()` reads `res.body` from `transport.request()`, not `transport.stream()`;
the tool-call field is `argumentsDelta`; and max_tokens degradation exists only
in `stream()`, not `complete()`, though the class docblock lists it as a
class-wide behaviour. That docblock is now wrong and is worth correcting.

Four defects in the mutation harness also surfaced, all fixed — a mutation aimed
at the wrong line, a `|` delimiter colliding with a regex alternation, a mutation
applied to a file the helper did not snapshot, and a shell-escaping bug that
turned a line continuation into a separate command.

---

## Item 2 — Coverage: `src/frameworks` at 25%

**Measured.** Worst directory by a wide margin, 25.0%. Contributors at 0%:
`qwik/stream-parser.ts`, `react/use-completion.ts`, `react/use-object.ts`,
`remix/hooks.ts`, `solid/stream-parser.ts`, `svelte/stream-parser.ts`,
`vue/stream-parser.ts`, `vue/use-completion.ts`, `vue/use-object.ts`. Plus
`utils/sse-writer.ts` at 33% and `utils/id.ts` at 42%.

**Approach.** `stream-parser.ts` exists in five frameworks — react, solid, vue,
svelte, qwik — and **verified by hash, the logic is byte-identical across all
five**: react/solid/qwik share one SHA-256 prefix (`1ed96778d121`), vue and
svelte differ only in a two-line header comment. Test once against the shared
contract, then add a structural guard asserting the five files stay identical
apart from their header. That converts four untested files into one test plus a
guard that fails if a copy drifts.

**Remaining at 0%:** `qwik|solid|svelte|vue/stream-parser.ts` (the four copies —
react's is now covered), `react/use-completion.ts`, `react/use-object.ts`,
`vue/use-completion.ts`, `vue/use-object.ts`, `remix/hooks.ts`.

**Done when.** `src/frameworks` ≥ 70% statements — not 80%, because this is the
lowest-risk surface and item 1 can carry the release.

---

## Item 3 — `trustClientFields` default flip

**Measured.** Two sites, `src/frameworks/nextjs/route-handlers.ts:77` and `:171`,
both `?? true`. Astro and Remix already default `false` (4 sites).

**Decision needed.** Flipping is breaking for any route relying on the body
overriding the model. Three options:

- **(a) Flip in 4.0.0.** Clean, matches the security intent, needs a migration
  note.
- **(b) Flip with a deprecation warning first** in 3.7.0 — warn on the request
  when the body supplied a field and the flag is unset. Costs a minor, buys
  users one release to find affected routes.
- **(c) Don't flip.** Keep `true` and rely on documented `onRequest`.

**Recommendation: (b).** The v3.4.0 pattern in this repo is exactly this — warn
in the minor, flip in the major — and it is observably working: the three
defaults are already split per family.

---

## Item 4 — Signature profile default → `v2`

**Measured.** `src/security/request-signer.ts:126`, `profile: config.profile ?? "v1"`.

**Dependency.** Must land *after* item 8. The v2 profile binds a body digest
computed with HMAC — if item 8 moves that to WebCrypto, doing item 4 first means
touching the same lines twice.

**Decision needed.** Same three options as item 3, and `v1` is frozen
byte-compatible (verified by 64 pre-existing hardening tests), so this is a
clean flip once the digest path is settled.

**Recommendation: with item 3, after item 8.**

---

## Item 5 — Browser credential isolation

**Measured.** `src/credentials/` is 256 lines across `oidc.ts` (214) and
`provider.ts` (42), at 78.9% coverage. No runtime measurement of leakage was
attempted — this item is scoped from reading, not from a failure.

**Problem.** `@hilbras/sdk/react-client` accepts a `config` that can hold an API
key, and that key is bundled into client JS. The 3.6.0 release documents this
in prose and carries `@warning` JSDoc. Prose is not a control.

**Approach.** Make the unsafe shape hard to reach rather than documented:
a `createBrowserClient()` entry that refuses a raw `apiKey` and requires an
explicit opt-in flag with a runtime warning, leaving `new HilbrasClient()`
unchanged for server use.

**Done when.** A browser-mode test asserts a raw key is rejected or loudly
warned, proven by mutation.

---

## Item 6 — Agent runtime schema enforcement

**Measured.** `src/features/agent/tool-loop.ts:278` calls
`tool.execute(tc.arguments, …)` with the model-supplied arguments parsed from
JSON. There is a **policy** check at `:226` (which tools are permitted) but no
**schema** check (whether the arguments match `tool.parameters`).

**Problem.** A model can emit `{}` for a tool requiring `{query: string}` and the
handler receives it. RBAC answers "may this tool run"; nothing answers "are
these arguments valid".

**Approach.** Validate arguments against the tool's `parameters` schema before
dispatch, with an opt-in strict mode. The SDK has no schema validator and must
not gain a dependency, so either a minimal JSON-Schema subset or a declared
per-tool validator function.

**Decision needed.** Minimal built-in subset vs. caller-supplied validators.
The subset cannot be complete; caller-supplied is more honest but leaves the
unsafe default.

---

## Item 7 — DNS/egress SSRF: the missing hop

**Measured, and the ledger is wrong here.** `src/security/url-guard.ts` exports
`validateResolvedAddress` (`:427`) and `validateUrlForTransport` (`:506`).
`validateBaseUrl` **is** wired — called at `src/client/client.ts:390`,
`src/config/config.ts:78`, `src/config/config-resolver.ts:134`,
`src/config/sources/environment.ts:107`, `src/realtime/index.ts:54` — with
`allowInsecureUrls` and `allowPrivateNetwork` gating.

What is missing: nothing resolves DNS. A hostname that passes validation can
still resolve to a private address (DNS rebinding), and redirects are not
re-checked. `validateResolvedAddress` is exercised only by tests.

**Approach.** Resolve before connecting, validate every resolved address, pin
the connection to the validated address, and re-validate each redirect hop.
This is the largest security item here and the hardest to get right.

**Decision needed.** Is this SDK's job, or the deployment's? A transport-level
pin is intrusive; a documented recommendation to pin at the edge is honest and
cheap. This is worth an explicit decision rather than an assumption.

---

## Item 8 — `node:crypto` → WebCrypto

**Measured.** `crypto.subtle` is used **0 times**. Two modules import
`node:crypto`:

- `src/security/request-signer.ts:37` — `createHmac`, `timingSafeEqual`
- `src/adapters/bedrock.ts:19` — `createHash`, `createHmac`

Both are re-exported from the root barrel (`src/index.ts:172`, `:245`).
Consequence, **verified by blocking `node:crypto` with a loader hook**:
`import "@hilbras/sdk"` throws. The package does not import in an edge runtime
or a browser bundle.

**Correction to an earlier claim.** I previously told you the SDK had no
`node:crypto` and ran on WebCrypto. That was wrong — inferred from absent
imports in the modules I happened to grep, and stated as verified fact. The
deferred list was right to keep this open; my characterisation of it was not.

**The obstacle.** WebCrypto `subtle` is async. `signer.sign()` is sync and
returns a string; Bedrock signs its AWS request inline. Both are load-bearing
public API.

**Options.**

- **(a) Async signature API.** `await signer.sign(...)`. Correct, but breaks
  every `signingMiddleware` consumer and `sign()` caller.
- **(b) Isolated subpath.** Move both behind a node-only export, make the root
  import them lazily. No signature change, but `import { RequestSigner } from
  "@hilbras/sdk"` becomes dynamic — a subtler break than (a).
- **(c) Hybrid.** Keep a sync `sign()` for Node, add `signAsync()` as the
  portable one, deprecate the sync form. Nothing breaks; the edge path exists;
  the deprecated form lingers.

**Recommendation: (c).** It is the only option that does not force every caller
to change while still delivering the portability. The cost is a permanently
deprecated API, which is cheaper than a broken upgrade.

---

## Item 9 — Per-role budget attribution (4.1.0)

**Measured.** `src/cost/tracker.ts` has no `userId` or `role` keying; RBAC
enforces `maxBudgetPerSession` separately. So spend is tracked globally while
limits are enforced per session — two sources of truth that can disagree.

**Approach.** Key the budget tracker by `(userId, role)` so spend and limit share
one record. Feature, not a fix: nothing is currently wrong, it is just coarse.

---

## Found while measuring: a flaky test

`tests/execution-pipeline-audit.test.ts:598` — *"10K routing decisions complete
within 30s"* — failed in 1 of 3 coverage runs and passed in the other 2, and
passes without instrumentation. It asserts wall-clock time
(`performance.now()` deltas under 30s), so v8 coverage instrumentation is enough
to push it over on a loaded machine.

This is not a code defect and not a flaky *assertion* — it is a performance
assertion in a suite that also runs with coverage. Either it should be excluded
from coverage runs, or the budget widened, or it replaced with a relative
benchmark. Left unchanged here because changing it inside a planning document
would hide it; it is recorded so the next session does not rediscover it as a
new failure.

## What I did not plan, and why

**Published-package verification cadence.** It has twice surfaced defects the
repo tests missed (three in the 3.4.x patch series) and once surfaced nothing.
That is a real but low-rate signal. Worth a pre-release checklist item rather
than a project.

**The `archive/` documents.** Retired, indexed, and accurate. No further work.

---

## Recommendation

Ship items 1–2 as **3.7.0** now — no decision required, closes the largest
measured gap, and needs nothing from items 3–8.

For 4.0.0, items 3 and 4 are small and well-understood once item 8 settles.
Item 8 is the critical path and needs your decision between (a), (b) and (c)
— I recommend (c). Item 7 deserves its own conversation about whether DNS
pinning belongs in an SDK at all.

**Do not batch these.** Each is independently releasable, and 4.0.0 is where
six breaking changes arriving at once would be least reviewable.