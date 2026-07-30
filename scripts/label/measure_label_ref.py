"""Measure the three-zone geometry of assets-src/label-ref.png.

label-ref.png is proportion reference only, per the handoff spec section 05 and
PICKS.md. Everything the production SVG needs from it is measured here rather
than eyeballed, matching the approach Phase 3 took to the frame.

Emits a JSON of fractions of the content box, so the SVG layout is resolution
independent.

    python scripts/label/measure_label_ref.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
REF = REPO / "assets-src" / "label-ref.png"
OUT = REPO / "assets-src" / "label" / "label-ref-measured.json"

# Greenness, defined exactly as the Phase 1 chroma strip defined it.
GREEN_THRESHOLD = 60

# A keyline is thin. The grade numeral in zone 2 is tall enough to register as a
# full-height vertical run, so runs are discriminated by thickness rather than by
# coverage alone: in this 2048-wide reference the drawn keylines measure 3 to 4
# px, the numeral strokes 32 to 68 px.
MAX_KEYLINE_PX = 8


def main() -> None:
    img = Image.open(REF).convert("RGB")
    a = np.asarray(img).astype(np.int16)
    h, w, _ = a.shape
    r, g, b = a[..., 0], a[..., 1], a[..., 2]

    greenness = g - np.maximum(r, b)
    content = greenness < GREEN_THRESHOLD

    ys, xs = np.nonzero(content)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    cw, ch = x1 - x0 + 1, y1 - y0 + 1

    print(f"source        {w} x {h}")
    print(f"content bbox  x {x0}..{x1}  y {y0}..{y1}")
    print(f"content size  {cw} x {ch}   aspect {cw / ch:.4f}")

    # Work inside the content box only.
    sub = a[y0:y1 + 1, x0:x1 + 1]
    sr, sg, sb = sub[..., 0], sub[..., 1], sub[..., 2]
    lum = (0.2126 * sr + 0.7152 * sg + 0.0722 * sb)

    # Ink is dark and achromatic. Red is dark-ish but strongly chromatic, so it
    # has to be excluded from the ink mask or it reads as a horizontal rule.
    red = (sr > 120) & (sg < 110) & (sb < 110) & ((sr - np.maximum(sg, sb)) > 60)
    ink = (lum < 110) & (~red)

    # Zone dividers: full-height vertical ink runs. A divider column is one that
    # is ink for most of the label height above the bottom band.
    col_ink = ink.mean(axis=0)
    verticals = [r for r in _runs(col_ink > 0.55) if _width(r) <= MAX_KEYLINE_PX]
    print(f"\nvertical keylines:   {verticals}")

    # Horizontal rules: full-width ink rows.
    row_ink = ink.mean(axis=1)
    horizontals = [r for r in _runs(row_ink > 0.55) if _width(r) <= MAX_KEYLINE_PX]
    print(f"horizontal keylines: {horizontals}")

    # The red rule.
    red_rows = _runs(red.mean(axis=1) > 0.20)
    red_row = red_rows[0] if red_rows else None
    red_extent = None
    if red_row is not None:
        band = red[red_row[0]:red_row[1] + 1]
        rx = np.nonzero(band.any(axis=0))[0]
        red_extent = (int(rx.min()), int(rx.max()))
    print(f"red rule rows: {red_rows}  x extent: {red_extent}")

    # Interpret. The outer keyline is the first and last horizontal or vertical
    # run; anything in between is a real division.
    inner_v = [v for v in verticals if v[0] > 4 and v[1] < cw - 5]
    inner_h = [hh for hh in horizontals if hh[0] > 4 and hh[1] < ch - 5]
    print(f"\ninner vertical dividers:   {inner_v}")
    print(f"inner horizontal dividers: {inner_h}")

    if len(inner_v) != 2:
        raise SystemExit(
            f"expected 2 inner vertical dividers, measured {len(inner_v)}. "
            "Refusing to guess the zone split."
        )
    if len(inner_h) != 1:
        raise SystemExit(
            f"expected 1 inner horizontal divider, measured {len(inner_h)}. "
            "Refusing to guess the bottom band."
        )

    v1 = _centre(inner_v[0])
    v2 = _centre(inner_v[1])
    # The bottom band rule is the lowest inner horizontal divider.
    if not inner_h:
        raise SystemExit("expected a bottom band divider, measured none.")
    hb = _centre(inner_h[-1])

    zone1 = v1 / cw
    zone2 = (v2 - v1) / cw
    zone3 = (cw - v2) / cw
    band = (ch - hb) / ch

    data = {
        "source": str(REF.relative_to(REPO)).replace("\\", "/"),
        "source_size": [w, h],
        "content_bbox": [x0, y0, x1, y1],
        "content_size": [cw, ch],
        "content_aspect": round(cw / ch, 6),
        "zone_x_fractions": {
            "zone1_w": round(zone1, 6),
            "zone2_w": round(zone2, 6),
            "zone3_w": round(zone3, 6),
        },
        "zone_divider_x_px": [v1, v2],
        "bottom_band": {
            "divider_y_px": hb,
            "height_fraction": round(band, 6),
        },
        "red_rule": {
            "y_fraction": round(_centre(red_row) / ch, 6) if red_row else None,
            "x_start_fraction": round(red_extent[0] / cw, 6) if red_extent else None,
            "x_end_fraction": round(red_extent[1] / cw, 6) if red_extent else None,
        },
        "text_bars": _measure_bars(ink, cw, ch, v1),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    print("\nzone widths as fraction of content width")
    print(f"  zone 1  {zone1:.4f}")
    print(f"  zone 2  {zone2:.4f}")
    print(f"  zone 3  {zone3:.4f}")
    print(f"  sum     {zone1 + zone2 + zone3:.4f}")
    print(f"bottom band height fraction {band:.4f}")
    print(f"\nwrote {OUT.relative_to(REPO)}")


def _measure_bars(ink: np.ndarray, cw: int, ch: int, v1: int):
    """Zone 1's placeholder bars, as fractions. These set the line positions
    and relative lengths the real copy lines take over.

    The outer keyline and the zone divider are cropped off first, otherwise every
    row registers ink at both ends and every bar measures the same length.
    """
    pad = MAX_KEYLINE_PX
    x_lo, x_hi = pad, v1 - pad
    zone = ink[:, x_lo:x_hi]
    rows = zone.mean(axis=1)
    # A bar is thick. The keylines and the red rule are not, and the red rule is
    # already excluded from the ink mask.
    min_h = max(2, int(round(0.02 * ch)))
    out = []
    for (a, b) in _runs(rows > 0.25):
        if (b - a + 1) < min_h:
            continue
        seg = zone[a:b + 1]
        xs = np.nonzero(seg.any(axis=0))[0]
        if xs.size == 0:
            continue
        out.append({
            "y_centre_fraction": round(((a + b) / 2) / ch, 6),
            "height_fraction": round((b - a + 1) / ch, 6),
            "x_start_fraction": round((int(xs.min()) + x_lo) / cw, 6),
            "x_end_fraction": round((int(xs.max()) + x_lo) / cw, 6),
            "length_fraction_of_zone1": round(
                (int(xs.max()) - int(xs.min()) + 1) / (v1 - 2 * pad), 6),
        })
    return out


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True runs as inclusive (start, end) index pairs."""
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def _centre(run: tuple[int, int]) -> int:
    return int(round((run[0] + run[1]) / 2))


def _width(run: tuple[int, int]) -> int:
    return run[1] - run[0] + 1


if __name__ == "__main__":
    main()
