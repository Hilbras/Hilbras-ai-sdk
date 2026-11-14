# Landing page and brand assets

The marketing page for `@hilbras/sdk`, built with the same design system as
[OmniHilbras](https://github.com/Hilbras/OmniHilbras): the same tokens, the same
component vocabulary (`.card`, `.btn-gold`, `.eyebrow`, `.gold-text`, …), the
same Geist family, and the same warm gold-on-ink palette.

`landing/` is a static folder — two files and an `assets/` directory. There is no
build step, so it can be opened from disk or dropped on any host as-is.

```
landing/
  index.html          the page
  styles.css          the design system, as plain CSS
  assets/             icons and the social preview card
brand/
  logo-mark.svg       the mark, transparent
  logo.svg            the mark on the ink tile
  wordmark.svg        mark + "HilbrasSDK"
  favicon.svg         flat variant, for 16px
  logo-*.png          rasterised sizes (16 → 512, plus maskable)
  og-image.png        1200×630 social preview
  generate-assets.py  regenerates every PNG above
```

## Preview

```bash
cd landing && python3 -m http.server 8080   # then open http://localhost:8080
```

## Regenerating the PNGs

The mark is pure geometry, so it rasterises exactly: draw at 4× and downsample.
That is what `generate-assets.py` does, and it also copies the icons the page
needs into `landing/assets/`, so the page stays a self-contained folder.

```bash
python3 brand/generate-assets.py
```

It needs Pillow (`pip install pillow`) and writes into both `brand/` and
`landing/assets/`.

`og-image.png` deliberately carries no wordmark: the brand face is Geist, which
is a webfont and is not available to the script. Rendering the wordmark in a
substitute face would put an off-brand asset in the repository's social preview,
so the card is the mark alone until that can be generated with the real font.

## Deploying

GitHub Pages is **not** configured for this repository yet, so nothing publishes
this automatically. Once Pages is enabled, either point it at a branch folder
containing `landing/`, or add a workflow that publishes that directory — the page
needs no build step.
