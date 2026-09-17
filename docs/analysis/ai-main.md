# ai-main (Vercel AI SDK) — Deep Analysis

**Path:** `/run/media/gin/01DD24D06510A4D0/work/repo/ai-main`
**License:** Apache-2.0 (root) · MIT (only `tools/tsconfig`, private, never published)
**Stack:** pnpm 10.33.4 + Turborepo · TypeScript 5.8.3 · Vitest 4.1.6 · oxlint + ultracite + custom oxlint plugin · changesets for versioning · Kodiak for auto-merge
**Date of scan:** 2026-08-27

---

## Executive summary

The Vercel AI SDK is a mature, very large pnpm + Turborepo monorepo of ~80 published packages, 25 example apps, and one documentation site (`apps/docs`). It uses a layered provider architecture (specifications → utilities → providers → core → UI/harnesses), is governed by Apache-2.0, and is in active maintenance. The codebase has a strict conventions regime (custom `konsistent` shape validator + `ai-sdk/require-validate-url` oxlint rule), a heavy CI matrix, and 514 MDX docs. The surface is sprawling: many experimental harnesses/sandboxes that depend on third-party SDKs via deeply-nested `src/bridge/package.json` subprojects, ~83 `TODO` markers (most pinned to a future v8 removal), and monolithic per-package entry points (`stream-text.ts` 2941 lines, `generate-text.ts` 1918 lines, `openai-responses-language-model.ts` 2933 lines) that hint at deferred internal decomposition.

## Project facts

- **Repo type:** pnpm + Turborepo monorepo
- **Published packages:** ~80 (all Apache-2.0, all `provenance: true`)
- **Example apps:** 25 (all `@example/*`, all `private`)
- **Apps:** 1 (`apps/docs` — the ai-sdk.dev documentation site)
- **Node engines:** root `^22 || ^24 || ^26`; per-package `>=22`
- **Package manager:** pnpm 10.33.4
- **CI matrix:** Linux Node 22/24/26 + Windows for `@ai-sdk/mcp` + dedicated matrices for `ai` and `codemod`
- **Lockfile:** `pnpm-lock.yaml` v9.0 committed (1.8 MB)
- **Install scripts:** zero (`grep hasInstallScript pnpm-lock.yaml` returns 0)
- **Pre-commit:** `pnpm install` if package.json changes, then `ultracite` via `lint-staged` (`ARTISANAL_MODE=1` bypass)

## Workspace structure

| Path | Type | Purpose |
| --- | --- | --- |
| `apps/` | Apps (runnable) | Only `apps/docs` — the ai-sdk.dev site (Next.js 16 + Fumadocs + Geistdocs). |
| `packages/` | Libraries | 75+ published packages: `ai` core, `@ai-sdk/provider`, 50+ provider/UI/harness/sandbox adapters. |
| `tools/` | Internal tooling | `tsconfig` presets, `konsistent-provider`, `oxlint-plugin-ai-sdk`, `analyze-downloads`, `generate-llms-txt`, `memory-benchmark`, `validate-properties-tables.mjs`, `split-ts-references.mjs`, `verify-harness-adapter-deps.mjs`, `worktree-setup.sh`, `run-harness-agent-examples.sh`. |
| `examples/` | Examples | 25 consumer apps (`@example/*`, all `private`): `ai-functions`, `next`, `nuxt`, `sveltekit`, `angular`, `mcp`, `nest`, `hono`, `fastify`, `express`, `node-http-server`, `next-agent`, `next-workflow`, etc. |
| `skills/` | Developer tooling | 12 `SKILL.md` files for coding-agent workflows (see below). |
| `architecture/` | Documentation | 6 narrative design docs (provider-abstraction, harness-abstraction, sandbox-abstraction, message-layers, file-uploads, stream-text-loop-control). |
| `content/` | Documentation source (MDX) | `docs/` (10 sections incl. migration guides), `providers/` (44 first-party + 2 community provider doc files), `cookbook/`, `tools-registry/`. 514 MDX/MD files. |
| `contributing/` | Contributor docs | 19 guides (ADRs, decisions, naming, packages, providers, releases, secure-url, testing, zod, etc.). |
| `assets/` | Static assets | One file: `hero.gif` (1.1 MB, 2166×546, used in package READMEs). |
| `.github/` | CI + scripts | 12 workflow files, 3 helper scripts. |
| `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `.husky/`, `.vscode/` | Per-agent/IDE config | Each has hooks/JSON; `.codex` and `.claude` have `PostToolUse`/`afterFileEdit` hooks running `pnpm fix`. |

`pnpm-workspace.yaml` lists 5 glob families plus a one-off `packages/rsc/tests/e2e/next-server`; it sets `minimumReleaseAge: 4320` (3 days) and exempts first-party `@ai-sdk/*`, `ai`, and `@vercel/geistdocs`.

`README.md` is a symlink to `packages/ai/README.md` and `CLAUDE.md` is a symlink to `AGENTS.md` — these are deliberate, not stale.

## Package inventory

75 packages (all `private: false` except `tools/tsconfig`, which is `private: true`). All are Apache-2.0, ESM, `sideEffects: false`, tsup-built.

### Core (spec + utilities + main SDK)

- **`@ai-sdk/provider` v4.0.7** — Spec interfaces (`LanguageModelV4`, `EmbeddingModelV4`, `ImageModelV4`, `SpeechModelV4`, `TranscriptionModelV4`, `VideoModelV4`, `SkillsV4`, `FilesV4`, `RerankingModelV4`, `SpeechTranslationModelV4`, `RealtimeFactoryV4`). Runtime dep: `json-schema`. Zero non-workspace runtime deps.
- **`@ai-sdk/provider-utils` v5.0.29** — Shared helpers (`getFromApi`, `createJsonResponseHandler`, `parseJSON`/`safeParseJSON`, `postJsonToApi`, `eventsource-parser`, `undici`, `@standard-schema/spec`, `@workflow/serde`). Peer: `zod`.
- **`ai` v7.0.77** — Main SDK. Public exports: `.`, `./internal`, `./test`. 30 top-level subdirs in `src/`: `agent`, `batch`, `embed`, `error`, `generate-image`, `generate-object`, `generate-speech`, `generate-text`, `generate-video`, `logger`, `middleware`, `model`, `prompt`, `realtime`, `registry`, `rerank`, `telemetry`, `test`, `text-stream`, `transcribe`, `translate`, `types`, `ui`, `ui-message-stream`, `upload-file`, `upload-skill`, `util`. Has `prepack`/`postpack` to vendor `content/docs` into the npm tarball.

### Provider implementations (model APIs)

40 first-party `@ai-sdk/<provider>` packages, mostly using the same template (`tsup` + `vitest.node`/`vitest.edge` configs, `prepack` copying the `content/providers/...mdx` doc, peer dep `zod`).

Major: `@ai-sdk/openai` 4.0.46, `@ai-sdk/anthropic` 4.0.41, `@ai-sdk/google` 4.0.50, `@ai-sdk/google-vertex` 5.0.61, `@ai-sdk/amazon-bedrock` 5.0.61, `@ai-sdk/azure` 4.0.48, `@ai-sdk/anthropic-aws` 2.0.33, `@ai-sdk/mistral` 4.0.32, `@ai-sdk/cohere` 4.0.29, `@ai-sdk/groq` 4.0.30, `@ai-sdk/xai` 4.0.43, `@ai-sdk/deepseek` 3.0.31, `@ai-sdk/perplexity` 4.0.31, `@ai-sdk/fireworks` 3.0.38, `@ai-sdk/togetherai` 3.0.36, `@ai-sdk/huggingface` 2.0.35, `@ai-sdk/openai-compatible` 3.0.35, `@ai-sdk/open-responses` 2.0.30, `@ai-sdk/alibaba` 2.0.34.

Media/transcription/speech: `@ai-sdk/elevenlabs`, `@ai-sdk/fal`, `@ai-sdk/lmnt`, `@ai-sdk/hume`, `@ai-sdk/revai`, `@ai-sdk/deepgram`, `@ai-sdk/cartesia`, `@ai-sdk/gladia`, `@ai-sdk/assemblyai`, `@ai-sdk/luma`, `@ai-sdk/klingai`, `@ai-sdk/fish-audio`, `@ai-sdk/replicate`, `@ai-sdk/prodia`, `@ai-sdk/voyage`, `@ai-sdk/baseten`, `@ai-sdk/cerebras`, `@ai-sdk/deepinfra`, `@ai-sdk/bytedance`, `@ai-sdk/gmicloud`, `@ai-sdk/moonshotai`, `@ai-sdk/minimax`, `@ai-sdk/quiverai`, `@ai-sdk/black-forest-labs`.

Special: `@ai-sdk/gateway` 4.0.62 — uses `@vercel/oidc` 3.2.0; pulls provider model lists via a `generate-model-settings` script.

### UI framework bindings

- **`@ai-sdk/react` 4.0.80** — peer React `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`. Deps: `swr`, `throttleit`, `ai`, `@ai-sdk/mcp`, `@ai-sdk/provider`, `@ai-sdk/provider-utils`.
- **`@ai-sdk/vue` 4.0.77** — adds `swrv`.
- **`@ai-sdk/svelte` 5.0.77** — uses `svelte-package` (not tsup), `vitest-setup-client.ts`; only package without `tsup.config.ts` (explicitly whitelisted in `.github/konsistent.json`).
- **`@ai-sdk/angular` 3.0.77**.
- **`@ai-sdk/rsc` 3.0.77** — has dual exports (`react-server`, client `import`). Has e2e via Playwright. Dep `jsondiffpatch` 0.7.3.

### Harness / sandbox system (newer "agent" architecture)

- **`@ai-sdk/harness` 1.0.85** — spec/runtime: `HarnessAgent`, `HarnessV1` interface, `HarnessV1SandboxProvider`, `HarnessV1NetworkSandboxSession`. Exports `.`, `./agent`, `./utils`, `./bridge`. Optional peer `ws`. Internal `v1/` subdir is the canonical harness spec.
- 8 first-party harness adapters: `@ai-sdk/harness-claude-code` 1.0.88, `@ai-sdk/harness-codex` 1.0.87, `@ai-sdk/harness-deepagents` 1.0.85, `@ai-sdk/harness-opencode` 1.0.86, `@ai-sdk/harness-pi` 1.0.87, `@ai-sdk/harness-grok-build` 1.0.22, `@ai-sdk/harness-cline` 1.0.12, `@ai-sdk/harness-acp` 1.0.23. Several carry a **nested `src/bridge/package.json`** with third-party SDKs (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@langchain/langgraph`, `@opencode-ai/sdk`, `@cline/agents`, `@xai-official/grok`, `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, `pi-mcp-adapter`, `@earendil-works/pi-coding-agent`).
- 2 sandbox providers: `@ai-sdk/sandbox-just-bash` 1.0.85 (dep `just-bash`), `@ai-sdk/sandbox-vercel` 1.0.85 (dep `@vercel/sandbox` ^2.0.1).
- **`@ai-sdk/workflow-harness` 1.0.85** — bridges `HarnessV1` to the workflow package.
- **`@ai-sdk/code-mode` 1.0.34** — QuickJS-backed code-execution tool (dep `run`).

### Other libraries

- `@ai-sdk/mcp` 2.0.36 — Model Context Protocol client; exports `.` and `./mcp-stdio`; deps `cross-spawn`, `pkce-challenge`.
- `@ai-sdk/workflow` 2.0.7 — `WorkflowAgent`; dep `ajv` 8.20.
- `@ai-sdk/otel` 1.0.77 — OpenTelemetry bridge; dep `@opentelemetry/api` 1.9.1.
- `@ai-sdk/policy-opa` 1.0.77.
- `@ai-sdk/tui` 1.0.78 — "Run AI SDK agents in a terminal UI."
- `@ai-sdk/devtools` 1.0.12 — runtime UI bridge (uses Hono, `@hono/node-server`).
- `@ai-sdk/valibot` 3.0.29 — Valibot-to-JSON-Schema adapter.
- `@ai-sdk/codemod` 4.0.0 — CLI published as `codemod` bin, uses `jscodeshift`, `commander`, `cli-progress`, `debug`.
- `@ai-sdk/test-server` 2.0.1 — MSW-based test helpers (not published, used as a workspace test util; dep `msw` 2.14.6).
- `@ai-sdk/langchain` 3.0.77, `@ai-sdk/llamaindex` 3.0.77 — framework adapters.

### Tools (non-published)

`tools/tsconfig` (`@vercel/ai-tsconfig`), `tools/konsistent-provider` (v0.0.2, exports `./konsistent` conventions JSON), `tools/oxlint-plugin-ai-sdk` (implements the `ai-sdk/require-validate-url` rule), `tools/analyze-downloads`, `tools/generate-llms-txt`, `tools/memory-benchmark` (CLI `ai-sdk-memory-benchmark`).

## Build, test, and CI

### Orchestration

- **Root `package.json`** (`private: true`, name `ai-repo`). Scripts: `build` (`turbo build --concurrency 16`), `build:examples`, `build:packages`, `dev` (`turbo dev`), `test` (filters out `@example/*`), `test:ci` (further filters out `ai` and `@ai-sdk/codemod`, uses `--only`), `test:update`, `type-check` (`tsc --build`), `type-check:full`, `check` (`ultracite check`), `fix` (`ultracite fix`), `publint`, `changeset`, `konsistent` (custom), `ci:version` (changeset version + `cleanup-examples-changesets.mjs` + `pnpm install --no-frozen-lockfile`), `ci:release`, `worktree:setup`, `benchmark:memory`, `update-references` (`update-ts-references` + `tools/split-ts-references.mjs`), `validate:docs` (`tools/validate-properties-tables.mjs`).
- **Turborepo** is the build orchestrator (`turbo.json:1`). `build` declares ~50 env vars it should be hashable on (basically all the provider API keys + `VERCEL_*` + `SENTRY_*`). `dev` is `cache: false, persistent: true`. Type-check and tests depend on `^build` (transitive build).
- **Linter**: `oxlint` 1.56.0 with a custom plugin at `tools/oxlint-plugin-ai-sdk/index.mjs` and ultracite 7.3.2 config presets. Custom rule: `ai-sdk/require-validate-url` is set to `error` and forces every `getFromApi(...)` call site to have an inline `validateUrl`.
- **Formatter**: `oxfmt` 0.41.0.
- **TypeScript**: 5.8.3 root, 5.9.3 in `apps/docs`. Root `tsconfig.json` lists explicit project references for all 80 packages (also a manual sync invariant — see `update-references` script).
- **Test runner**: Vitest 4.1.6. Per-package configs: 75 `tsup.config.ts`, 70 `vitest.node.config.js`, 55 `vitest.edge.config.js`. Edge config uses `@vercel/edge-runtime`; 26 packages have only an edge variant.
- **Pre-commit hook** (`.husky/pre-commit`): runs `pnpm install` if any `package.json` is staged, then `pnpm lint-staged` (ultracite). Bypass via `ARTISAL_MODE=1`.
- **Changesets**: 2.27.10, configured in `.changeset/config.json` (baseBranch `main`, `updateInternalDependencies: patch`, `access: public`). `verify-changesets.yml` enforces that only `patch` is used unless a `minor`/`major` label is set. Per-package CHANGELOG.md is auto-generated.

### CI (`.github/workflows/`)

- `ci.yml` — master pipeline: `check`, `konsistent`, `build-examples` (4-way matrix), `types`, `docs-site` (12 GB swap for memory-fragile build), `build-packages` (uploads dist tarballs), `bundle-size` (450 KiB limit), `test_node_versions` (dynamic 22/24/26), `test_matrix` (runs `pnpm test:ci`), `test_mcp_windows`, `test_rsc_e2e` (Playwright + sudo + apt-lock wait), `test_ai_matrix` (3 × 4 shards), `test_codemod_matrix` (3 × 4), `load-time_matrix` (105/75/70/70/70 ms thresholds on `ai`, `openai`, `openai-compatible`, `anthropic`, `google`), test + load-time aggregators.
- `release.yml` — only on `main`/`release-v*`; `vercel/ai`-only guard; OIDC for npm provenance.
- `verify-changesets.yml` — gated changeset validator.
- `backport.yml`, `auto-merge-release-prs.yml`, `reconcile-merge-labels.yml`, `assign-team-pull-request.yml`, `slack-team-review-notification.yml`, `slack-workflow-failure-notification.yml`, `ai-provider-api-changes.yml`, `ai-provider-models.yml`, `update-model-settings.yml`.

Kodiak (`.kodiak.toml`) is the auto-merge bot: squash, `delete_branch_on_merge: true`, requires `automerge` label.

## Dependencies

- **Lockfile:** `pnpm-lock.yaml` committed (1.8 MB, lockfileVersion 9.0).
- **Root overrides:** `tinyexec: 1.0.2`, `oxlint: 1.56.0`, `tar: 7.5.19` — all security-pinned.
- **`minimumReleaseAge: 4320`** (3 days) with exemptions for `@ai-sdk/*`, `ai`, `@vercel/geistdocs`.
- **`.npmrc`:** `auto-install-peers`, `link-workspace-packages`, public-hoist for `*eslint*` and `*prettier*`.
- **No install scripts** — `grep hasInstallScript pnpm-lock.yaml` returns 0.
- **Runtime dep posture** — core is mostly zero-deps (`@ai-sdk/provider` has only `json-schema`; `@ai-sdk/provider-utils` has 4: `undici`, `eventsource-parser`, `@standard-schema/spec`, `@workflow/serde`). Provider packages have 2 (spec + utils) plus 1–2 SDK-specific deps (`@smithy/eventstream-codec`, `google-auth-library`, `@vercel/oidc`, `aws4fetch`). UI bindings add framework libs. Harness adapters carry nested `src/bridge/package.json` with heavy third-party SDKs.
- **Dev deps** — pinned to exact versions in core packages. `typescript: 5.8.3`, `zod: 3.25.76`, `tsup: ^8.5.1`, `react: 19.0.0-rc-...` in root, `@types/node: 22.19.19`.
- **No `*`/`latest`** version pins in any `packages/*/package.json`.

## Documentation

- **`README.md`** is a symlink to `packages/ai/README.md`. Landing page with unified-provider-architecture pitch, install snippet, "Skill for Coding Agents" call-out (`npx skills add vercel/ai`).
- **`AGENTS.md`** (321 lines) — cross-agent guide. Heavy, opinionated, machine-actionable. Documents provider pattern, layer dependencies (`ai ─▶ provider-utils ─▶ provider`), Zod 3 vs 4 import rules, `AISDKError` marker pattern, `validateUrl` policy, ADR process, "Do Not" list.
- **`CLAUDE.md`** is a symlink to `AGENTS.md`.
- **`CONTRIBUTING.md`** (10 KB) — human-focused and unusually long: explicitly states maintenance is increasingly automated and asks for "high-quality issue rather than a complete pull request" (line 7-8). PR title format `fix|feat|chore(package): description`. Mandates signed commits.
- **`CODE_OF_CONDUCT.md`** — one-liner pointing to live Vercel community guidelines.
- **`packages/ai/AGENTS.md`** exists (76 lines) — usage-focused AI SDK walkthrough.
- **`architecture/`** — 6 narrative design docs.
- **Per-package `README.md`** — 75/76 packages have one. Short install/usage cards with the "Skill for Coding Agents" call-out and a Vercel AI Gateway upsell.
- **`CHANGELOG.md`** at root is a table of contents; per-package `CHANGELOG.md` (76) has the real entries (auto-generated by changesets).
- **`content/`** — 514 MDX files. Structure: `docs/{00-introduction, 02-foundations, 02-getting-started, 03-agents, 03-ai-sdk-core, 03-ai-sdk-harnesses, 04-ai-sdk-ui, 05-ai-sdk-rsc, 06-advanced, 07-reference, 08-migration-guides, 09-troubleshooting}`, `providers/{01-ai-sdk-providers, 02-ai-sdk-harnesses, 03-observability, 04-openai-compatible-providers, 05-community-providers, 06-adapters}`, `cookbook/{00-guides, 01-next, 05-node, 15-api-servers, 20-rsc}`, `tools-registry/registry.ts`.
- **Tools registry** — `content/tools-registry/registry.ts` is a typed array of partner-tool metadata imported by the docs app.

## Code organization

### Deep dive 1 — `packages/ai` (the core SDK)

- **Shape:** 30 subdirs under `src/`, all exported as barrel `index.ts`. Top dirs listed above.
- **Entry point** (`packages/ai/src/index.ts:1-59`) is a thin re-export — the public surface is the union of all 27 subdirs plus `tool`, `jsonSchema`, `zodSchema`, `dynamicTool`, `createIdGenerator` from `provider-utils`, and `createGateway`/`gateway` from `@ai-sdk/gateway`. Re-exports `Experimental_SandboxSession`, `Experimental_SandboxProcess`, `Experimental_ToolCallerTool`, `InferSchema`, etc.
- **Big files:**
  - `generate-text/stream-text.ts` — 2941 lines.
  - `generate-text/stream-text.test.ts` — 30 235 lines (largest test file in the repo).
  - `generate-text/generate-text.ts` — 1918 lines, 13 419-line test.
  - `generate-text/stream-language-model-call.ts` — 850 lines.
  - `generate-text/stream-text-result.ts` — 602 lines.
  - `agent/tool-loop-agent.test.ts` — 4245 lines.
- **Tests:** 152 test files + 18 type-test files in `src/`. Test files are colocated. 21 of the subdirs have `__snapshots__`; 2 have `__fixtures__`. Total package size 6.3 MB on disk; ~338 non-test `.ts` source files.
- **Middleware** (`packages/ai/src/middleware/`): 11 self-contained composables (`wrap-language-model`, `wrap-embedding-model`, `wrap-image-model`, `wrap-provider`, `default-settings-middleware`, `default-instructions-middleware`, `default-embedding-settings-middleware`, `extract-json-middleware`, `extract-reasoning-middleware`, `simulate-streaming-middleware`, `add-tool-input-examples-middleware`). Each has a paired test. 7027 total lines.
- **Error module** — small directory of 11 typed error classes, each extending `AISDKError` with the marker-symbol pattern documented in `AGENTS.md:178-194`.
- **Internal & test subpath exports** — `./internal` and `./test` entries exist in `exports` (`packages/ai/package.json:47-57`). These are not under `dist/internal/`; `internal.d.ts` and `test.d.ts` are wrapper files at the package root.
- **Prepack/postpack** — copies `content/docs/` into a `docs/` folder and ships it in the npm tarball.
- **Verdict:** It is a **deep module** at the top level (one barrel, one installable name) but the implementation files are grab-bags — `stream-text.ts` and `generate-text.ts` are 2–3k-line orchestrators with many responsibilities.

### Deep dive 2 — `packages/openai` (representative provider)

- **Shape:** 14 subdirs under `src/` (`chat`, `completion`, `embedding`, `files`, `image`, `realtime`, `responses`, `skills`, `speech`, `speech-translation`, `tool`, `transcription`) plus top-level provider/error/config/types. `index.ts` exports `.` and `./internal`.
- **Provider factory** (`packages/openai/src/openai-provider.ts`) imports 9 different language-model classes; the default `openai('model-id')` returns a `OpenAIResponsesLanguageModel`, with `.chat()` and `.completion()` for the legacy APIs. Header helper `withUserAgentSuffix` from `provider-utils` is mandatory.
- **Big file:** `responses/openai-responses-language-model.ts` is **2933 lines**. It implements `LanguageModelV4` directly and handles tools, streaming, batching, computer use, file search, image generation, MCP, shell, web search, code interpreter, programmatic tool calling, apply-patch. Adjacent file `responses/openai-responses-api.ts` carries the wire types and `__fixtures__` are real captured JSON.
- **Tests:** 26 `.test.ts` files + 5 `.test-d.ts` files. Tests use `describeVercel` / capture-and-replay pattern. Tool modules have `*.test-d.ts` because the type surface is the public contract.
- **Subdir tool/:** `apply-patch.ts`, `code-interpreter.ts`, `computer.ts`, `custom.ts`, `file-search.ts`, `image-generation.ts`, `local-shell.ts`, `mcp.ts`, `programmatic-tool-calling.ts`, `shell.ts`, `tool-search.ts`, `web-search-preview.ts`, `web-search.ts` — one file per tool. Schemas are co-located.
- **Real-time:** `realtime/` has the WS-driven model.
- **Verdict:** **Best-organized package in the repo.** Deep module per subdir (e.g. `responses/` is one feature), narrow public API, real fixtures, no monolithic entry.

### Deep dive 3 — `packages/harness` (the experimental harness spec)

- **Shape:** 4 subdirs under `src/` — `agent/`, `bridge/`, `utils/`, `errors/`, plus `v1/` (the spec). 66 non-test `.ts` source files, 37 test files.
- **Spec** (`packages/harness/src/v1/`): 24 files. `harness-v1.ts` (94 lines) is the typed interface — `specificationVersion: 'harness-v1'`, `harnessId`, `builtinTools`, `supportsBuiltinToolApprovals`, etc. Modelled on `LanguageModelV4`. Each spec file has paired `*.test-d.ts`.
- **Agent** (`packages/harness/src/agent/`): 8 source files. `harness-agent.ts` orchestrates `HarnessAgent`; the rest handle bootstrap, sandbox prep, tool-result continuation, tool-approval continuation, error classification, settings, session, types.
- **Bridge** (`packages/harness/src/bridge/`): 3 source files + 2 integration tests. `index.ts` is the bridge transport; `reconnect.integration.test.ts`, `disk-replay.integration.test.ts` exist.
- **Utils** (`packages/harness/src/utils/`): 16 files, including `ai-gateway-auth.ts`, `sandbox-channel.ts`, `sandbox-credential-brokering.ts`, `sandbox-home-dir.ts`, `write-skills.ts`, `classify-disk-log.ts`, `bridge-ready.ts`, `bridge-user-message-submitter.ts`, `resolve-sandbox-default-working-directory.ts`, `get-restricted-sandbox-session.ts`, `shell-quote.ts`, `bridge-diagnostics.ts`. Most have paired tests.
- **Errors** (`packages/harness/src/errors/`): 3 error classes, each with paired test.
- **Package surface** (`packages/harness/package.json:33-55`): 4 subpath exports — `.`, `./agent`, `./utils`, `./bridge`.
- **Verdict:** **Best-architected experimental package** — narrowly-scoped `v1/` spec, paired implementation/test for every spec file, internal subpath boundaries, well-named utility files.

## Skills & agents layer

`skills/` contains 12 `SKILL.md` files (each with frontmatter):

- `add-function-examples` — how to add examples under `examples/ai-functions/`.
- `add-harness-package` — how to add a `@ai-sdk/harness-*` adapter.
- `add-provider-package` — how to add a `@ai-sdk/<provider>` (with reference PR link).
- `adr-skill` — proposes/creates ADRs.
- `capture-api-response-test-fixture` — generates fixture files for provider tests.
- `develop-ai-functions-example` — runs the `examples/ai-functions/` workflow.
- `list-npm-package-content` — inspects npm tarball contents.
- `major-version-mode` — operations for cutting a new major.
- `migrate-ai-sdk-v6-to-v7` — the v6→v7 migration.
- `update-harness-dependencies` — `verify-harness-adapter-deps.mjs`-driven dependency update.
- `update-provider-models` — pulls latest provider model lists.
- `use-ai-sdk` — default consumer-facing skill (shipped to `npx skills add vercel/ai`).

These are **developer/agent tooling, not runtime.** Skills are also referenced (and mirrored as hooks) in `.claude/skills/`, `.codex/`, and `.cursor/` directories.

## Architecture documentation

`architecture/` contains 6 narrative design docs (each cross-linked from the harness/sandbox ADRs and the AGENTS.md):

- `provider-abstraction.md` — overview of `LanguageModelV4`/`EmbeddingModelV4`/`ImageModelV4` with mermaid class diagrams; explains `reasoning` parameter handling and the `isCustomReasoning` helper, the rule-of-3 for abstractions, and the two mapping strategies.
- `harness-abstraction.md` — full writeup of `HarnessAgent` ↔ `HarnessV1` ↔ `HarnessV1SandboxProvider` ↔ `HarnessV1NetworkSandboxSession`, host-driven vs bridge-backed runtimes, lifecycle/resume semantics, filesystem boundary rules, auth (`trustedOrigin`/`credentialedOrigin`).
- `sandbox-abstraction.md` — sandbox provider/session contracts.
- `message-layers.md` — UI message vs model message vs assistant message.
- `file-uploads.md` — file upload flow.
- `stream-text-loop-control.md` — internal loop semantics of `streamText`.

ADRs themselves live in `contributing/decisions/`. The directory has only 2 files: `README.md` and `2026-03-11-adopt-architecture-decision-records.md`. ADRs are a brand-new, just-adopted process; most architectural rationale is in `architecture/*.md` and `contributing/project-philosophies.md`.

`contributing/project-philosophies.md` is a comprehensive, opinionated manifesto: rule of 3 for abstractions, mandatory `Experimental_` prefix for uncommitted types, conservative API surface, "build with developers and agents in mind."

## Maintenance signals

- **Git history:** the snapshot has no `.git` directory; `git log` fails. All files share `mtime 2025-08-22 10:51` (epoch 1787377905), suggesting a fresh tarball export. **Cannot infer true last-commit dates from this snapshot.**
- **CHANGELOG freshness:** `packages/ai/CHANGELOG.md` shows 7.0.77 as the top entry. The whole monorepo's `ai` package is on `7.x`, while `@ai-sdk/openai` is `4.0.46`, `@ai-sdk/anthropic` `4.0.41`, `@ai-sdk/provider` `4.0.7`, `@ai-sdk/provider-utils` `5.0.29`. Version skew is large but intentional (independent semver).
- **TODO/FIXME/HACK/XXX sweep:** 83 hits in `packages/`, `apps/`. Selected:
  - `packages/openai/src/openai-config.ts` — `TODO: remove in v8`
  - `packages/openai/src/openai-provider.ts` — `Soft-deprecated. TODO: remove in v8`
  - `packages/openai/src/responses/openai-responses-language-model-options.ts` — `TODO AI SDK 6: use optional here instead of nullish` (stale; SDK is already on 7)
  - `packages/openai/src/chat/openai-chat-language-model.ts` — `TODO AI SDK 6: remove, we auto-map maxOutputTokens now`
  - `packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts` — `// TODO we lost type safety on Chunk, most likely due to the error schema. MUST FIX`
  - `packages/openai/src/responses/convert-to-openai-responses-input.ts` — `TODO: remove in v8`
  - `packages/ai/src/prompt/convert-to-language-model-prompt.ts` — `TODO: remove in v8 when "file-id" and "image-file-id" types are removed`
  - `packages/ai/src/model/as-embedding-model-v3.ts` / `as-speech-model-v3.ts` — `TODO this could break, we need to properly map v2 to v3`
  - `packages/rsc/src/stream-ui/stream-ui.tsx` — `TODO: Remove these errors after the experimental phase.`
  - `packages/workflow/src/stream-text-iterator.ts` — `TODO(#12164): replace this AI-core telemetry bridge with a…`
  - `packages/vue/src/chat.vue.ui.test.tsx` — `TODO bug? the user message does not show up`
  - `packages/ai/index.ts` — `TODO remove once we can set the source folder in tsconfig.json to src/`
  - `packages/open-responses/src/responses/open-responses-language-model.ts` — `TODO AI SDK 7 adjust reasoning in the specification…`
  - `packages/harness-pi/src/pi-session.ts` — `TODO(pi-0.77): verify the race still exists`
- **Orphans/oddities:** `packages/ai/index.ts` is in the **root of `packages/ai/`**, not under `src/` (it re-exports from `src/`). All other packages put `index.ts` under `src/`. `packages/ai/CHANGELOG.md` is at the package root (auto-generated by changesets).
- **Tests-as-code reality check:** `packages/ai/src/generate-text/stream-text.test.ts` is 30 235 lines — these are not stubs, they're full integration-style tests of every code path. `packages/ai/src/agent/tool-loop-agent.test.ts` 4245 lines. Provider packages have real `__fixtures__` directories (21 of them) of captured API responses.

## Licensing

- **Root license:** Apache-2.0 (`LICENSE` is the standard Apache 2.0 boilerplate, copyright Vercel Inc. 2023).
- **All packages:** declare `"license": "Apache-2.0"` in `package.json` (consistent).
- **One exception:** `tools/tsconfig/package.json` declares `"license": "MIT"`. It's private, `version: 0.0.0`, and only used as `@vercel/ai-tsconfig` workspace preset. The Apache/MIT mismatch is cosmetic and not in a published artifact.
- **No `NOTICE` file, no `LICENSES/` directory.** Acceptable for pnpm/npm monorepos; third-party attribution is generated at publish time via `publishConfig.provenance: true` (npm sigstore signing).
- **No per-package `LICENSE` file** (only the root has one). Apache 2.0 + per-package NPM `license: "Apache-2.0"` is sufficient.
- **No copyright headers** in source files (standard for Apache-2.0).

## Defect inventory (severity-sorted)

### P0 — Critical

**No findings.** The repo is well-instrumented: lockfile committed, no install scripts, OSSF-friendly settings, signed commits required, OSSF Scorecard would likely score well. CI covers the build/test surface area.

### P1 — Significant (3 findings)

- **F-01: `getAvailableModels()` cache returns stale `pendingMetadata` after refresh window.** `packages/gateway/src/gateway-provider.ts:429-453`. `lastFetchTime` is set to `now` before the fetch resolves; on failed fetch the catch path does not reset `lastFetchTime` and does not clear `pendingMetadata`. Under upstream flakiness the gateway will hammer the metadata endpoint and amplify outages. Fix: on error, clear `pendingMetadata` and `lastFetchTime`.
- **F-02: MCP stdio transport is not addressable through the public transport config.** `packages/mcp/src/tool/mcp-transport.ts:109-194` (config type & factory) and `packages/mcp/src/tool/mcp-stdio/index.ts:1-4`. `MCPTransportConfig.type` is `'sse' | 'http'`. The stdio transport exists but the only way to use it is to import it directly. Fix: add `'stdio'` to `MCPTransportConfig` and re-export from `packages/mcp/src/index.ts`.
- **F-03: Stdio MCP env forwarding is wider than necessary, and a default-on Windows surface.** `packages/mcp/src/tool/mcp-stdio/get-environment.ts:7-43`. `DEFAULT_INHERITED_ENV_VARS` on Windows is 11 entries; on POSIX is 6. User-supplied `env: { PATH: '/tmp' }` is overwritten by the inherited `PATH` (line 39). Fix: default to `{}` and require the caller to opt in to broader inheritance.

### P2 — Notable (15 findings)

- **F-04** `mcp_approval_request` → `mcp_call` mapping uses a generated dummy ID. `packages/openai/src/responses/openai-responses-language-model.ts:1132-1152` and `2189-2199`.
- **F-05** `toolsContext as unknown as InferToolSetContext<...>` is a footgun. `packages/ai/src/generate-text/stream-text.ts:2011-2014` and `generate-text.ts:930`.
- **F-06** `maskSandboxCredentials` only masks the variable name, not the value. `packages/harness/src/utils/sandbox-credential-brokering.ts:9-23`. Masked value is the name; the function's name promises redaction.
- **F-07** `cleanupAfterStartFailure` swallows the inner stop error. `packages/harness/src/agent/harness-agent.ts:955-963`.
- **F-10** `stream-text.ts` is a 2,941-line orchestrator with 150+ imports. `packages/ai/src/generate-text/stream-text.ts`. Single file couples telemetry, prompt prep, retry, timeout, output parsing, and stream-stitching.
- **F-11** `openai-responses-language-model.ts` is 2,933 lines and dispatches ~20 item-type cases inline. `packages/openai/src/responses/openai-responses-language-model.ts`.
- **F-12** God files across the monorepo: top 20 files by line count include `stream-text.ts` 2941, `workflow-agent.ts` 3015, `anthropic-language-model.ts` 2996, `openai-responses-language-model.ts` 2933, `convert-to-openai-responses-input.ts` 1547, `mcp-client.ts` 1534, `google-language-model.ts` 1640, `anthropic-api.ts` 1475, `amazon-bedrock-chat-language-model.ts` 1468, `oauth.ts` 1438.
- **F-15** `test:ci` excludes the `ai` and `@ai-sdk/codemod` packages; they run only in separate matrix jobs. `package.json:30`. A regression in core can land without the `ai` package's tests catching it from a non-`ai` PR.
- **F-16** `tools/split-ts-references.mjs` has no test coverage and silently drops unknown reference roots. `tools/split-ts-references.mjs:30-50`.
- **F-19** Same as F-03: MCP stdio env inheritance is wider than required for an untrusted child.
- **F-20** `createChildProcess` does not validate that `command` is an absolute path or in an allowlist. `packages/mcp/src/tool/mcp-stdio/create-child-process.ts:6-27`. `spawn(config.command, ...)` with whatever the caller passed. `shell: false` prevents shell injection but a caller-supplied `command: 'mcp-foo'` will use the inherited `PATH` to find an executable.
- **F-21** Same as F-06: `maskSandboxCredentials` is a *name* mask, not a value mask.
- **F-24** `MCPTransportConfig` type union does not include `'stdio'` though `Experimental_StdioMCPTransport` is shipped.
- **F-28** No rate limiting, no cost cap, no retry-storm protection in the gateway provider. `packages/gateway/src/gateway-provider.ts`. `prepareRetries` is per-call, not per-window.

### P3 — Nits (~13 findings)

- **F-08** `extractApprovalRequestIdToToolCallIdMapping` accepts non-string `approvalRequestId` via cast. `packages/openai/src/responses/openai-responses-language-model.ts:100-116`.
- **F-09** `extractJsonMiddleware` strips both prefix and suffix fence, but the suffix-strip is only applied when `prefixStripped` is true. `packages/ai/src/middleware/extract-json-middleware.ts:164-198`.
- **F-13** `registerProvider` mutates the provider via `Object.assign(Object.create(...))`. `packages/ai/src/registry/provider-registry.ts:204-224`. If any future provider uses `#private` fields or a class, the registry silently strips them.
- **F-14** `harness-claude-code` is a 1,980-line Claude Code adapter with 60+ imports. `packages/harness-claude-code/src/claude-code-harness.ts`.
- **F-17** `test_mcp_windows` only runs `pnpm test:node`; `test:edge` is not exercised on Windows. `.github/workflows/ci.yml:327-357`.
- **F-18** `konsistent` job and `check` job run on every PR; no `changes` filter.
- **F-22** `asLanguageModelV4` is a 3-version adapter cast. `packages/ai/src/middleware/wrap-language-model.ts:36`.
- **F-23** No URL validation hook in `getFromApi` is enforced for external providers.
- **F-25** `AGENTS.md` "Do Not" list says "Don't use `require()` for imports" — confirmed compliance.
- **F-26** `tools/tsconfig/package.json` declares `MIT` while the rest of the monorepo is `Apache-2.0`.
- **F-27** No `NOTICE` file.
- **F-29** `extractJsonMiddleware` has a `SUFFIX_BUFFER_SIZE = 12` magic number and a streaming phase machine.
- **F-30** Telemetry dispatcher is opt-in but the instrumentation is in-tree.

### No-finding categories

- **Dependency hygiene:** clean. No `*`/`latest`, no postinstall scripts, no `node_modules` in git, no `hasInstallScript` packages in the lockfile.
- **Circular imports:** none detected in the focus files. The package graph is acyclic at the type level.
- **Hardcoded credentials / secrets in source:** none found in the focus files.
- **SSRF risks in `getFromApi`:** the custom oxlint rule enforces `validateUrl` for in-repo callers; out-of-repo providers must opt in.

## Recommendations (no fixes proposed — observations only)

- Treat the **harness adapter suite** as the highest-maintenance cost surface: 8 adapters × deeply-nested bridge deps × upstream SDK churn. The `update-harness-dependencies` skill exists; make sure it remains a release-gate.
- Decide on a **core refactor posture** for `stream-text.ts`, `generate-text.ts`, and `openai-responses-language-model.ts`. The 83 TODO markers (several with v8 references that survived to v7) suggest a real backlog.
- The **load-time matrix** is a great forcing function but lacks a baseline. If it ever flakes, there is no "was-this-regressed" answer.
- **`apps/docs` build fragility** (12 GB swap, three-branch content sync) is the most likely CI-breaking change. The comment in `ci.yml:180-187` is a tripwire that should be acted on before the next docs refactor.
- The new **ADR process** (`contributing/decisions/2026-03-11-adopt-architecture-decision-records.md`) is only one ADR in. It would benefit from at least a few seeded ADRs covering the existing architecture docs in `architecture/`.
- **`LICENSE` is missing from per-package roots** (only the root has one). For npm-published packages this is conventional, but a `LICENSE` copy in each published package would be belt-and-suspenders for any downstream consumer.
- **Reconcile `tools/tsconfig` license** (MIT vs Apache-2.0) for internal consistency, even though the package is private.
- **Document the MCP stdio security model** (F-19, F-20) explicitly. A user wiring MCP servers from a config file needs to know the trust assumptions.
