"""
Section F. Packed RG, 504 x 704.

  R = foil mask, straight from section C
  G = roughness, 0.35 base falling to 0.15 inside the foil regions
  B = 0, unused, reserved

Roughness is interpolated by the foil mask rather than switched on a
threshold, so a partly foiled pixel gets a partly lowered roughness and the
raking-light sweep has somewhere to ramp. 0.35 and 0.15 are the two endpoints
the brief names.

504 x 704 is exactly half the face in both axes, so the reduction is a clean
2:1 with no fractional sampling.

    python scripts/textures/f_packed.py
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from common import CARDS, FACES_DIR, PACKED_DIR, TEX_H, TEX_W, save_png

OUT_W, OUT_H = 504, 704
ROUGH_BASE = 0.35
ROUGH_FOIL = 0.15


def pack(slug: str) -> None:
    src = FACES_DIR / f"{slug}-foilmask.png"
    if not src.exists():
        raise SystemExit(f"Missing {src}. Run c_foilmask.py first.")
    m = Image.open(src).convert("L")
    if m.size != (TEX_W, TEX_H):
        raise SystemExit(f"{src.name} is {m.size}, expected {(TEX_W, TEX_H)}")
    m = m.resize((OUT_W, OUT_H), Image.LANCZOS)

    foil = np.array(m).astype(np.float32) / 255.0
    rough = ROUGH_BASE + (ROUGH_FOIL - ROUGH_BASE) * foil

    rgb = np.zeros((OUT_H, OUT_W, 3), np.uint8)
    rgb[..., 0] = (foil * 255).round().clip(0, 255)
    rgb[..., 1] = (rough * 255).round().clip(0, 255)
    im = Image.fromarray(rgb, "RGB")
    p = save_png(im, PACKED_DIR / f"{slug}-rg.png")
    print(f"  {p.name:22s} {im.size}  R mean {rgb[...,0].mean():6.2f}  "
          f"G range {rgb[...,1].min():3d}..{rgb[...,1].max():3d}  "
          f"B {rgb[...,2].max()}")


if __name__ == "__main__":
    for card in CARDS:
        pack(card["slug"])
    pack("back")
    print(f"  roughness endpoints: base {ROUGH_BASE} -> "
          f"{round(ROUGH_BASE * 255)}, foil {ROUGH_FOIL} -> "
          f"{round(ROUGH_FOIL * 255)}")
