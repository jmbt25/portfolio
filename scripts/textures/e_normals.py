"""
Section E. Normal maps.

Two products, and they are not the same job:

  holo normals    height-to-normal of the five rebuilt section D maps, 1024,
                  tileable. Gradients are taken with np.roll so the derivative
                  wraps, which keeps the normal map as seamless as the height
                  map it came from. Taking them without wrap would reintroduce
                  a seam at the edge that section D just removed.

  frame emboss    from the frame lineart, 1008 x 1408, non-tiling. The lineart
                  is the ink keyline of frame-src.png, isolated by luminance
                  and alpha, blurred into a ridge and differentiated with
                  edge-clamped gradients.

    python scripts/textures/e_normals.py
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from common import (FRAME_SRC, HOLO_DIR, NORMALS_DIR, TEX_H, TEX_W,
                    reduce_card, save_png)

HOLO_STRENGTH = 2.6
FRAME_STRENGTH = 3.4
INK_LUMA_MAX = 96.0
FRAME_RIDGE_BLUR = 2.2

PATTERNS = ["hex-circuit-mesh", "diagonal-prismatic-lines",
            "cross-hatch-weave", "halftone-comic-dots", "starburst-rays"]


def to_normal(height: np.ndarray, strength: float, wrap: bool) -> Image.Image:
    h = height.astype(np.float32) / 255.0
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    else:
        gx = np.empty_like(h)
        gy = np.empty_like(h)
        gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
        gx[:, 0] = h[:, 1] - h[:, 0]
        gx[:, -1] = h[:, -1] - h[:, -2]
        gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
        gy[0, :] = h[1, :] - h[0, :]
        gy[-1, :] = h[-1, :] - h[-2, :]
        dx, dy = gx, gy

    nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], -1)
    return Image.fromarray(((rgb * 0.5 + 0.5) * 255).round()
                           .clip(0, 255).astype(np.uint8), "RGB")


def holo_normals() -> None:
    for name in PATTERNS:
        h = np.array(Image.open(HOLO_DIR / f"{name}-height.png").convert("L"))
        n = to_normal(h, HOLO_STRENGTH, wrap=True)
        p = save_png(n, NORMALS_DIR / f"{name}-normal.png")
        a = np.array(n).astype(np.int16)
        wrap_v = int(np.abs(a[0] - a[-1]).max())
        wrap_h = int(np.abs(a[:, 0] - a[:, -1]).max())
        inner_v = int(np.abs(a[0] - a[1]).max())
        inner_h = int(np.abs(a[:, 0] - a[:, 1]).max())
        print(f"  {p.name:34s} {n.size}  wrap step v/h {wrap_v:3d}/{wrap_h:3d}"
              f"   interior step v/h {inner_v:3d}/{inner_h:3d}")


def frame_emboss() -> None:
    from scipy import ndimage

    f = np.array(Image.open(FRAME_SRC).convert("RGBA"))
    rgb, alpha = f[..., :3].astype(np.float32), f[..., 3].astype(np.float32)
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    ink = ((lum < INK_LUMA_MAX) & (alpha > 128)).astype(np.float32)
    print(f"frame lineart: {int(ink.sum())} ink px at master scale "
          f"({100 * ink.mean():.2f} percent of canvas)")

    ridge = ndimage.gaussian_filter(ink, FRAME_RIDGE_BLUR)
    ridge = ridge / max(ridge.max(), 1e-6)
    height = Image.fromarray((ridge * 255).round().clip(0, 255)
                             .astype(np.uint8), "L")
    # Reduce through the same crop-then-single-Lanczos path as the albedo, so
    # the emboss lands in register with the face it belongs to.
    card = reduce_card(height)
    n = to_normal(np.array(card), FRAME_STRENGTH, wrap=False)
    p = save_png(n, NORMALS_DIR / "frame-emboss-normal.png")
    print(f"  {p.name:34s} {n.size}  non-tiling, in register with the albedo")


if __name__ == "__main__":
    holo_normals()
    frame_emboss()
