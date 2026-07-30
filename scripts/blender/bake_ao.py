"""Phase 4 step 3a: bake ambient occlusion for the slab and the card at 1024.

    blender --background --factory-startup \
        --python scripts/blender/bake_ao.py -- --blend build/blender/scene.blend

Each object is baked against itself, with the other objects' render visibility
switched off for the duration. That is a deliberate call and it needs stating,
because the obvious alternative is wrong here: the card is sealed inside a cavity
whose front wall sits 0.50 mm away, so baking the card with the slab visible
occludes essentially every texel and produces a near black map. Self occlusion
gives what the multiply is actually for, the darkening along the card's cut edge.

The slab's own bake is the interesting one, since the label recess and the
internal cavity are real concavities in a single mesh.

AO is written with a Non-Color colourspace, so the PNG holds the raw linear
occlusion factor rather than an sRGB encoded one. composite_ao.py depends on
that.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "assets-src" / "baked"

# AO ray distance per object, in metres. Sized to the feature each one has to
# resolve: the card's only concavity is its 0.35 mm chamfer, the slab's are a
# 0.40 mm recess and a 1.30 mm cavity.
AO_DISTANCE = {spec.OBJ_CARD: 0.002, spec.OBJ_SLAB: 0.010}
SAMPLES = 256
MARGIN = 8


def ensure_world(scene: bpy.types.Scene) -> None:
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")


def bake_object(name: str, size: int) -> Path:
    scene = bpy.context.scene
    obj = bpy.data.objects[name]

    img = bpy.data.images.new(f"AO_{name}", width=size, height=size,
                              alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"

    mat = obj.data.materials[0]
    nt = mat.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.label = f"AO target {name}"
    node.location = (400, 400)
    nt.nodes.active = node

    hidden = []
    for other in scene.objects:
        if other is obj or other.type != "MESH":
            continue
        hidden.append((other, other.hide_render))
        other.hide_render = True

    scene.world.light_settings.distance = AO_DISTANCE[name]

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    print(f"  baking {name} at {size}x{size}, distance "
          f"{AO_DISTANCE[name] * 1000:.1f} mm, {SAMPLES} samples")
    bpy.ops.object.bake(type="AO", use_clear=True, margin=MARGIN,
                        use_selected_to_active=False)

    for other, prev in hidden:
        other.hide_render = prev

    out = OUT_DIR / f"{name.lower()}-ao.png"
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()

    nt.nodes.remove(node)
    return out


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", default="build/blender/scene.blend")
    ap.add_argument("--size", type=int, default=spec.AO_SIZE)
    args = ap.parse_args(argv)

    blend = (REPO / args.blend) if not os.path.isabs(args.blend) else Path(args.blend)
    if not blend.exists():
        raise SystemExit(f"{blend} missing. Run build_scene.py first.")

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    ensure_world(scene)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = MARGIN

    print(f"baking AO from {blend.name}")
    written = []
    for name in (spec.OBJ_SLAB, spec.OBJ_CARD):
        written.append(bake_object(name, args.size))

    print("\n=== baked ===")
    ok = True
    for p in written:
        exists = p.exists()
        size = p.stat().st_size if exists else 0
        ok = ok and exists and size > 0
        print(f"  {p.relative_to(REPO)}  {size} B  "
              f"[{'PASS' if exists and size else 'FAIL'}]")
    print("BAKE OK" if ok else "BAKE FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
