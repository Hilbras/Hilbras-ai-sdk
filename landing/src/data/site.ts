/**
 * Every claim the page makes about the package, in one place.
 *
 * A marketing page that states numbers is a page that can go stale, and this
 * repository has already been bitten twice by exactly that — a `version-3.7.0`
 * badge while the package was 3.8.x, and a `2070 tests` badge after the suite
 * grew. `scripts/check-facts.mjs` therefore re-reads `version`, `adapterCount`
 * and `providerCount` from the repository and fails if they disagree with what
 * is written here.
 *
 * `testCount` is the one value with no cheap source to check against, so it is
 * the one value a human still has to keep honest.
 */
export const site = {
  name: '@hilbras/sdk',
  brand: 'Hilbras',
  product: 'Hilbras SDK',

  title: '@hilbras/sdk — one client for every model',
  description:
    '@hilbras/sdk is a TypeScript client for 23 model providers: streaming, tool calling and validated structured output behind one API, with budgets, retries and guardrails, and no runtime dependencies.',
  shortDescription:
    '23 provider adapters, streaming with real semantics, and guardrails that ship on by default. Zero runtime dependencies.',

  /** Must match the version published to npm. Checked by `npm run check:facts`. */
  version: '3.8.1',
  /** Update by hand when the suite changes size; see the note above. */
  testCount: 2078,
  /** Counted from `src/adapters/*.ts` by `npm run check:facts`. */
  adapterCount: 23,
  /** Counted from `src/catalog/provider-catalog.ts` by `npm run check:facts`. */
  providerCount: 17,
  frameworkCount: 10,

  url: 'https://hilbras-sdk.vercel.app',
  repository: 'https://github.com/Hilbras/Hilbras-ai-sdk',
  npm: 'https://www.npmjs.com/package/@hilbras/sdk',
  changelog: 'https://github.com/Hilbras/Hilbras-ai-sdk/blob/main/CHANGELOG.md',
  organization: 'https://hilbras.com',
  license: 'MIT',
  licenseUrl: 'https://github.com/Hilbras/Hilbras-ai-sdk/blob/main/LICENSE',
} as const;
