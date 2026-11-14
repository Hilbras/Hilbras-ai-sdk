# Landing page

The marketing page for `@hilbras/sdk`, built with [Astro](https://astro.build) and
shipping plain static HTML. It is not published to npm — the library ships from the
repository root.

The design system is the OmniHilbras one: the same tokens, the same component
vocabulary (`.card`, `.btn-gold`, `.eyebrow`, `.gold-text`, …), the same Geist family
and the same warm gold-on-ink palette. `src/styles/global.css` is plain CSS, not
Tailwind, so nothing about the design depends on this project's build.

## Commands

```bash
npm install
npm run dev          # astro dev, with HMR
npm run build        # static output in dist/
npm run preview      # serve dist/ locally
npm run check        # astro check — types across .astro and .ts
npm run check:facts  # verify the page's numbers against the repository
```

`check:facts` reads the SDK's `package.json` and `src/` from the parent directory, so
it only works from inside the repository. It is not part of `astro build` — the Vercel
build sees this folder alone.

## Layout

```
astro.config.mjs      site URL, sitemap, inlined stylesheets
src/layouts/Base.astro    <head>: SEO, structured data, theme boot
src/pages/index.astro     the page
src/components/           Logo, Tick, SectionHead
src/data/site.ts          every fact and link the page states
src/data/providers.ts     the provider strip, rendered twice for a seamless loop
src/scripts/interactions.ts   theme toggle, scroll reveal, progress, animation gating
src/styles/global.css     the design system
public/                   icons, social card, robots.txt, web manifest
scripts/check-facts.mjs   the drift check
```

## Where the facts live

`src/data/site.ts` holds the version, counts and links. A marketing page states
numbers, and stated numbers rot: this repository has already shipped a `version-3.7.0`
badge while the package was 3.8.x, and a `2070 tests` badge after the suite had grown.
`npm run check:facts` therefore re-reads `version`, `adapterCount` and `providerCount`
from the repository and fails on a mismatch, and CI runs it. `testCount` has no cheap
source to check, so it is the one value a human still updates by hand.

## Fonts

Geist and Geist Mono are self-hosted through `@fontsource-variable/*` and preloaded
from `Base.astro`. The previous build pulled them from `fonts.googleapis.com`, which
put a third-party stylesheet in front of first paint — Lighthouse measured 604 ms of
render blocking from that one request. Same-origin fonts remove the extra DNS, TLS and
round trip, and the preload means the file is fetched alongside the document rather
than discovered after the CSS is parsed.

The stylesheet declares five subsets per family, each behind a `unicode-range`; the
browser downloads only latin (32 KB sans, 24 KB mono).

## Search and social

`site` in `astro.config.mjs` is the only place the public origin appears. The canonical
URL, `og:url` and `og:image` are all derived from it in `Base.astro`, so moving the page
to another domain is a one-line change.

Two of those were wrong on the old static page and are worth remembering as failure
modes:

- the canonical pointed at `https://hilbras.github.io/Hilbras-ai-sdk/`, a GitHub Pages
  address that is not configured and returns 404 — it told crawlers the real page was
  somewhere else, and that the somewhere else did not exist;
- `og:image` was the relative path `assets/og-image.png`, which most social scrapers
  refuse to resolve, so shared links had no card.

`@astrojs/sitemap` writes `sitemap-index.xml`, `public/robots.txt` points at it, and
`Base.astro` carries JSON-LD for the organization, the site and the software. There is
also a `site.webmanifest` and a `theme-color` per colour scheme.

## Motion

Entrances fill `backwards`, so the resting state is the visible one and an animation
that never runs leaves the content in place. Everything sits behind
`prefers-reduced-motion: no-preference`, and the reveal's hidden state hangs off a `.js`
class set before first paint, so the page reads correctly with scripting off.

The continuous animations — marquee, glow, shimmer, caret, heartbeat — start paused and
are started by `interactions.ts` only while their element is on screen. That is not
fussiness: with them running unconditionally, Lighthouse measured **3.0 s of blocking
time on a throttled phone**, because a mid-range CPU cannot repaint a shimmering
headline and a 36-item marquee for free. Paused is also the no-script default, which is
why a page without JavaScript simply holds still instead of looking broken.

The hero lift uses `translate` rather than `transform`, because the reveal animation
owns `transform` and one shorthand would have the two overwriting each other's
transition.

## Brand assets

The logo, icons and social card come from `brand/` at the repository root.

```bash
python3 brand/generate-assets.py   # needs Pillow
```

The mark is pure geometry, so the script draws it at 4× and downsamples — no rasteriser
needed. It writes the PNG set into `brand/` and the copies the page serves into
`public/`. Both directories are inputs, not build output; do not edit them by hand.

`og-image.png` deliberately carries no wordmark: the brand face is Geist, a webfont the
script cannot use, and rendering the wordmark in a substitute face would put an
off-brand asset in the repository's social preview.

## Deploying

Live at **https://hilbras-sdk.vercel.app**, as the `hilbras-sdk` project. Vercel is
connected to `Hilbras/Hilbras-ai-sdk` with root directory `landing` and `main` as the
production branch, so the page ships with the rest of the repository — a push to `main`
builds and deploys it, and a pull request gets a preview. Vercel detects Astro and runs
`astro build`; the output directory is `dist`.

Local runs of the Vercel CLI create `.vercel/` and `.env.local` in this folder;
`.gitignore` keeps both, and `node_modules/`, `dist/` and `.astro/`, out of the
repository.

## A note on TypeScript

This package pins `typescript@^5.9`, unlike the SDK root, which is on 7.x.
`@astrojs/check` declares its peer range as `^5.0.0 || ^6.0.0`, so `astro check` cannot
run against 7. The two are separate `node_modules` trees and do not interact.
