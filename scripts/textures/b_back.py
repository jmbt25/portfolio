"""
Section B. Card back, 1008 x 1408.

The back artwork is generated locally by ComfyUI through the Phase 3 driver,
see scripts/textures/comfyui-workflows/. The JMBT monogram is NOT generated:
it is set here in JetBrains Mono at master scale and composited into the blank
medallion, for the same reason the certification label is authored as SVG
under D4. Lettering baked by an image model cannot be grepped, cannot be
corrected, and round two already established the no-text-in-image-prompts
rule.

The art is generated at 1264 x 1760 and cropped, not resampled, to the
1260 x 1760 master silhouette, so the card still meets one Lanczos reduction
in total, per D3.

    python scripts/textures/b_back.py
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from common import (CARD_H, CARD_W, CARD_X0, CARD_Y0, CREAM, FACES_DIR,
                    FRAME_SRC, INK, MASTER, font_at, reduce_card, save_png,
                    tracked_width, draw_tracked)

GEN = (__import__("pathlib").Path(__file__).resolve().parent
       / "comfyui-workflows" / "generations" / "card-back_seed30500.png")

MONOGRAM = "JMBT"
MONO_TRACK = 0.08
MONO_FILL_OF_MEDALLION = 0.66


def find_medallion(rgb: np.ndarray) -> tuple[int, int, int]:
    """Locate the blank cream disc the prompt reserves for the monogram."""
    from scipy import ndimage

    h, w, _ = rgb.shape
    d = np.linalg.norm(rgb.astype(np.float32) - np.array(CREAM, np.float32),
                       axis=-1)
    cream = d < 42
    # Only consider the middle of the card, so the cream outer border and any
    # cream in the corner panels cannot win.
    box = np.zeros_like(cream)
    box[int(0.18 * h):int(0.82 * h), int(0.10 * w):int(0.90 * w)] = True
    lab, n = ndimage.label(cream & box)
    if n == 0:
        raise SystemExit("No cream medallion found in the generated back.")
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    idx = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(lab == idx)
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    r = int(min(xs.max() - xs.min(), ys.max() - ys.min()) // 2)
    fill = len(xs) / (np.pi * r * r)
    print(f"medallion: centre ({cx}, {cy}) radius {r} circle-fill {fill:.3f}")
    if fill < 0.80:
        raise SystemExit(f"Medallion is not disc-like (fill {fill:.3f}).")
    return cx, cy, r


def build_back() -> Image.Image:
    if not GEN.exists():
        raise SystemExit(f"Generated back art missing: {GEN}\n"
                         "Run the card-back workflow first, see PHASE3.md.")
    art = Image.open(GEN).convert("RGB")
    gw, gh = art.size
    if (gw, gh) != (1264, 1760):
        raise SystemExit(f"Back art is {art.size}, expected (1264, 1760)")

    # Crop rather than resample, so this stays a single-reduction pipeline.
    left = (gw - CARD_W) // 2
    art = art.crop((left, 0, left + CARD_W, CARD_H))

    a = np.array(art)
    cx, cy, r = find_medallion(a)

    master = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    master.paste(art, (CARD_X0, CARD_Y0))

    # Take the silhouette straight from the frame, so back and face share one
    # outline exactly rather than two that nearly agree.
    frame_alpha = np.array(Image.open(FRAME_SRC).convert("RGBA"))[..., 3]
    m = np.array(master)
    m[..., 3] = frame_alpha
    master = Image.fromarray(m)

    # Monogram, set at master scale into the reserved medallion.
    draw = ImageDraw.Draw(master)
    mx, my = CARD_X0 + cx, CARD_Y0 + cy
    target_w = 2 * r * MONO_FILL_OF_MEDALLION
    size = target_w / (0.6 * len(MONOGRAM) + MONO_TRACK * (len(MONOGRAM) - 1))
    f = font_at(size, 600)
    w = tracked_width(f, MONOGRAM, MONO_TRACK, size)
    draw_tracked(draw, (mx - w / 2.0, my), MONOGRAM, f, INK, MONO_TRACK, size,
                 anchor_y="m")
    print(f"monogram: {MONOGRAM!r} at {size:.1f}px master, width {w:.1f}px")

    return reduce_card(master)


if __name__ == "__main__":
    back = build_back()
    p = save_png(back, FACES_DIR / "back-albedo.png")
    print(f"  {p}  {back.size}  {p.stat().st_size} B")
