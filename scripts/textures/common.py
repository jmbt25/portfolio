"""
Shared geometry, palette and helpers for the Phase 3 texture pipeline.

Every number here traces to docs/baseline/DECISIONS.md (D3) or
docs/design-inputs/PICKS.md. Nothing is estimated.

Master canvas is 2048 x 2048. The card silhouette is 1260 x 1760 sitting at
offset (394, 144) inside it, which is the measured alpha bounding box of
assets-src/frame-src.png. All compositing happens at master scale and the
finished card is reduced to 1008 x 1408 in a single Lanczos step.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
REPO = Path(__file__).resolve().parents[2]
ASSETS_SRC = REPO / "assets-src"
ART_DIR = ASSETS_SRC / "art"
HOLO_DIR = ASSETS_SRC / "holo"
FACES_DIR = ASSETS_SRC / "faces"
NORMALS_DIR = ASSETS_SRC / "normals"
PACKED_DIR = ASSETS_SRC / "packed"
BUILD = Path(__file__).resolve().parent / "build"
FRAME_SRC = ASSETS_SRC / "frame-src.png"
FONT_TTF = BUILD / "JetBrainsMono-latin.ttf"
FONT_WOFF2 = REPO / "public" / "fonts" / "jetbrains-mono-latin.woff2"

# --------------------------------------------------------------------------
# Scale chain, D3. Verified by arithmetic in the decision record.
# --------------------------------------------------------------------------
MASTER = 2048
CARD_X0, CARD_Y0 = 394, 144
CARD_W, CARD_H = 1260, 1760
TEX_W, TEX_H = 1008, 1408
SCALE = TEX_W / CARD_W  # exactly 0.8 on both axes

# Master-canvas boxes, (x, y, w, h). Measured, PICKS.md "Art window" table.
ART_BOX = (490, 233, 1096, 994)
TEXT_BOX = (521, 1263, 1072, 385)
NAME_BAR = (471, 1693, 1106, 145)

# Roundels, measured from the cream components of frame-src.png rather than
# taken from the handoff figure. The spec quotes "centres 101 and 1061, y 103"
# in card space; the frame's actual cream discs are centred at (131.5, 128.0)
# and (1134.5, 125.5) with inner diameters 172 x 169 and 162 x 160. The quoted
# pair is not symmetric about the card and does not land on the drawn discs,
# so the measurement wins, exactly as it did for the other three panels, whose
# measured boxes reproduce the PICKS.md table to the pixel.
ROUNDEL_D = 190  # outer diameter including the ring, per the spec
ROUNDEL_CENTRES_CARD = ((131.5, 128.0), (1134.5, 125.5))
ROUNDEL_INNER_D = (170.5, 161.0)  # measured cream disc, mean of w and h


def card_to_master(x: float, y: float) -> tuple[float, float]:
    return x + CARD_X0, y + CARD_Y0


ROUNDEL_CENTRES = tuple(card_to_master(*c) for c in ROUNDEL_CENTRES_CARD)

# --------------------------------------------------------------------------
# Palette. Card-only tokens from the handoff spec, section 01.
# --------------------------------------------------------------------------
INK = (18, 17, 16)          # #121110
CREAM = (250, 245, 235)     # #faf5eb frame cream
NAME_YELLOW = (245, 195, 59)  # #f5c33b
SPINE_RED = (244, 38, 36)   # #f42624
SPINE_CYAN = (53, 185, 216)  # #35b9d8

# --------------------------------------------------------------------------
# Card text sizing, "em of card width" from the handoff spec, section 04.
# --------------------------------------------------------------------------
EM = CARD_W  # 1260 at master scale
SIZE_NAME = 0.056 * EM        # 70.56
SIZE_ABILITY_NAME = 0.034 * EM  # 42.84
SIZE_ABILITY_BODY = 0.029 * EM  # 36.54
SIZE_TYPE_LINE = 0.024 * EM   # 30.24
SIZE_ROUNDEL = 0.054 * EM     # 68.04

# Tracking, em of the type size. The name bar figure is stated in the spec.
# The other three follow the spec's own tracking rule from section 02:
# 0.16em on micro labels, 0 at body sizes.
TRACK_NAME = 0.10
TRACK_TYPE_LINE = 0.16
TRACK_ABILITY_NAME = 0.10
TRACK_ABILITY_BODY = 0.0
TRACK_ROUNDEL = 0.0

# --------------------------------------------------------------------------
# The five cards. Copy is verbatim from the handoff copy deck, section 09.
# --------------------------------------------------------------------------
CARDS = [
    dict(
        slug="hero",
        number="01",
        name="JOSHUA",
        type_line="SUPPORT / ENGINEER · 6 YRS",
        ability_name="IDLE ANIMATION",
        ability_body="Sits cross-legged with a laptop. Ships anyway.",
        holo="starburst",
    ),
    dict(
        slug="komikfind",
        number="02",
        name="KOMIKFIND",
        type_line="SEARCH / STAGE 1",
        ability_name="PANEL RECALL",
        ability_body="Search the whole shelf at once. Median search stage "
                     "3.9s to 472ms.",
        holo="halftone",
    ),
    dict(
        slug="kalakal",
        number="03",
        name="KALAKAL",
        type_line="AGENT / SOLANA",
        ability_name="POLICY GATE",
        ability_body="The agent proposes. The executor enforces. DRY_RUN is "
                     "the hard default.",
        holo="hex",
    ),
    dict(
        slug="raidyard",
        number="04",
        name="RAIDYARD",
        type_line="GAME / DEVVIT WEB",
        ability_name="ASYNC RAID",
        ability_body="Resolves inside the post. Deterministic sim, same "
                     "result for every player.",
        holo="prismatic",
    ),
    dict(
        slug="dotaweakness",
        number="05",
        name="DOTAWEAKNESS",
        type_line="ANALYSIS / DOTA 2",
        ability_name="HONEST MODE",
        ability_body="Reveal nine analysis cards. A banned-token validator "
                     "blocks the comforting words.",
        holo="prismatic",
    ),
]


# --------------------------------------------------------------------------
# Font
# --------------------------------------------------------------------------
def ensure_font() -> Path:
    """Decompress the shipped woff2 subset into a TTF PIL can rasterise."""
    if FONT_TTF.exists():
        return FONT_TTF
    from fontTools.ttLib import TTFont

    BUILD.mkdir(parents=True, exist_ok=True)
    f = TTFont(str(FONT_WOFF2))
    f.flavor = None
    f.save(str(FONT_TTF))
    return FONT_TTF


def font_at(size: float, weight: float = 400.0) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(ensure_font()), int(round(size)))
    f.set_variation_by_axes([float(weight)])
    return f


def tracked_width(font: ImageFont.FreeTypeFont, text: str,
                  tracking_em: float, size: float) -> float:
    """Advance width including tracking, with the trailing space removed.

    Dropping the trailing space is what "optically centred" means for a
    tracked run: without it, a centred line sits one space left of centre.
    """
    if not text:
        return 0.0
    extra = tracking_em * size
    return sum(font.getlength(c) for c in text) + extra * (len(text) - 1)


def draw_tracked(draw: ImageDraw.ImageDraw, xy: tuple[float, float],
                 text: str, font: ImageFont.FreeTypeFont, fill,
                 tracking_em: float, size: float, anchor_y: str = "a") -> None:
    """Draw a run character by character so letter-spacing is exact.

    PIL has no letter-spacing, and the name bar spec calls for 0.10em, so the
    advance is applied by hand rather than approximated.
    """
    x, y = xy
    extra = tracking_em * size
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill, anchor="l" + anchor_y)
        x += font.getlength(ch) + extra


def wrap_tracked(font: ImageFont.FreeTypeFont, text: str, max_w: float,
                 tracking_em: float, size: float) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if tracked_width(font, trial, tracking_em, size) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


# --------------------------------------------------------------------------
# Cream-window segmentation
# --------------------------------------------------------------------------
def creaminess(rgb: np.ndarray, tol: float = 26.0) -> np.ndarray:
    """Continuous 1.0-at-cream falloff, so window edges stay antialiased."""
    d = np.linalg.norm(rgb.astype(np.float32) - np.array(CREAM, np.float32),
                       axis=-1)
    return np.clip(1.0 - d / tol, 0.0, 1.0)


def window_component(frame_rgba: np.ndarray, seed_xy: tuple[int, int],
                     tol: float = 60.0) -> np.ndarray:
    """Connected component of cream pixels containing seed_xy.

    This is the measured art window including its three angular notches, which
    is why the notches survive as frame rather than being cut out of the art.
    """
    from scipy import ndimage

    rgb = frame_rgba[..., :3]
    alpha = frame_rgba[..., 3]
    d = np.linalg.norm(rgb.astype(np.float32) - np.array(CREAM, np.float32),
                       axis=-1)
    cream = (d < tol) & (alpha > 200)
    lab, _ = ndimage.label(cream)
    sx, sy = seed_xy
    idx = lab[sy, sx]
    if idx == 0:
        raise RuntimeError(f"No cream component at seed {seed_xy}")
    return lab == idx


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
def reduce_card(master: Image.Image) -> Image.Image:
    """Crop the card silhouette from the master canvas, reduce once."""
    card = master.crop((CARD_X0, CARD_Y0, CARD_X0 + CARD_W, CARD_Y0 + CARD_H))
    return card.resize((TEX_W, TEX_H), Image.LANCZOS)


def save_png(im: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    return path
