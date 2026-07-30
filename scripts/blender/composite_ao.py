"""Phase 4 step 3b: multiply the baked card AO into a copy of the hero albedo.

    .venv-textures/Scripts/python scripts/blender/composite_ao.py

Runs outside Blender because it needs PIL and numpy, which the bundled
interpreter does not carry. Reads assets-src, writes only to assets-src/baked;
the originals are never opened for writing.

The multiply is done in linear light. AO is a linear occlusion factor and the
albedo is sRGB encoded, so multiplying the two 8-bit buffers directly would
darken by roughly the wrong amount everywhere, most visibly in the midtones. The
albedo is decoded, multiplied, and re-encoded.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
BAKED = REPO / "assets-src" / "baked"
ALBEDO = REPO / "assets-src" / "faces" / "hero-albedo.png"
AO = BAKED / "card-ao.png"
OUT = BAKED / "hero-albedo-ao.png"


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.0031308, x * 12.92,
                    1.055 * np.clip(x, 0.0, None) ** (1 / 2.4) - 0.055)


def main() -> None:
    for p in (ALBEDO, AO):
        if not p.exists():
            raise SystemExit(f"missing input: {p}")

    alb = Image.open(ALBEDO)
    print(f"albedo {ALBEDO.name}: {alb.size} {alb.mode}")
    ao = Image.open(AO).convert("L")
    print(f"ao     {AO.name}: {ao.size} {ao.mode}")

    # Both live in the card's edge to edge UV space, so a straight resample onto
    # the albedo's grid is the correct mapping. Lanczos to match the Phase 3
    # reduction path.
    if ao.size != alb.size:
        ao = ao.resize(alb.size, Image.LANCZOS)
        print(f"ao resampled to {ao.size} with Lanczos")

    a = np.asarray(ao).astype(np.float64) / 255.0
    print(f"\nAO factor: min {a.min():.4f}  mean {a.mean():.4f}  "
          f"max {a.max():.4f}")
    for t in (0.99, 0.95, 0.90):
        pct = float((a < t).mean()) * 100.0
        print(f"  pixels below {t:.2f}: {pct:6.3f} percent")

    has_alpha = alb.mode in ("RGBA", "LA")
    rgb = np.asarray(alb.convert("RGB")).astype(np.float64) / 255.0
    lin = srgb_to_linear(rgb)
    out_lin = lin * a[..., None]
    out_srgb = np.clip(linear_to_srgb(out_lin), 0.0, 1.0)
    out8 = np.round(out_srgb * 255.0).astype(np.uint8)

    delta = np.abs(out8.astype(np.int16) - np.asarray(alb.convert("RGB")).astype(np.int16))
    print(f"\n8-bit delta against the original albedo: max {int(delta.max())}, "
          f"mean {delta.mean():.4f}")
    print(f"  pixels changed at all: {float((delta.max(axis=2) > 0).mean()) * 100:.3f} percent")

    if has_alpha:
        alpha = np.asarray(alb.convert("RGBA"))[..., 3]
        result = Image.fromarray(np.dstack([out8, alpha]), mode="RGBA")
    else:
        result = Image.fromarray(out8, mode="RGB")

    BAKED.mkdir(parents=True, exist_ok=True)
    result.save(OUT, optimize=True)

    assert ALBEDO.stat().st_size > 0
    print(f"\nwrote {OUT.relative_to(REPO)}  {OUT.stat().st_size} B  "
          f"{result.size} {result.mode}")
    print(f"original {ALBEDO.relative_to(REPO)} untouched, "
          f"{ALBEDO.stat().st_size} B")


if __name__ == "__main__":
    main()
