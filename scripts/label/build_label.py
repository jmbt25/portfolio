"""Build the production certification label as SVG, then rasterise at 2x plate
resolution for the Phase 4 label plate texture.

Two SVGs are emitted per card, from one layout pass:

  label-<slug>.svg        real <text> elements with per-glyph x positions.
                          This is the production asset Phase 5 consumes, and its
                          copy stays greppable so the D4 identity guard can read
                          it. Per-glyph x removes any dependence on how a
                          renderer interprets letter-spacing.

  label-<slug>-paths.svg  the identical layout with every glyph converted to a
                          filled path by fontTools. This is what gets
                          rasterised, because JetBrains Mono is not installed as
                          a system font and librsvg silently falls back to a
                          serif face for <text>. Verified: it does.

Precedence rule for the geometry, stated once here because the two sources
disagree:

  zone and rule proportions   measured from label-ref.png, via
                              measure_label_ref.py. label-ref.png is named the
                              proportion reference by the handoff spec.
  type sizes and tracking     from handoff spec section 05, which states them
                              explicitly as em of card width.

    python scripts/label/build_label.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

REPO = Path(__file__).resolve().parents[2]
FONT_TTF = REPO / "scripts" / "textures" / "build" / "JetBrainsMono-latin.ttf"
MEASURED = REPO / "assets-src" / "label" / "label-ref-measured.json"
OUT_DIR = REPO / "assets-src" / "label"

# ---------------------------------------------------------------------------
# Plate geometry. See docs/baseline-v1/PHASE4.md for the derivation.
# ---------------------------------------------------------------------------

CARD_W_MM = 63.0            # card width, the em base for every type size
PLATE_W_MM = 73.0           # label plate width on the slab
PX_PER_MM = 16.0            # 1008 px / 63 mm, the card texture's own density

# Plate height follows label-ref.png's measured aspect rather than the spec's
# "0.23 x card width", because those two figures are not consistent with each
# other. Recorded as a deviation in PHASE4.md.
PLATE_H_MM = PLATE_W_MM / 3.941685

PLATE_W = int(round(PLATE_W_MM * PX_PER_MM))     # 1168
PLATE_H = int(round(PLATE_H_MM * PX_PER_MM))     # 296
SCALE_2X = 2

# Type sizes, em of card width, handoff spec section 05.
EM = {
    "grading": 0.026,
    "name": 0.044,
    "subject": 0.023,
    "cert": 0.020,
    "gem": 0.021,
    "grade": 0.098,
    "set": 0.018,
}
TRACKING = {
    "grading": 0.20,        # spec states 0.20em tracking on line 1
    "name": 0.10,           # spec section 04 name bar convention, uppercase
    "subject": 0.06,
    "cert": 0.08,
    "gem": 0.16,            # micro label, spec section 02 rule
    "grade": -0.04,         # spec states -0.04em on the grade numeral
    "set": 0.16,            # micro label
}
WEIGHT = {
    "grading": 400,
    "name": 600,
    "subject": 400,
    "cert": 400,
    "gem": 600,
    "grade": 600,
    "set": 400,
}

INK = "#121110"
RED = "#e0201c"
GROUND = "#ffffff"

CARDS = [
    {
        "slug": "hero",
        "number": "01",
        "name": "JOSHUA",
        "subject": "DATA SCIENTIST / AI SYSTEMS ENGINEER",
        "cert": "CERT 2026 0001 · FIRST EDITION",
    },
    {
        "slug": "komikfind",
        "number": "02",
        "name": "KOMIKFIND",
        "subject": "SEMANTIC MANGA SEARCH",
        "cert": "CERT 2026 0002 · FIRST EDITION",
    },
    {
        "slug": "kalakal",
        "number": "03",
        "name": "KALAKAL",
        "subject": "AUTONOMOUS SOLANA TRADING AGENT",
        "cert": "CERT 2026 0003 · FIRST EDITION",
    },
    {
        "slug": "raidyard",
        "number": "04",
        "name": "RAIDYARD",
        "subject": "ASYNC BASE RAID INSIDE REDDIT",
        "cert": "CERT 2026 0004 · FIRST EDITION",
    },
    {
        "slug": "dotaweakness",
        "number": "05",
        "name": "DOTAWEAKNESS",
        "subject": "DOTA 2 SELF ANALYSIS",
        "cert": "CERT 2026 0005 · FIRST EDITION",
    },
]

GRADE_LABEL = "GEM MT"
GRADE_NUMERAL = "10"
# The handoff copy deck does not quote a set line verbatim. This is assembled
# from its own language, "The Graded Collection" and "Five cards, one set".
SET_LINE = "THE GRADED COLLECTION · SET OF FIVE · 2026"


class Face:
    """A static instance of the variable font at one weight."""

    def __init__(self, path: Path, weight: int) -> None:
        base = TTFont(str(path))
        self.font = instancer.instantiateVariableFont(base, {"wght": weight})
        self.upem = self.font["head"].unitsPerEm
        self.cap = self.font["OS/2"].sCapHeight
        self.cmap = self.font.getBestCmap()
        self.glyphs = self.font.getGlyphSet()
        self.hmtx = self.font["hmtx"]

    def gname(self, ch: str) -> str:
        cp = ord(ch)
        if cp not in self.cmap:
            raise SystemExit(
                f"glyph missing for U+{cp:04X} ({ch!r}) in the shipped latin "
                "subset. Refusing to substitute silently."
            )
        return self.cmap[cp]

    def advance(self, ch: str, size: float) -> float:
        return self.hmtx[self.gname(ch)][0] * size / self.upem

    def cap_height(self, size: float) -> float:
        return self.cap * size / self.upem


def positions(face: Face, text: str, size: float, tracking_em: float,
              x: float) -> tuple[list[float], float]:
    """Per-character x positions and the run's total advance width."""
    extra = tracking_em * size
    xs: list[float] = []
    cur = x
    for ch in text:
        xs.append(cur)
        cur += face.advance(ch, size) + extra
    width = cur - x - extra if text else 0.0
    return xs, width


def glyph_paths(face: Face, text: str, size: float, xs: list[float],
                baseline: float) -> str:
    """Concatenated outline path data for a positioned run."""
    s = size / face.upem
    parts: list[str] = []
    for ch, gx in zip(text, xs):
        if ch == " ":
            continue
        pen = SVGPathPen(face.glyphs, ntos=lambda v: f"{v:.3f}")
        tp = TransformPen(pen, (s, 0.0, 0.0, -s, gx, baseline))
        face.glyphs[face.gname(ch)].draw(tp)
        d = pen.getCommands()
        if d:
            parts.append(d)
    return " ".join(parts)


def esc(t: str) -> str:
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build(card: dict, m: dict) -> tuple[str, str]:
    """Return (text_svg, paths_svg) for one card."""
    faces = {w: Face(FONT_TTF, w) for w in sorted(set(WEIGHT.values()))}

    W, H = float(PLATE_W), float(PLATE_H)
    zf = m["zone_x_fractions"]
    keyline = max(1.0, round(0.00192 * W, 2))     # measured 3.5 px of 1825
    red_h = round(0.019438 * H, 2)                # measured 9 px of 463

    z1_w = zf["zone1_w"] * W
    z2_w = zf["zone2_w"] * W
    z2_x = z1_w
    z3_x = z1_w + z2_w
    z3_w = W - z3_x

    band_y = (1.0 - m["bottom_band"]["height_fraction"]) * H
    red_y = m["red_rule"]["y_fraction"] * H
    bars = [b["y_centre_fraction"] * H for b in m["text_bars"]]
    if len(bars) != 3:
        raise SystemExit(f"expected 3 measured copy lines, got {len(bars)}")

    left = m["text_bars"][0]["x_start_fraction"] * W

    text_els: list[str] = []
    path_els: list[str] = []

    def run(key: str, text: str, x: float, centre_y: float,
            colour: str = INK, align: str = "left",
            cell_w: float | None = None, limit: float | None = None) -> None:
        size = EM[key] * CARD_W_MM * PX_PER_MM
        face = faces[WEIGHT[key]]
        tr = TRACKING[key]
        _, width = positions(face, text, size, tr, 0.0)
        if limit is not None and width > limit:
            raise SystemExit(
                f"{key} run {text!r} measures {width:.1f} px against a "
                f"{limit:.1f} px cell. Refusing to emit a clipped label."
            )
        if align == "centre" and cell_w is not None:
            x = x + (cell_w - width) / 2.0
        xs, _ = positions(face, text, size, tr, x)
        baseline = centre_y + face.cap_height(size) / 2.0
        text_els.append(
            f'  <text x="{" ".join(f"{v:.2f}" for v in xs)}" '
            f'y="{baseline:.2f}" font-family="JetBrains Mono" '
            f'font-size="{size:.2f}" font-weight="{WEIGHT[key]}" '
            f'fill="{colour}" xml:space="preserve">{esc(text)}</text>'
        )
        d = glyph_paths(face, text, size, xs, baseline)
        if d:
            path_els.append(f'  <path fill="{colour}" d="{d}"/>')

    # Zone 1, three copy lines on the measured bar centres.
    z1_cell = z1_w - left - keyline
    run("grading", "JMBT GRADING", left, bars[0], limit=z1_cell)
    run("name", card["name"], left, bars[1], limit=z1_cell)
    run("subject", card["subject"], left, bars[2], limit=z1_cell)

    # The red rule and the cert line share the slack between the subject line and
    # the bottom band divider, split three ways so the cert line is not pinched.
    #
    # The measured red rule sits at 0.743 of height, but that position was drawn
    # against label-ref's three placeholder bars. Spec section 05 gives zone 1
    # four copy lines, so the fourth has to come from somewhere: taking the rule
    # at its measured y leaves the cert line a 20 px strip for a 14 px cap, which
    # renders but reads as an error. The rule is derived instead, and
    # measured_red_rule_y is reported for the record.
    subject_size = EM["subject"] * CARD_W_MM * PX_PER_MM
    subject_bottom = bars[2] + faces[WEIGHT["subject"]].cap_height(subject_size) / 2
    cert_size = EM["cert"] * CARD_W_MM * PX_PER_MM
    cert_cap = faces[WEIGHT["cert"]].cap_height(cert_size)
    slack = (band_y - subject_bottom - red_h - cert_cap) / 3.0
    if slack <= 0:
        raise SystemExit("zone 1 cannot fit the rule and the cert line")
    rule_cy = subject_bottom + slack + red_h / 2.0
    cert_cy = rule_cy + red_h / 2.0 + slack + cert_cap / 2.0

    rx0 = m["red_rule"]["x_start_fraction"] * W
    rx1 = m["red_rule"]["x_end_fraction"] * W
    rule = (f'  <rect x="{rx0:.2f}" y="{rule_cy - red_h / 2:.2f}" '
            f'width="{rx1 - rx0:.2f}" height="{red_h:.2f}" fill="{RED}"/>')

    run("cert", card["cert"], left, cert_cy, limit=z1_cell)

    # Zone 2, grade block. GEM MT sits above the numeral, both centred.
    gem_size = EM["gem"] * CARD_W_MM * PX_PER_MM
    grade_size = EM["grade"] * CARD_W_MM * PX_PER_MM
    gem_cy = bars[0]
    grade_cy = (gem_cy + gem_size / 2 + band_y) / 2.0
    run("gem", GRADE_LABEL, z2_x, gem_cy, align="centre", cell_w=z2_w)
    run("grade", GRADE_NUMERAL, z2_x, grade_cy, align="centre", cell_w=z2_w)

    # Zone 3, seven-bar verification block. Four horizontal bars interleaved
    # with three vertical bars: seven bars per the spec, woven per label-ref.
    weave = _weave(z3_x, z3_w, band_y, keyline)

    # Bottom band, set line in the zone 1 cell. The dividers run full height in
    # label-ref, measured, so the band is three cells and not one.
    run("set", SET_LINE, left, (band_y + H) / 2.0, limit=z1_cell)

    # Divisions: outer keyline plus the two zone verticals, full height.
    k = keyline
    frame = [
        f'  <rect x="0" y="0" width="{W:.0f}" height="{H:.0f}" fill="{GROUND}"/>',
        f'  <rect x="0" y="0" width="{W:.0f}" height="{k:.2f}" fill="{INK}"/>',
        f'  <rect x="0" y="{H - k:.2f}" width="{W:.0f}" height="{k:.2f}" fill="{INK}"/>',
        f'  <rect x="0" y="0" width="{k:.2f}" height="{H:.0f}" fill="{INK}"/>',
        f'  <rect x="{W - k:.2f}" y="0" width="{k:.2f}" height="{H:.0f}" fill="{INK}"/>',
        f'  <rect x="{z2_x - k / 2:.2f}" y="0" width="{k:.2f}" height="{H:.0f}" fill="{INK}"/>',
        f'  <rect x="{z3_x - k / 2:.2f}" y="0" width="{k:.2f}" height="{H:.0f}" fill="{INK}"/>',
        f'  <rect x="0" y="{band_y - k / 2:.2f}" width="{W:.0f}" height="{k:.2f}" fill="{INK}"/>',
    ]

    head = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{PLATE_W}" '
        f'height="{PLATE_H}" viewBox="0 0 {PLATE_W} {PLATE_H}">\n'
        f'  <title>JMBT GRADING certification label, {card["number"]} '
        f'{card["name"]}</title>\n'
    )
    body_common = "\n".join(frame) + "\n" + rule + "\n" + "\n".join(weave) + "\n"
    text_svg = head + body_common + "\n".join(text_els) + "\n</svg>\n"
    paths_svg = head + body_common + "\n".join(path_els) + "\n</svg>\n"
    return text_svg, paths_svg


def _weave(x: float, w: float, top_h: float, k: float) -> list[str]:
    """Seven-bar verification block, original geometry.

    Four horizontals and three verticals on one square, each bar stopping short
    of one edge so the runs read as interlocked rather than as a plain grid. That
    is the woven character label-ref.png draws, at literally the seven bars spec
    section 05 names.
    """
    side = min(w, top_h) * 0.56
    cx = x + w / 2.0
    cy = top_h / 2.0
    x0, y0 = cx - side / 2.0, cy - side / 2.0
    bar = side / 15.0
    out: list[str] = []

    # Horizontals: alternate which edge they run to.
    for i, fy in enumerate((0.06, 0.32, 0.58, 0.84)):
        by = y0 + fy * side
        if i % 2 == 0:
            bx, length = x0, side * 0.86
        else:
            length = side * 0.86
            bx = x0 + side - length
        out.append(f'  <rect x="{bx:.2f}" y="{by:.2f}" width="{length:.2f}" '
                   f'height="{bar:.2f}" fill="{INK}"/>')

    # Verticals: same trick on the other axis, so the crossings alternate.
    for j, fx in enumerate((0.19, 0.45, 0.71)):
        bx = x0 + fx * side
        if j % 2 == 0:
            length = side * 0.86
            by = y0 + side - length
        else:
            by, length = y0, side * 0.86
        out.append(f'  <rect x="{bx:.2f}" y="{by:.2f}" width="{bar:.2f}" '
                   f'height="{length:.2f}" fill="{INK}"/>')
    return out


def rasterise(svg: Path, png: Path, w: int, h: int) -> None:
    node_root = subprocess.run(["npm", "root", "-g"], capture_output=True,
                               text=True, shell=True).stdout.strip()
    script = (
        "const sharp=require('sharp');"
        f"sharp({json.dumps(str(svg))},{{density:72*{SCALE_2X}}})"
        f".resize({w},{h},{{fit:'fill'}})"
        ".png({compressionLevel:9})"
        f".toFile({json.dumps(str(png))})"
        ".then(i=>console.log('  raster',i.width+'x'+i.height,'->',"
        f"{json.dumps(png.name)}))"
        ".catch(e=>{console.error('sharp failed:',e.message);process.exit(1);});"
    )
    env_node_path = {"NODE_PATH": node_root}
    import os
    env = dict(os.environ)
    env.update(env_node_path)
    r = subprocess.run([_node(), "-e", script], env=env, capture_output=True,
                       text=True)
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit("rasterisation failed")


def _node() -> str:
    from shutil import which
    n = which("node")
    if not n:
        raise SystemExit("node not on PATH")
    return n


def main() -> None:
    if not MEASURED.exists():
        raise SystemExit(
            f"{MEASURED} missing. Run scripts/label/measure_label_ref.py first."
        )
    m = json.loads(MEASURED.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"plate {PLATE_W} x {PLATE_H} px "
          f"({PLATE_W_MM} x {PLATE_H_MM:.3f} mm at {PX_PER_MM} px/mm)")
    print(f"plate aspect {PLATE_W / PLATE_H:.4f} against reference "
          f"{m['content_aspect']:.4f}")
    print(f"2x raster {PLATE_W * SCALE_2X} x {PLATE_H * SCALE_2X}\n")

    for card in CARDS:
        text_svg, paths_svg = build(card, m)
        tp = OUT_DIR / f"label-{card['slug']}.svg"
        pp = OUT_DIR / f"label-{card['slug']}-paths.svg"
        tp.write_text(text_svg, encoding="utf-8")
        pp.write_text(paths_svg, encoding="utf-8")
        print(f"{card['slug']}: {tp.name} {len(text_svg)} B, "
              f"{pp.name} {len(paths_svg)} B")
        rasterise(pp, OUT_DIR / f"label-{card['slug']}-2x.png",
                  PLATE_W * SCALE_2X, PLATE_H * SCALE_2X)


if __name__ == "__main__":
    main()
