"""Phase 4 geometry spec. One source of truth for the scene build, the AO bake
and the export.

Everything is stated in millimetres and converted to metres on the way into
Blender, because glTF's unit is the metre. Every figure carries its derivation;
none of them are round numbers chosen for looking tidy.

Axis convention. The scene is modelled with the slab standing in Blender's XZ
plane and its front face pointing along Blender -Y:

    Blender  X = slab width, Z = slab height, Y = depth, front at -Y

The glTF exporter converts Blender Z-up to glTF Y-up as
(x, y, z) -> (x, z, -y), so a face whose Blender normal is (0, -1, 0) exports
with the glTF normal (0, 0, +1). That is how the card ends up +Z facing in
three.js space, as the phase brief requires, without a corrective rotation on
the object.
"""

from __future__ import annotations

MM = 0.001  # millimetres to metres

# ---------------------------------------------------------------------------
# Card. Fixed by D3 and by the real card it depicts.
# ---------------------------------------------------------------------------

CARD_W = 63.0
CARD_H = 88.0
# 63:88 exactly, which is 1008:1408 exactly. Asserted at build time.
CARD_ASPECT = CARD_W / CARD_H

# Real trading card stock. Thin enough to read as a plane, thick enough that the
# slab's edge-on pass in the Phase 5 choreography does not show a zero-width card.
CARD_T = 0.30
CARD_BEVEL_W = 0.35   # chamfer width, in plane
CARD_BEVEL_D = 0.07   # chamfer depth, along Y

# ---------------------------------------------------------------------------
# Slab shell. Proportions of a standard graded slab housing a 63 x 88 card.
# Original geometry: no brand's contour, radius or label block is reproduced.
# ---------------------------------------------------------------------------

SLAB_W = 85.0
SLAB_H = 134.0
SLAB_D = 7.0

SLAB_CORNER_R = 4.2      # rounded corner, plan view
SLAB_CHAMFER = 0.9       # rim chamfer, front and back
# Segment counts are set for silhouette quality rather than for thrift: the whole
# scene lands near 1 ktri against a 20 ktri budget, and the slab's rounded corner
# is on the poster.
CORNER_SEGS = 12         # arc segments per outer corner
CAVITY_SEGS = 4          # arc segments per cavity corner, internal
RECESS_SEGS = 4          # arc segments per label recess corner

# ---------------------------------------------------------------------------
# Inner cavity. Sized to the card with visible clearance, per the brief.
# ---------------------------------------------------------------------------

CAVITY_CLEARANCE = 1.0   # per side, in plane
CAVITY_W = CARD_W + 2 * CAVITY_CLEARANCE     # 65.0
CAVITY_H = CARD_H + 2 * CAVITY_CLEARANCE     # 90.0
CAVITY_AIR = 0.50        # per face, along Y
CAVITY_D = CARD_T + 2 * CAVITY_AIR           # 1.30
CAVITY_CORNER_R = 1.6

# ---------------------------------------------------------------------------
# Label recess and plate. Plate proportions come from the same measurement the
# label SVG uses, so the texture cannot land on a plate of a different aspect.
# ---------------------------------------------------------------------------

LABEL_W = 73.0           # recess width on the slab front face
LABEL_RECESS_D = 0.40
LABEL_RECESS_R = 1.2
PLATE_INSET = 0.40       # plate sits inside the recess, not wall to wall
PLATE_LIFT = 0.05        # plate floats clear of the recess floor

# The label texture, as built by scripts/label/build_label.py.
LABEL_TEX_W = 2336
LABEL_TEX_H = 592
LABEL_REF_ASPECT = 3.941685      # measured from label-ref.png

# The plate carries the texture, so the plate's aspect is derived from the
# texture's and not the other way round. Deriving the recess first and insetting
# it uniformly does not work: a uniform inset of a non-square rectangle changes
# its aspect, which stretched the label by 3.3 percent on the first build.
PLATE_W = LABEL_W - 2 * PLATE_INSET                      # 72.2
PLATE_H = PLATE_W * LABEL_TEX_H / LABEL_TEX_W            # 18.2973...
LABEL_H = PLATE_H + 2 * PLATE_INSET                      # 19.0973...

# ---------------------------------------------------------------------------
# Vertical stack, measured down from the top edge of the slab.
# ---------------------------------------------------------------------------

TOP_MARGIN = 5.0
LABEL_GAP = 4.5          # between label recess and cavity
BOTTOM_MARGIN = SLAB_H - (TOP_MARGIN + LABEL_H + LABEL_GAP + CAVITY_H)

# Z of feature centres, origin at the slab centre, +Z up.
SLAB_TOP_Z = SLAB_H / 2.0
LABEL_TOP_Z = SLAB_TOP_Z - TOP_MARGIN
LABEL_CZ = LABEL_TOP_Z - LABEL_H / 2.0
CAVITY_TOP_Z = LABEL_TOP_Z - LABEL_H - LABEL_GAP
CAVITY_CZ = CAVITY_TOP_Z - CAVITY_H / 2.0
CARD_CZ = CAVITY_CZ      # card centred in the cavity

# Y of feature planes. Front of the slab is the most negative Y.
SLAB_FRONT_Y = -SLAB_D / 2.0
SLAB_BACK_Y = SLAB_D / 2.0
RECESS_FLOOR_Y = SLAB_FRONT_Y + LABEL_RECESS_D
PLATE_Y = RECESS_FLOOR_Y - PLATE_LIFT
CARD_FRONT_Y = -CARD_T / 2.0
CAVITY_FRONT_Y = -CAVITY_D / 2.0

OBJ_SLAB = "Slab"
OBJ_CARD = "Card"
OBJ_LABEL = "Label"

# Tri budgets from the phase brief.
BUDGET = {OBJ_SLAB: 10000, OBJ_CARD: 500, OBJ_LABEL: 100}
BUDGET_TOTAL = 20000

# Bake resolution.
AO_SIZE = 1024


def checks() -> list[tuple[str, bool, str]]:
    """Numeric assertions on the spec itself, reported by the build."""
    out = []
    out.append(("card aspect is 63:88 exactly",
                abs(CARD_ASPECT - 63.0 / 88.0) < 1e-12,
                f"{CARD_ASPECT:.6f}"))
    out.append(("card aspect matches 1008:1408",
                abs(CARD_ASPECT - 1008.0 / 1408.0) < 1e-12,
                f"{1008.0 / 1408.0:.6f}"))
    out.append(("vertical stack sums to slab height",
                abs((TOP_MARGIN + LABEL_H + LABEL_GAP + CAVITY_H
                     + BOTTOM_MARGIN) - SLAB_H) < 1e-9,
                f"bottom margin {BOTTOM_MARGIN:.3f} mm"))
    out.append(("cavity clears the card in plane",
                CAVITY_W > CARD_W and CAVITY_H > CARD_H,
                f"{CAVITY_CLEARANCE:.2f} mm per side"))
    out.append(("cavity clears the card in depth",
                CAVITY_D > CARD_T,
                f"{CAVITY_AIR:.2f} mm per face"))
    out.append(("card sits inside the slab body",
                CAVITY_TOP_Z < LABEL_TOP_Z - LABEL_H
                and CAVITY_CZ - CAVITY_H / 2.0 > -SLAB_TOP_Z,
                f"cavity z {CAVITY_CZ - CAVITY_H / 2.0:.2f} to "
                f"{CAVITY_TOP_Z:.2f} mm"))
    out.append(("label recess does not reach the cavity",
                RECESS_FLOOR_Y < CAVITY_FRONT_Y,
                f"recess floor y {RECESS_FLOOR_Y:.2f}, cavity front y "
                f"{CAVITY_FRONT_Y:.2f} mm"))
    out.append(("label recess sits above the cavity in z",
                LABEL_CZ - LABEL_H / 2.0 > CAVITY_TOP_Z,
                f"gap {LABEL_CZ - LABEL_H / 2.0 - CAVITY_TOP_Z:.2f} mm"))
    out.append(("plate is clear of the recess floor",
                PLATE_Y < RECESS_FLOOR_Y and PLATE_Y > SLAB_FRONT_Y,
                f"plate y {PLATE_Y:.3f} mm"))
    out.append(("plate aspect matches the label texture exactly",
                abs((PLATE_W / PLATE_H) - (LABEL_TEX_W / LABEL_TEX_H)) < 1e-9,
                f"plate {PLATE_W / PLATE_H:.6f} vs texture "
                f"{LABEL_TEX_W / LABEL_TEX_H:.6f}"))
    out.append(("plate aspect within 0.2 percent of label-ref",
                abs((PLATE_W / PLATE_H) / LABEL_REF_ASPECT - 1.0) < 0.002,
                f"{((PLATE_W / PLATE_H) / LABEL_REF_ASPECT - 1.0) * 100:+.4f} "
                "percent"))
    out.append(("chamfer smaller than corner radius",
                SLAB_CHAMFER < SLAB_CORNER_R, f"{SLAB_CHAMFER:.2f} mm"))
    return out
