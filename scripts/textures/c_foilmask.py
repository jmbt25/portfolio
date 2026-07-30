"""
Section C. Foil masks, 1008 x 1408 grayscale.

Procedural, as the brief requires. Two contributions, unioned at master scale
and reduced through the same crop-then-single-Lanczos path as the albedo:

  frame holo regions   the chroma-bearing frame parts, which are the two
                       spines, the name bar and the roundel rings. Segmented
                       from frame-src.png by alpha and chroma, so the cream
                       panels and the ink keyline are excluded by measurement
                       rather than by hand-drawn boxes.

  art highlights       the brightest part of each card's art, inside the
                       measured window only, on a soft percentile ramp so the
                       mask has a gradient to drive the raking-light sweep
                       rather than a binary cut.

    python scripts/textures/c_foilmask.py
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from common import (ART_BOX, ART_DIR, CARD_H, CARD_W, CARD_X0, CARD_Y0, CARDS,
                    CREAM, FACES_DIR, FRAME_SRC, MASTER, reduce_card, save_png)

CHROMA_MIN = 40.0     # separates the coloured frame parts from cream and ink

# Art highlights. A percentile straight off the raw luminance traces every
# cel-shading edge and produces a mask of thin wires, because the art is flat
# shaded with thick black outlines and every light-against-outline boundary
# clears any threshold. Pre-blurring first selects broad lit regions instead
# of edges, and a morphological opening removes whatever wire survives.
ART_PRE_BLUR = 9.0    # px at master scale
ART_OPEN_RADIUS = 7   # px, minimum feature width that may remain
ART_LO_PCT, ART_HI_PCT = 80.0, 98.5
ART_SMOOTH = 4.0


def chroma(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    return f.max(axis=-1) - f.min(axis=-1)


def frame_foil(frame_rgba: np.ndarray) -> np.ndarray:
    """Chroma-bearing frame regions: spines, name bar, roundel rings."""
    alpha = frame_rgba[..., 3].astype(np.float32) / 255.0
    c = chroma(frame_rgba[..., :3])
    soft = np.clip((c - CHROMA_MIN) / 45.0, 0.0, 1.0)
    return soft * alpha


def art_highlights(slug: str, window: np.ndarray) -> np.ndarray:
    from scipy import ndimage

    ax, ay, aw, ah = ART_BOX
    art = np.array(Image.open(ART_DIR / f"{slug}-art-src.png").convert("RGB"))
    lum = (0.2126 * art[..., 0] + 0.7152 * art[..., 1]
           + 0.0722 * art[..., 2]).astype(np.float32)
    broad = ndimage.gaussian_filter(lum, ART_PRE_BLUR)
    lo, hi = np.percentile(broad, [ART_LO_PCT, ART_HI_PCT])
    ramp = np.clip((broad - lo) / max(hi - lo, 1e-6), 0.0, 1.0)

    # Grey opening: erode then dilate with a disc, which deletes any structure
    # narrower than the disc while leaving broad lit areas at full value.
    r = ART_OPEN_RADIUS
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disc = (xx ** 2 + yy ** 2) <= r * r
    ramp = ndimage.grey_opening(ramp, footprint=disc)
    ramp = ndimage.gaussian_filter(ramp, ART_SMOOTH)

    full = np.zeros((MASTER, MASTER), np.float32)
    full[ay:ay + ah, ax:ax + aw] = ramp
    return full * window


def build_faces(frame_rgba: np.ndarray, window: np.ndarray) -> None:
    ff = frame_foil(frame_rgba)
    for card in CARDS:
        m = np.maximum(ff, art_highlights(card["slug"], window))
        im = Image.fromarray((m * 255).round().clip(0, 255).astype(np.uint8),
                             "L")
        out = reduce_card(im)
        p = save_png(out, FACES_DIR / f"{card['slug']}-foilmask.png")
        a = np.array(out)
        print(f"  {p.name:28s} {out.size}  mean {a.mean():6.2f}  "
              f"foil>128 {100 * (a > 128).mean():5.2f} percent")


def build_back() -> None:
    """The back is all frame language, so its own chroma is the foil."""
    back = np.array(Image.open(FACES_DIR / "back-albedo.png").convert("RGBA"))
    alpha = back[..., 3].astype(np.float32) / 255.0
    c = chroma(back[..., :3])
    m = np.clip((c - CHROMA_MIN) / 45.0, 0.0, 1.0) * alpha
    im = Image.fromarray((m * 255).round().clip(0, 255).astype(np.uint8), "L")
    p = save_png(im, FACES_DIR / "back-foilmask.png")
    a = np.array(im)
    print(f"  {p.name:28s} {im.size}  mean {a.mean():6.2f}  "
          f"foil>128 {100 * (a > 128).mean():5.2f} percent")


if __name__ == "__main__":
    from a_faces import build_window_mask

    frame = np.array(Image.open(FRAME_SRC).convert("RGBA"))
    window, _ = build_window_mask(frame)
    build_faces(frame, window.astype(np.float32))
    build_back()
