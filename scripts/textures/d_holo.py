"""
Section D. Seamless holo rebuild, five patterns, 1024 x 1024 grayscale height.

Every pattern here is periodic by construction: it is built from integer-
frequency functions of the pixel coordinate, or drawn nine times at +/- one
period on each axis, so opposite edges are the same pixels rather than merely
similar ones. Nothing is edge-blended and nothing is retouched at the join.

Halftone and starburst are the two the brief calls for restructuring: they are
rebuilt as repeating cells, a per-cell radial gradient dot grid and a per-cell
ray cluster, rather than as one radial composition retouched at the edges.

The other three were attempted first through a ComfyUI seamless-tiling
workflow, which failed on this model. See PHASE3.md section D for the evidence.

    python scripts/textures/d_holo.py
    python scripts/textures/d_holo.py --tile-test
"""
from __future__ import annotations

import argparse

import numpy as np
from PIL import Image, ImageDraw

from common import HOLO_DIR, save_png

SIZE = 1024
RNG_SEED = 30030


def _norm(a: np.ndarray, lo: float = 0.06, hi: float = 0.96) -> np.ndarray:
    """Normalise to a height range that leaves headroom at both ends."""
    a = a.astype(np.float64)
    a -= a.min()
    if a.max() > 0:
        a /= a.max()
    return lo + a * (hi - lo)


def _grid(size: int = SIZE):
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    return x, y


def _wrapped_draw(size: int, fn) -> np.ndarray:
    """Run a PIL drawing callback nine times at +/- one period per axis.

    Anything crossing an edge is therefore drawn again on the opposite side,
    which makes the result exactly periodic instead of approximately so.
    """
    im = Image.new("F", (size, size), 0.0)
    d = ImageDraw.Draw(im)
    for dx in (-size, 0, size):
        for dy in (-size, 0, size):
            fn(d, dx, dy)
    return np.array(im)


# --------------------------------------------------------------------------
# 1. hex-circuit-mesh
# --------------------------------------------------------------------------
def hex_circuit_mesh(size: int = SIZE, nx: int = 16, ny: int = 18) -> np.ndarray:
    """Hexagon walls as the Voronoi boundary of a staggered lattice.

    A sum of three cosines was tried first and only ever produces circles at
    any threshold, so the cells are cut as a real Voronoi diagram instead.
    ny must be even for the row stagger to wrap; 16 x 18 puts the cell aspect
    within 2.6 percent of a regular hexagon.
    """
    x, y = _grid(size)
    W, H = size / nx, size / ny

    j = np.round(y / H)
    i = np.round((x - (j % 2) * W / 2) / W)
    d1 = np.full((size, size), np.inf)
    d2 = np.full((size, size), np.inf)
    for dj in (-1, 0, 1):
        jj = j + dj
        for di in (-1, 0, 1):
            cx = (i + di) * W + (jj % 2) * W / 2
            cy = jj * H
            ddx = (x - cx + size / 2) % size - size / 2
            ddy = (y - cy + size / 2) % size - size / 2
            d = np.hypot(ddx, ddy)
            d2 = np.minimum(d2, np.maximum(d1, d))
            d1 = np.minimum(d1, d)

    wall = d2 - d1                       # zero exactly on the cell boundary
    edge = np.exp(-(wall ** 2) / 12.0)   # crisp hexagon outline
    cell = np.clip(1.0 - d1 / (0.62 * W), 0.0, 1.0) ** 0.7

    rng = np.random.default_rng(RNG_SEED)
    px, py = W, H

    def traces(d, dx, dy):
        for _ in range(38):
            cx = rng.integers(0, nx) * px
            cy = rng.integers(0, ny) * py
            pts = [(cx + dx, cy + dy)]
            for _ in range(rng.integers(3, 8)):
                ang = rng.choice([0, 60, 120, 180, 240, 300]) * np.pi / 180
                ln = rng.integers(1, 4) * px
                cx += ln * np.cos(ang)
                cy += ln * np.sin(ang)
                pts.append((cx + dx, cy + dy))
            d.line(pts, fill=1.0, width=4, joint="curve")
            for p in pts[::2]:
                d.ellipse([p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8], fill=1.0)

    tr = _wrapped_draw(size, traces)
    # Mid-grey field with the lattice reading as relief, matching the Phase 1
    # base rather than the near-black first attempt.
    h = 0.46 + 0.20 * cell + 0.30 * edge + 0.34 * np.clip(tr, 0, 1)
    return _norm(h, 0.10, 0.94)


# --------------------------------------------------------------------------
# 2. diagonal-prismatic-lines
# --------------------------------------------------------------------------
def diagonal_prismatic_lines(size: int = SIZE) -> np.ndarray:
    x, y = _grid(size)
    # (x - y) puts the streaks on the same diagonal as the Phase 1 base.
    u = (x - y) % size
    v = (x + y) % size
    rng = np.random.default_rng(RNG_SEED + 1)
    h = np.zeros((size, size))
    # Stacked integer frequencies: broad prisms, then finer striations.
    for period, amp in ((128, 0.55), (64, 0.30), (32, 0.20), (16, 0.10),
                        (8, 0.06)):
        phase = rng.uniform(0, 2 * np.pi)
        h += amp * np.cos(2 * np.pi * u / period + phase)
    # Bright flares at irregular but periodic intervals, so the streaks vary
    # in strength the way the Phase 1 base does instead of reading as a comb.
    for period, amp, ph in ((256, 0.30, 0.7), (85.33, 0.18, 2.1),
                            (36.57, 0.12, 4.4)):
        h += amp * np.cos(2 * np.pi * u / period + ph) ** 3
    # A slow envelope along the perpendicular axis varies streak brightness
    # without breaking periodicity.
    h *= 0.74 + 0.26 * np.cos(2 * np.pi * v / size * 3)
    h += 0.14 * np.cos(2 * np.pi * u / 4)
    return _norm(h)


# --------------------------------------------------------------------------
# 3. cross-hatch-weave
# --------------------------------------------------------------------------
def cross_hatch_weave(size: int = SIZE) -> np.ndarray:
    x, y = _grid(size)
    P, L = 32.0, 2                         # ribbon width, ribbons per group
    u, v = (x + y) % size, (x - y) % size
    iu, iv = np.floor(u / P), np.floor(v / P)
    # Grouping L ribbons per block is what makes this read as a basket weave
    # rather than as a checkerboard. P * L divides 1024, so it still wraps.
    over = ((np.floor(iu / L) + np.floor(iv / L)) % 2) == 0

    def ribbon(t):
        f = (t % P) / P                    # 0..1 across the ribbon
        dome = np.sin(np.pi * f) ** 0.65   # rounded ribbon section
        strie = 0.10 * np.cos(2 * np.pi * f * 7)
        return dome + strie

    ru, rv = ribbon(u), ribbon(v)
    h = np.where(over, 0.62 + 0.38 * ru, 0.30 + 0.30 * rv)
    # Fine striations run along each ribbon, across its perpendicular axis.
    h += 0.05 * np.where(over, np.cos(2 * np.pi * v / 8),
                         np.cos(2 * np.pi * u / 8))
    return _norm(h)


# --------------------------------------------------------------------------
# 4. halftone-comic-dots, restructured as a repeating cell
# --------------------------------------------------------------------------
def halftone_comic_dots(size: int = SIZE, cell: int = 256) -> np.ndarray:
    """Per-cell radial gradient dot grid.

    Dot pitch is constant, dot radius falls off with distance from the cell
    centre, which is what produces the concentric halftone read of the Phase 1
    base. Every cell is identical, so the field tiles exactly.
    """
    x, y = _grid(size)
    pitch = cell / 16.0
    # Position within the dot lattice, with alternate rows offset.
    row = np.floor(y / pitch)
    xo = x + (row % 2) * (pitch / 2)
    dx = (xo % pitch) - pitch / 2
    dy = (y % pitch) - pitch / 2
    d = np.hypot(dx, dy)

    # Radial distance from the nearest cell centre, on the torus.
    cx = (x % cell) - cell / 2
    cy = (y % cell) - cell / 2
    r = np.hypot(cx, cy) / (cell / 2)

    # Concentric rings modulate dot radius: bright open centre, dense mid,
    # opening out again toward the cell corner.
    # 1.8 rings per cell radius rather than 2.6, which keeps the open bright
    # centre large the way the Phase 1 base has it.
    ring = 0.5 + 0.5 * np.cos(np.pi * np.clip(r, 0, 1.42) * 1.8)
    radius = pitch * (0.12 + 0.30 * ring)
    dot = 1.0 / (1.0 + np.exp((d - radius) * 3.0))
    # Sit the dots on a mid-grey field. The first pass ran nearly binary,
    # which is wrong for a height map: the foil needs relief, not a stencil.
    base = 0.40 + 0.22 * ring
    return _norm(base + 0.42 * dot, 0.12, 0.93)


# --------------------------------------------------------------------------
# 5. starburst-rays, restructured as a repeating cell
# --------------------------------------------------------------------------
def starburst_rays(size: int = SIZE, cell: int = 256) -> np.ndarray:
    """Ray clusters on a jittered lattice, summed over the torus.

    The previous build placed one identical cluster per cell and said so in its
    own docstring: "Every cell is identical, so the field tiles exactly." It
    does tile, and that is the problem. Sixteen identical bursts on a perfect
    4 x 4 lattice, tiled again three times across the card, is a mechanical
    grid, and under the foil shader's view-angle hue term it moires into
    regular banding across the whole face. That is Phase 5 falsifier A, which
    came out false against the first build. See PHASE5.md.

    The fix the falsifier names is seeded per-cell jitter, done here as:

      * each of the sixteen centres is displaced by up to 0.22 of a cell
      * ray count varies per centre over 16, 18, 20, 22, so no two clusters
        share an angular frequency
      * each centre carries its own phase, radius and amplitude

    Continuity is why this sums nine neighbours instead of switching
    parameters on `x % cell`. Per-cell parameters keyed off the cell index
    change discontinuously at the cell boundary and print a visible seam
    lattice, which trades one grid for another. Summing smooth radial
    contributions from every centre in the 3 x 3 neighbourhood leaves the
    field continuous everywhere.

    Periodicity is unchanged: the centre set repeats with period `size` and
    every contribution is evaluated on the wrapped offset, so opposite edges
    are still the same pixels. The wrap check in build_all() proves it rather
    than trusting this note.
    """
    x, y = _grid(size)
    n_side = size // cell
    rng = np.random.default_rng(RNG_SEED)

    field = np.zeros((size, size), dtype=np.float64)
    core_field = np.zeros((size, size), dtype=np.float64)

    for iy in range(n_side):
        for ix in range(n_side):
            jx = (ix + 0.5 + rng.uniform(-0.22, 0.22)) * cell
            jy = (iy + 0.5 + rng.uniform(-0.22, 0.22)) * cell
            spokes = int(rng.choice([16, 18, 20, 22]))
            phase = rng.uniform(0, 2 * np.pi)
            reach = cell / 2 * rng.uniform(1.42, 1.80)
            amp = rng.uniform(0.82, 1.18)

            # Nine placements, so a cluster whose reach crosses an edge is
            # drawn again on the far side and the sum stays periodic.
            for ox in (-size, 0, size):
                for oy in (-size, 0, size):
                    dx = x - (jx + ox)
                    dy = y - (jy + oy)
                    rr = np.hypot(dx, dy)
                    near = rr < reach
                    if not near.any():
                        continue
                    th = np.arctan2(dy, dx)
                    rays = (0.5 + 0.5 * np.cos(th * spokes + phase)) ** 0.75
                    env = np.clip(1.0 - rr / reach, 0.0, 1.0) ** 0.38
                    field += amp * (rays - 0.5) * env
                    core_field += amp * np.exp(-(rr ** 2) / (0.008 * (cell / 2) ** 2))

    # Mid-grey ground with moderate contrast, matching the brushed foil read of
    # the Phase 1 base rather than spokes on black.
    h = 0.52 + 0.26 * field + 0.14 * np.clip(core_field, 0.0, 1.0)
    return _norm(h, 0.16, 0.92)


PATTERNS = {
    "hex-circuit-mesh": hex_circuit_mesh,
    "diagonal-prismatic-lines": diagonal_prismatic_lines,
    "cross-hatch-weave": cross_hatch_weave,
    "halftone-comic-dots": halftone_comic_dots,
    "starburst-rays": starburst_rays,
}


def build_all() -> dict:
    out = {}
    for name, fn in PATTERNS.items():
        a = fn()
        im = Image.fromarray((a * 255).round().clip(0, 255).astype(np.uint8),
                             "L")
        p = save_png(im, HOLO_DIR / f"{name}-height.png")
        # Exact periodicity check: compare the wrap-around neighbour pairs.
        arr = np.array(im).astype(np.int16)
        wrap_v = int(np.abs(arr[0, :] - arr[-1, :]).max())
        wrap_h = int(np.abs(arr[:, 0] - arr[:, -1]).max())
        inner_v = int(np.abs(arr[0, :] - arr[1, :]).max())
        inner_h = int(np.abs(arr[:, 0] - arr[:, 1]).max())
        print(f"  {name:26s} {im.size} {p.stat().st_size:>8} B   "
              f"wrap step v/h {wrap_v:3d}/{wrap_h:3d}   "
              f"interior step v/h {inner_v:3d}/{inner_h:3d}")
        out[name] = p
    return out


def tile_test() -> None:
    """2x2 offset composite, the check the brief asks be judged by eye."""
    d = HOLO_DIR / "tile-test"
    for name in PATTERNS:
        a = np.array(Image.open(HOLO_DIR / f"{name}-height.png").convert("L"))
        h, w = a.shape
        rolled = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
        save_png(Image.fromarray(np.tile(rolled, (2, 2))),
                 d / f"{name}-height-tile2x2.png")
    print(f"  2x2 offset composites written to {d}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile-test", action="store_true")
    a = ap.parse_args()
    if a.tile_test:
        tile_test()
    else:
        build_all()
        tile_test()
