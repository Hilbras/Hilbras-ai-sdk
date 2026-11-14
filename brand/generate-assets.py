"""Generate the PNG brand assets from the same geometry as the SVGs in this directory.

The mark is pure geometry — no text — so it rasterises exactly at any size. Draw at
4x and downsample with LANCZOS for antialiasing.

Run from the repository root:  python3 brand/generate-assets.py

The landing page's own icons are copied from here into `landing/assets/` by the same
run, so the page stays deployable as a self-contained folder.

Note: `og-image.png` deliberately has no wordmark text. The brand face is Geist, which
is a webfont and is not available to this script; rendering the wordmark in a
substitute face would put an off-brand asset in the repository's social preview.
"""

from pathlib import Path

from PIL import Image, ImageDraw

GOLD = "#e2bd52"
GOLD_BRIGHT = "#f3d789"
INK = "#0c0b09"

# (points, colour) in the 64x64 coordinate space shared with brand/logo-mark.svg
MARK: list[tuple[list[tuple[float, float]], str]] = [
    ([(32, 5), (54, 18.5), (45, 24.5), (32, 17)], GOLD),
    ([(54, 18.5), (54, 45.5), (45, 39.5), (45, 24.5)], GOLD_BRIGHT),
    ([(54, 45.5), (32, 59), (32, 47), (45, 39.5)], GOLD),
    ([(32, 59), (10, 45.5), (19, 39.5), (32, 47)], GOLD_BRIGHT),
    ([(10, 45.5), (10, 18.5), (19, 24.5), (19, 39.5)], GOLD),
    ([(10, 18.5), (32, 5), (32, 17), (19, 24.5)], GOLD_BRIGHT),
    ([(24, 23), (40, 23), (40, 27), (24, 27)], GOLD_BRIGHT),
    ([(24, 27), (28, 27), (28, 30), (24, 30)], GOLD_BRIGHT),
    ([(24, 30), (40, 30), (40, 34), (24, 34)], GOLD_BRIGHT),
    ([(36, 34), (40, 34), (40, 37), (36, 37)], GOLD_BRIGHT),
    ([(24, 37), (40, 37), (40, 41), (24, 41)], GOLD_BRIGHT),
    ([(32, 1.5), (34.5, 4), (32, 6.5), (29.5, 4)], GOLD),
    ([(32, 57.5), (34.5, 60), (32, 62.5), (29.5, 60)], GOLD),
    ([(7.5, 32), (10, 29.5), (12.5, 32), (10, 34.5)], GOLD),
    ([(51.5, 32), (54, 29.5), (56.5, 32), (54, 34.5)], GOLD),
]

SUPERSAMPLE = 4


def draw_mark(size: int, *, rounded: bool = True, mark_scale: float = 1.0) -> Image.Image:
    """The mark as a `size` x `size` image.

    `mark_scale` shrinks the geometry inside the tile, which is what a maskable icon
    needs: the platform may crop to a circle, so the artwork has to sit in the safe zone.
    """
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    radius = round(16 * (size / 64) * SUPERSAMPLE) if rounded else 0
    draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=radius, fill=INK) if rounded else draw.rectangle(
        [0, 0, canvas - 1, canvas - 1], fill=INK
    )

    scale = (size / 64.0) * mark_scale * SUPERSAMPLE
    offset = (canvas - 64 * scale) / 2
    for points, colour in MARK:
        draw.polygon([(offset + x * scale, offset + y * scale) for x, y in points], fill=colour)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    brand = Path(__file__).resolve().parent
    root = brand.parent

    for size in (16, 32, 48, 64, 128, 180, 512):
        draw_mark(size).save(brand / f"logo-{size}.png")

    for size in (192, 512):
        draw_mark(size, rounded=False, mark_scale=0.78).save(brand / f"logo-maskable-{size}.png")

    # Social preview card: the mark on the brand background, centred, above a gold hairline.
    card = Image.new("RGB", (1200, 630), INK)
    card.paste(draw_mark(300, rounded=False), (450, 120), draw_mark(300, rounded=False))
    hairline = ImageDraw.Draw(card)
    hairline.rectangle([450, 470, 750, 472], fill="#7a6633")
    card.save(brand / "og-image.png")

    # The landing page is deployed as a folder, so it carries its own copy of the icons.
    assets = root / "landing" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    draw_mark(192).save(assets / "icon-192.png")
    draw_mark(512).save(assets / "icon-512.png")
    draw_mark(180).save(assets / "apple-touch-icon.png")
    draw_mark(32).save(assets / "favicon-32.png")
    card.save(assets / "og-image.png")

    print(f"wrote {len(list(brand.glob('*.png')))} PNGs to brand/ and the landing page icons to landing/assets/")


if __name__ == "__main__":
    main()
