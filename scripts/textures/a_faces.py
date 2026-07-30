"""
Section A. Card face albedos, five cards, 1008 x 1408.

Composites frame-src.png, the per-card art and the card text at the 2048
master scale, then reduces the 1260 x 1760 silhouette to 1008 x 1408 in a
single Lanczos step, per D3.

The art is drawn beneath the frame through the measured cream window so the
three angular notches survive as frame rather than being cut out of the art.

    python scripts/textures/a_faces.py
    python scripts/textures/a_faces.py --verify
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image, ImageDraw

from common import (ART_BOX, ART_DIR, CARD_H, CARD_W, CARD_X0, CARD_Y0, CARDS,
                    CREAM, FACES_DIR, FRAME_SRC, INK, MASTER, NAME_BAR,
                    ROUNDEL_CENTRES, ROUNDEL_D, SCALE, SIZE_ABILITY_BODY,
                    SIZE_ABILITY_NAME, SIZE_NAME, SIZE_ROUNDEL,
                    SIZE_TYPE_LINE, TEXT_BOX, TEX_H, TEX_W, TRACK_ABILITY_BODY,
                    TRACK_ABILITY_NAME, TRACK_NAME, TRACK_ROUNDEL,
                    TRACK_TYPE_LINE, creaminess, draw_tracked, font_at,
                    reduce_card, save_png, tracked_width, window_component,
                    wrap_tracked)

# Inner padding of the ability text box, master pixels.
BOX_PAD_X = 34
BODY_LEADING = 1.32


def build_window_mask(frame_rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (hard component mask, soft creaminess) for the art window."""
    ax, ay, aw, ah = ART_BOX
    seed = (ax + aw // 2, ay + ah // 2)
    comp = window_component(frame_rgba, seed)

    from scipy import ndimage
    grown = ndimage.binary_dilation(comp, iterations=3)
    soft = creaminess(frame_rgba[..., :3]) * grown
    return grown, soft


def draw_ability_box(draw: ImageDraw.ImageDraw, card: dict) -> None:
    bx, by, bw, bh = TEXT_BOX
    f_type = font_at(SIZE_TYPE_LINE, 600)
    f_name = font_at(SIZE_ABILITY_NAME, 600)
    f_body = font_at(SIZE_ABILITY_BODY, 400)

    body_lines = wrap_tracked(f_body, card["ability_body"], bw - 2 * BOX_PAD_X,
                              TRACK_ABILITY_BODY, SIZE_ABILITY_BODY)

    # Vertical slots. "Vertically centred, never justified."
    slots: list[tuple] = [
        (card["type_line"], f_type, SIZE_TYPE_LINE, TRACK_TYPE_LINE,
         SIZE_TYPE_LINE * 1.00),
        (None, None, 0, 0, SIZE_TYPE_LINE * 0.52),
        (card["ability_name"], f_name, SIZE_ABILITY_NAME, TRACK_ABILITY_NAME,
         SIZE_ABILITY_NAME * 1.00),
        (None, None, 0, 0, SIZE_ABILITY_NAME * 0.38),
    ]
    for line in body_lines:
        slots.append((line, f_body, SIZE_ABILITY_BODY, TRACK_ABILITY_BODY,
                      SIZE_ABILITY_BODY * BODY_LEADING))

    total = sum(s[4] for s in slots)
    y = by + (bh - total) / 2.0
    for text, font, size, track, adv in slots:
        if text is not None:
            draw_tracked(draw, (bx + BOX_PAD_X, y + adv / 2.0), text, font,
                         INK, track, size, anchor_y="m")
        y += adv


def draw_name_bar(draw: ImageDraw.ImageDraw, card: dict) -> None:
    nx, ny, nw, nh = NAME_BAR
    f = font_at(SIZE_NAME, 600)
    w = tracked_width(f, card["name"], TRACK_NAME, SIZE_NAME)
    x = nx + (nw - w) / 2.0
    draw_tracked(draw, (x, ny + nh / 2.0), card["name"], f, INK, TRACK_NAME,
                 SIZE_NAME, anchor_y="m")


def draw_holo_glyph(draw: ImageDraw.ImageDraw, cx: int, cy: int,
                    kind: str) -> None:
    """Geometric mark naming the card's holo pattern.

    Drawn as vector rather than set as type: the shipped JetBrains Mono subset
    is latin only and carries no symbol that reads as any of these patterns.
    """
    r = SIZE_ROUNDEL * 0.54
    lw = max(2, int(round(SIZE_ROUNDEL * 0.085)))
    if kind == "starburst":
        for i in range(8):
            a = np.pi * i / 4.0
            draw.line([cx - r * np.cos(a), cy - r * np.sin(a),
                       cx + r * np.cos(a), cy + r * np.sin(a)],
                      fill=INK, width=lw)
    elif kind == "halftone":
        step, rad = r * 0.66, r * 0.30
        for gy in (-1, 0, 1):
            offs = (-0.5, 0.5) if gy else (-1, 0, 1)
            for gx in offs:
                d = rad * (1.30 if (gx == 0 and gy == 0) else 0.88)
                draw.ellipse([cx + gx * step - d, cy + gy * step - d,
                              cx + gx * step + d, cy + gy * step + d],
                             fill=INK)
    elif kind == "hex":
        for scale in (1.0, 0.5):
            pts = [(cx + r * scale * np.cos(np.pi / 6 + np.pi * i / 3),
                    cy + r * scale * np.sin(np.pi / 6 + np.pi * i / 3))
                   for i in range(6)]
            draw.polygon(pts, outline=INK, width=lw)
    elif kind == "prismatic":
        for off in (-0.62, 0.0, 0.62):
            draw.line([cx - r + off * r, cy + r, cx + r + off * r, cy - r],
                      fill=INK, width=lw)
    else:
        raise ValueError(f"Unknown holo kind {kind!r}")


def draw_roundels(draw: ImageDraw.ImageDraw, card: dict) -> None:
    (lx, ly), (rx, ry) = ROUNDEL_CENTRES
    f = font_at(SIZE_ROUNDEL, 600)
    w = tracked_width(f, card["number"], TRACK_ROUNDEL, SIZE_ROUNDEL)
    draw_tracked(draw, (lx - w / 2.0, ly), card["number"], f, INK,
                 TRACK_ROUNDEL, SIZE_ROUNDEL, anchor_y="m")
    draw_holo_glyph(draw, rx, ry, card["holo"])


def build_face(card: dict, frame: Image.Image, frame_np: np.ndarray,
               grown: np.ndarray, soft: np.ndarray) -> Image.Image:
    ax, ay, aw, ah = ART_BOX

    # 1. Art layer, at native master-window resolution, no resample.
    art = Image.open(ART_DIR / f"{card['slug']}-art-src.png").convert("RGB")
    if art.size != (aw, ah):
        raise SystemExit(f"{card['slug']} art is {art.size}, expected "
                         f"{(aw, ah)}")
    base = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    base.paste(art, (ax, ay))
    a = np.array(base)
    a[..., 3] = (grown * 255).astype(np.uint8)
    base = Image.fromarray(a)

    # 2. Knock the cream out of the frame so the art shows through the window,
    #    proportionally, so the keyline stays antialiased.
    f = frame_np.astype(np.float32).copy()
    f[..., 3] *= (1.0 - soft)
    frame_cut = Image.fromarray(f.clip(0, 255).astype(np.uint8))

    master = Image.alpha_composite(base, frame_cut)

    # 3. Text, rasterised once at master scale.
    draw = ImageDraw.Draw(master)
    draw_ability_box(draw, card)
    draw_name_bar(draw, card)
    draw_roundels(draw, card)

    # 4. One Lanczos reduction of the finished card.
    return reduce_card(master)


def build_all() -> list:
    frame = Image.open(FRAME_SRC).convert("RGBA")
    if frame.size != (MASTER, MASTER):
        raise SystemExit(f"frame-src is {frame.size}, expected master 2048")
    frame_np = np.array(frame)
    grown, soft = build_window_mask(frame_np)
    print(f"art window component: {int(grown.sum())} px grown mask")

    out = []
    for card in CARDS:
        face = build_face(card, frame, frame_np, grown, soft)
        p = save_png(face, FACES_DIR / f"{card['slug']}-albedo.png")
        print(f"  {p.relative_to(p.parents[2])}  {face.size}  "
              f"{p.stat().st_size} B")
        out.append(p)
    return out


def verify() -> int:
    """Frame pixels must be identical across all five faces.

    Everything that legitimately differs per card is masked out: the art
    window, the ability box, the name bar and the two roundels.
    """
    faces = [np.array(Image.open(FACES_DIR / f"{c['slug']}-albedo.png")
                      .convert("RGBA")).astype(np.int16) for c in CARDS]

    excl = np.zeros((TEX_H, TEX_W), bool)

    def mark(box_master, pad=3):
        x, y, w, h = box_master
        x0 = int((x - CARD_X0) * SCALE) - pad
        y0 = int((y - CARD_Y0) * SCALE) - pad
        x1 = int((x - CARD_X0 + w) * SCALE) + pad
        y1 = int((y - CARD_Y0 + h) * SCALE) + pad
        excl[max(0, y0):y1, max(0, x0):x1] = True

    mark(ART_BOX)
    mark(TEXT_BOX)
    mark(NAME_BAR)
    for cx, cy in ROUNDEL_CENTRES:
        r = ROUNDEL_D / 2 + 4
        mark((cx - r, cy - r, 2 * r, 2 * r), pad=0)

    keep = ~excl
    print(f"frame-only region: {int(keep.sum())} px "
          f"({100 * keep.mean():.1f} percent of the face)")

    worst = 0
    ref = faces[0]
    for card, f in zip(CARDS[1:], faces[1:]):
        d = np.abs(f - ref).max(axis=-1)
        m = int(d[keep].max())
        n = int((d[keep] > 0).sum())
        worst = max(worst, m)
        print(f"  {CARDS[0]['slug']} vs {card['slug']:13s} "
              f"max abs diff {m:3d}  differing px {n}")
    print("PASS: frame pixels identical" if worst == 0 else
          f"FAIL: max diff {worst}")
    return 0 if worst == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    if args.verify:
        sys.exit(verify())
    build_all()
