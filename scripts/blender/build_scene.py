"""Phase 4 step 1 and 2: build the slab, card and label plate as one scripted
scene, wire the bake-only materials, save the .blend.

Headless only. Run as:

    blender --background --factory-startup \
        --python scripts/blender/build_scene.py -- --out build/blender

Geometry is built with bmesh from the figures in spec.py rather than with
interactive operators, so the result is deterministic and reviewable as source.
The one exception is the label recess, which is a boolean difference; a rectangle
cut into a rounded-corner face has no clean hand-authored topology at this poly
budget, and Blender's exact solver is reliable for an axis-aligned box.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec  # noqa: E402
from spec import MM  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
FACES = REPO / "assets-src" / "faces"
NORMALS = REPO / "assets-src" / "normals"
PACKED = REPO / "assets-src" / "packed"
LABELS = REPO / "assets-src" / "label"


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------

def rounded_rect(hw: float, hh: float, r: float, segs: int) -> list[tuple[float, float]]:
    """Rounded rectangle in the XZ plane, counterclockwise, as (x, z) pairs.

    Offsetting the profile inward by d is exactly rounded_rect(hw-d, hh-d, r-d),
    which is what the rim chamfer uses. That only holds for a true offset, which
    is why the profile is generated parametrically instead of being scaled.
    """
    r = max(0.0, min(r, min(hw, hh)))
    pts: list[tuple[float, float]] = []
    corners = (
        (hw - r, hh - r, 0.0),
        (-(hw - r), hh - r, 90.0),
        (-(hw - r), -(hh - r), 180.0),
        (hw - r, -(hh - r), 270.0),
    )
    for cx, cz, a0 in corners:
        for i in range(segs + 1):
            a = math.radians(a0 + 90.0 * i / segs)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def add_ring(bm: bmesh.types.BMesh, profile, y: float, cz: float = 0.0):
    return [bm.verts.new((x * MM, y * MM, (z + cz) * MM)) for x, z in profile]


def bridge(bm: bmesh.types.BMesh, a: list, b: list, flip: bool = False) -> None:
    """Quad band between two equal-length closed vertex loops."""
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        verts = [a[i], a[j], b[j], b[i]]
        if flip:
            verts.reverse()
        bm.faces.new(verts)


def cap(bm: bmesh.types.BMesh, ring: list, flip: bool = False) -> None:
    verts = list(reversed(ring)) if flip else list(ring)
    bm.faces.new(verts)


def recalc_outward(bm: bmesh.types.BMesh) -> None:
    """Make a closed shell's normals consistently outward.

    Hand-reasoning the winding of every cap and bridge is how the first bake came
    out inverted: the card's front cap pointed into the card body, so every AO ray
    was cast into solid geometry and the map baked black. Solving orientation by
    computation instead of by argument removes that whole class of error.
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def flip_all(bm: bmesh.types.BMesh) -> None:
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def signed_volume(obj: bpy.types.Object) -> float:
    """Signed volume in mm^3. Positive means the normals face outward overall."""
    me = obj.data
    total = 0.0
    for poly in me.polygons:
        vs = [me.vertices[i].co / MM for i in poly.vertices]
        for i in range(1, len(vs) - 1):
            a, b, c = vs[0], vs[i], vs[i + 1]
            total += a.dot(b.cross(c))
    return total / 6.0


def finish(bm: bmesh.types.BMesh, name: str) -> bpy.types.Object:
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------------------
# Slab
# ---------------------------------------------------------------------------

def build_slab_shell() -> bpy.types.Object:
    """Outer shell: rounded-corner box with a chamfered rim, closed manifold."""
    s = spec
    hw, hh = s.SLAB_W / 2.0, s.SLAB_H / 2.0
    c = s.SLAB_CHAMFER

    outer = rounded_rect(hw, hh, s.SLAB_CORNER_R, s.CORNER_SEGS)
    inset = rounded_rect(hw - c, hh - c, s.SLAB_CORNER_R - c, s.CORNER_SEGS)

    bm = bmesh.new()
    r0 = add_ring(bm, inset, s.SLAB_FRONT_Y)          # front chamfer lip
    r1 = add_ring(bm, outer, s.SLAB_FRONT_Y + c)      # front of the straight wall
    r2 = add_ring(bm, outer, s.SLAB_BACK_Y - c)       # back of the straight wall
    r3 = add_ring(bm, inset, s.SLAB_BACK_Y)           # back chamfer lip

    bridge(bm, r0, r1)
    bridge(bm, r1, r2)
    bridge(bm, r2, r3)
    cap(bm, r0)
    cap(bm, r3)
    recalc_outward(bm)

    obj = finish(bm, spec.OBJ_SLAB)
    _orient(obj)
    return obj


def build_cavity_shell() -> bpy.types.Object:
    """The internal void, as an inverted rounded box.

    A boolean difference of a cutter that touches nothing produces exactly this:
    the outer shell unchanged plus an inward-facing inner shell. Building it
    directly skips a solver call whose result is already known, and keeps the
    cavity's vertex count exactly what was authored.
    """
    s = spec
    hw, hh = s.CAVITY_W / 2.0, s.CAVITY_H / 2.0
    prof = rounded_rect(hw, hh, s.CAVITY_CORNER_R, s.CAVITY_SEGS)

    bm = bmesh.new()
    front = add_ring(bm, prof, s.CAVITY_FRONT_Y, s.CAVITY_CZ)
    back = add_ring(bm, prof, -s.CAVITY_FRONT_Y, s.CAVITY_CZ)
    bridge(bm, front, back)
    cap(bm, front)
    cap(bm, back)
    # The solid's material lies outside this shell, so the void's boundary
    # normals point into the void: outward for the shell, then reversed.
    recalc_outward(bm)
    flip_all(bm)
    return finish(bm, "CavityShell")


def build_recess_cutter() -> bpy.types.Object:
    """Box that cuts the label recess into the front face."""
    s = spec
    hw, hh = s.LABEL_W / 2.0, s.LABEL_H / 2.0
    prof = rounded_rect(hw, hh, s.LABEL_RECESS_R, s.RECESS_SEGS)

    bm = bmesh.new()
    # Starts outside the slab so the cut face is clean, ends at the recess floor.
    front = add_ring(bm, prof, s.SLAB_FRONT_Y - 1.0, s.LABEL_CZ)
    back = add_ring(bm, prof, s.RECESS_FLOOR_Y, s.LABEL_CZ)
    bridge(bm, front, back)
    cap(bm, front)
    cap(bm, back)
    recalc_outward(bm)
    return finish(bm, "RecessCutter")


def build_slab() -> bpy.types.Object:
    shell = build_slab_shell()
    cutter = build_recess_cutter()

    mod = shell.modifiers.new("LabelRecess", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter

    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.modifier_apply(modifier="LabelRecess")

    bpy.data.objects.remove(cutter, do_unlink=True)

    # Join the cavity in after the boolean, so the solver never sees it.
    cavity = build_cavity_shell()
    _join(shell, cavity)

    _shade(shell, angle_deg=32.0)
    return shell


def _join(target: bpy.types.Object, other: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    other.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def _shade(obj: bpy.types.Object, angle_deg: float) -> None:
    """Smooth shading limited by angle, so the rounded corners read round and the
    chamfers stay crisp. Blender 4.1 removed use_auto_smooth in favour of the
    modifier, so both paths are handled."""
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(angle_deg)
        return
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except (AttributeError, RuntimeError) as exc:
        print(f"  note: shade_smooth_by_angle unavailable ({exc}), "
              "falling back to flat shading on the shell")
        for poly in obj.data.polygons:
            poly.use_smooth = False


# ---------------------------------------------------------------------------
# Card
# ---------------------------------------------------------------------------

def build_card() -> bpy.types.Object:
    """Thin card with a chamfered front rim. Pivot centred, front face at -Y.

    UVs are a single planar XZ projection over the full 63 x 88 extent, so the
    texture maps edge to edge: the outer boundary lands on 0 and 1 exactly, and
    the chamfer takes the outermost 0.56 percent of the texture, which is what a
    real cut edge does to the print.
    """
    s = spec
    hw, hh = s.CARD_W / 2.0, s.CARD_H / 2.0
    bw = s.CARD_BEVEL_W

    outer = [(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)]
    inner = [(hw - bw, hh - bw), (-(hw - bw), hh - bw),
             (-(hw - bw), -(hh - bw)), (hw - bw, -(hh - bw))]

    bm = bmesh.new()
    front_in = add_ring(bm, inner, s.CARD_FRONT_Y, s.CARD_CZ)
    front_out = add_ring(bm, outer, s.CARD_FRONT_Y + s.CARD_BEVEL_D, s.CARD_CZ)
    back_out = add_ring(bm, outer, -s.CARD_FRONT_Y, s.CARD_CZ)

    cap(bm, front_in)                # front face, toward -Y after recalc
    bridge(bm, front_in, front_out)  # front chamfer
    bridge(bm, front_out, back_out)  # side wall
    cap(bm, back_out)                # back face

    recalc_outward(bm)
    bm.normal_update()
    uv = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            co = loop.vert.co
            u = (co.x / MM + hw) / s.CARD_W
            v = (co.z / MM - s.CARD_CZ + hh) / s.CARD_H
            loop[uv].uv = (u, v)

    obj = finish(bm, spec.OBJ_CARD)
    _recentre(obj, Vector((0.0, 0.0, s.CARD_CZ * MM)))
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


# ---------------------------------------------------------------------------
# Label plate
# ---------------------------------------------------------------------------

def build_label() -> bpy.types.Object:
    """Flat inset quad on the recess floor, front facing, UV edge to edge."""
    s = spec
    hw, hh = s.PLATE_W / 2.0, s.PLATE_H / 2.0

    bm = bmesh.new()
    ring = add_ring(bm, [(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)],
                    s.PLATE_Y, s.LABEL_CZ)
    cap(bm, ring)
    bm.normal_update()
    # An open surface has no outward, so the plate's facing is set by measurement
    # rather than by recalc: it must look out of the recess, along -Y.
    if next(iter(bm.faces)).normal.y > 0.0:
        flip_all(bm)

    bm.normal_update()
    uv = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for loop in face.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x / MM + hw) / s.PLATE_W,
                           (co.z / MM - s.LABEL_CZ + hh) / s.PLATE_H)

    obj = finish(bm, spec.OBJ_LABEL)
    _recentre(obj, Vector((0.0, s.PLATE_Y * MM, s.LABEL_CZ * MM)))
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def _recentre(obj: bpy.types.Object, world_origin: Vector) -> None:
    """Move the object's origin to world_origin without moving the geometry."""
    for v in obj.data.vertices:
        v.co -= world_origin
    obj.location = world_origin


def _orient(obj: bpy.types.Object) -> None:
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)


# ---------------------------------------------------------------------------
# UVs for the slab, needed by the AO bake
# ---------------------------------------------------------------------------

def uv_unwrap_slab(obj: bpy.types.Object) -> None:
    """Smart-project the slab. The cavity walls and the front face must not share
    texels or the cavity AO would overwrite the front face AO, so a hand-rolled
    cube projection is not usable here and a real packer is."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0),
                             island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------------------
# Materials, for bake only
# ---------------------------------------------------------------------------

def assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    """Give the object exactly one material slot holding mat.

    Appending is not enough. Joining the cavity shell, which carries no material,
    leaves the slab with an empty slot 0, so a plain append lands the real
    material in slot 1 and every downstream lookup of materials[0] gets None.
    Every polygon is repointed at slot 0 as well, since clearing the slots would
    otherwise leave indices dangling.
    """
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0
    if len(obj.data.materials) != 1 or obj.data.materials[0] is None:
        raise SystemExit(f"{obj.name}: material assignment did not take")


def _new_material(name: str) -> bpy.types.Material:
    """Blender 5.2 deprecates Material.use_nodes and makes materials node based
    by default; 4.x needs the flag set. Touch it only when it is still needed."""
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    return mat


def _img(path: Path, non_colour: bool) -> bpy.types.Image:
    if not path.exists():
        raise SystemExit(f"missing texture input: {path}")
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_colour else "sRGB"
    return img


def material_card() -> bpy.types.Material:
    """Hero albedo, frame emboss normal, packed RG. Bake-only per the brief.

    The packed map is R = foil mask, G = roughness, B = 0, per PHASE3 section F.

    Roughness takes G and metallic takes B, which is glTF's own
    metallicRoughness channel convention. That matters because it is the one
    wiring the Blender exporter recognises as a single metallicRoughnessTexture;
    driving metallic from R instead, which is the foil mask, would be closer to
    the map's intent but the exporter cannot express it and the texture would be
    dropped from the GLB entirely.

    Nothing is lost. B is 0 so metallic reads 0 everywhere, which is correct for
    a paper card, and the foil mask stays in R inside the shipped KTX2 for the
    Phase 5 shader to read. The AO bake is unaffected either way, since AO is cast
    geometrically and never evaluates the surface shader.
    """
    mat = _new_material("CardBake")
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    albedo = nt.nodes.new("ShaderNodeTexImage")
    normal_tex = nt.nodes.new("ShaderNodeTexImage")
    normal_map = nt.nodes.new("ShaderNodeNormalMap")
    rg = nt.nodes.new("ShaderNodeTexImage")
    sep = nt.nodes.new("ShaderNodeSeparateColor")

    albedo.image = _img(FACES / "hero-albedo.png", non_colour=False)
    albedo.label = "hero-albedo"
    normal_tex.image = _img(NORMALS / "frame-emboss-normal.png", non_colour=True)
    normal_tex.label = "frame-emboss-normal"
    rg.image = _img(PACKED / "hero-rg.png", non_colour=True)
    rg.label = "hero-rg"

    nt.links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
    nt.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(rg.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    for i, n in enumerate((albedo, normal_tex, rg, sep, normal_map, bsdf, out)):
        n.location = (-1100 + i * 190, 0)
    return mat


def material_slab() -> bpy.types.Material:
    """Placeholder physical glass. Nothing is baked from this but AO."""
    mat = _new_material("SlabGlassPlaceholder")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.045
    bsdf.inputs["IOR"].default_value = 1.49   # cast acrylic
    for name, value in (("Transmission Weight", 1.0), ("Metallic", 0.0),
                        ("Alpha", 1.0)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = value
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.location = (-220, 0)
    mat.use_backface_culling = False
    return mat


def material_label() -> bpy.types.Material:
    mat = _new_material("LabelBake")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = _img(LABELS / "label-hero-2x.png", non_colour=False)
    tex.label = "label-hero-2x"
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    tex.location, bsdf.location, out.location = (-620, 0), (-260, 0), (0, 0)
    return mat


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def tri_count(obj: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def non_manifold_edges(obj: bpy.types.Object) -> int:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    n = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    bm.free()
    return n


def report(objs: dict[str, bpy.types.Object]) -> bool:
    ok = True
    print("\n=== spec checks ===")
    for label, passed, detail in spec.checks():
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}: {detail}")
        ok = ok and passed

    print("\n=== geometry ===")
    total = 0
    for name, obj in objs.items():
        tris = tri_count(obj)
        total += tris
        budget = spec.BUDGET[name]
        within = tris <= budget
        ok = ok and within
        dims = tuple(round(d / MM, 3) for d in obj.dimensions)
        nm = non_manifold_edges(obj)
        slots = [s.material.name if s.material else None
                 for s in obj.material_slots]
        mat_ok = len(slots) == 1 and slots[0] is not None
        ok = ok and mat_ok
        print(f"  {name:6s} tris {tris:6d} / {budget:<6d} "
              f"[{'PASS' if within else 'OVER'}]  verts "
              f"{len(obj.data.vertices):5d}  dims mm {dims}  "
              f"open edges {nm}  uv sets {len(obj.data.uv_layers)}  "
              f"mats {slots} [{'PASS' if mat_ok else 'FAIL'}]")
    print(f"  total  tris {total:6d} / {spec.BUDGET_TOTAL}")
    ok = ok and total <= spec.BUDGET_TOTAL

    print("\n=== orientation ===")
    bbox_vol = spec.SLAB_W * spec.SLAB_H * spec.SLAB_D
    cav_vol = spec.CAVITY_W * spec.CAVITY_H * spec.CAVITY_D
    v_slab = signed_volume(objs[spec.OBJ_SLAB])
    v_card = signed_volume(objs[spec.OBJ_CARD])
    slab_ok = 0.0 < v_slab < bbox_vol
    card_ok = v_card > 0.0
    ok = ok and slab_ok and card_ok
    print(f"  [{'PASS' if slab_ok else 'FAIL'}] slab signed volume "
          f"{v_slab:.1f} mm3, inside 0..{bbox_vol:.1f} bbox")
    print(f"        cavity void is {cav_vol:.1f} mm3 of that, solid without it "
          f"would be {v_slab + cav_vol:.1f}")
    print(f"  [{'PASS' if card_ok else 'FAIL'}] card signed volume "
          f"{v_card:.3f} mm3, expected about "
          f"{spec.CARD_W * spec.CARD_H * spec.CARD_T:.3f}")

    front_normals = {
        spec.OBJ_CARD: _front_normal_y(objs[spec.OBJ_CARD]),
        spec.OBJ_LABEL: _front_normal_y(objs[spec.OBJ_LABEL]),
        spec.OBJ_SLAB: _front_normal_y(objs[spec.OBJ_SLAB]),
    }
    for name, ny in front_normals.items():
        faces = ny < -0.9
        ok = ok and faces
        print(f"  [{'PASS' if faces else 'FAIL'}] {name} frontmost face normal "
              f"y = {ny:+.4f}, wanted -1 so it exports +Z facing")

    print("\n=== clearances, measured from the built meshes ===")
    card = objs[spec.OBJ_CARD]
    slab = objs[spec.OBJ_SLAB]
    cw = _world_bounds(card)
    sw = _world_bounds(slab)
    print(f"  card world bbox mm  x {cw[0][0]:.2f}..{cw[1][0]:.2f}  "
          f"y {cw[0][1]:.2f}..{cw[1][1]:.2f}  z {cw[0][2]:.2f}..{cw[1][2]:.2f}")
    print(f"  slab world bbox mm  x {sw[0][0]:.2f}..{sw[1][0]:.2f}  "
          f"y {sw[0][1]:.2f}..{sw[1][1]:.2f}  z {sw[0][2]:.2f}..{sw[1][2]:.2f}")
    inside = (cw[0][0] > sw[0][0] and cw[1][0] < sw[1][0]
              and cw[0][1] > sw[0][1] and cw[1][1] < sw[1][1]
              and cw[0][2] > sw[0][2] and cw[1][2] < sw[1][2])
    print(f"  [{'PASS' if inside else 'FAIL'}] card fully inside the slab bbox")
    ok = ok and inside

    gap_front = (spec.CAVITY_FRONT_Y - cw[0][1])
    gap_side = (cw[0][0] - (-spec.CAVITY_W / 2.0))
    gap_top = (spec.CAVITY_TOP_Z - cw[1][2])
    print(f"  cavity to card gap mm: front {abs(gap_front):.3f}, "
          f"side {abs(gap_side):.3f}, top {abs(gap_top):.3f}")
    nz = min(abs(gap_front), abs(gap_side), abs(gap_top)) > 0.05
    print(f"  [{'PASS' if nz else 'FAIL'}] every gap over 0.05 mm, "
          "so no coplanar surfaces to z-fight")
    ok = ok and nz
    return ok


def _front_normal_y(obj: bpy.types.Object) -> float:
    """Normal y of the polygon whose centre sits furthest toward -Y.

    For the slab that is the label recess floor or the front face; either way it
    has to look out of the slab, not into it.
    """
    me = obj.data
    best, best_y = None, None
    for poly in me.polygons:
        c = obj.matrix_world @ poly.center
        if best_y is None or c.y < best_y:
            best, best_y = poly, c.y
    return (obj.matrix_world.to_3x3() @ best.normal).normalized().y


def _world_bounds(obj: bpy.types.Object):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = [min(p[i] for p in pts) / MM for i in range(3)]
    hi = [max(p[i] for p in pts) / MM for i in range(3)]
    return lo, hi


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build/blender")
    args = ap.parse_args(argv)

    out_dir = (REPO / args.out) if not os.path.isabs(args.out) else Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # No animation anywhere in this scene, neutral pose only.
    scene.frame_start = scene.frame_end = scene.frame_current = 1

    print("building slab")
    slab = build_slab()
    print("building card")
    card = build_card()
    print("building label plate")
    label = build_label()

    print("unwrapping slab for the AO bake")
    uv_unwrap_slab(slab)

    assign_material(slab, material_slab())
    assign_material(card, material_card())
    assign_material(label, material_label())

    objs = {spec.OBJ_SLAB: slab, spec.OBJ_CARD: card, spec.OBJ_LABEL: label}
    ok = report(objs)

    blend = out_dir / "scene.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print(f"\nsaved {blend}")
    print(f"scene objects: {sorted(o.name for o in scene.objects)}")
    print("BUILD OK" if ok else "BUILD FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
