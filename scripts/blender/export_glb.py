"""Phase 4 step 4a: export the scene to GLB with Draco.

    blender --background --factory-startup \
        --python scripts/blender/export_glb.py -- --blend build/blender/scene.blend

Quantization is the brief's: position 14, normal 10, texcoord 12.

This writes the Blender side of the pipeline only. scripts/pack/pack_glb.mjs
takes it from here, converts the textures to KTX2, moves them out to external
files and writes the shipped public/assets/models/slab.glb.
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

DRACO = {
    "export_draco_mesh_compression_enable": True,
    "export_draco_mesh_compression_level": 6,
    "export_draco_position_quantization": 14,
    "export_draco_normal_quantization": 10,
    "export_draco_texcoord_quantization": 12,
    "export_draco_color_quantization": 10,
    "export_draco_generic_quantization": 12,
}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", default="build/blender/scene.blend")
    ap.add_argument("--out", default="build/blender/scene.glb")
    args = ap.parse_args(argv)

    blend = (REPO / args.blend) if not os.path.isabs(args.blend) else Path(args.blend)
    out = (REPO / args.out) if not os.path.isabs(args.out) else Path(args.out)
    if not blend.exists():
        raise SystemExit(f"{blend} missing. Run build_scene.py first.")
    out.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=str(blend))

    names = sorted(o.name for o in bpy.context.scene.objects if o.type == "MESH")
    print(f"exporting {names}")
    if names != sorted([spec.OBJ_SLAB, spec.OBJ_CARD, spec.OBJ_LABEL]):
        raise SystemExit(f"unexpected scene contents: {names}")

    opts = dict(
        filepath=str(out),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_skins=False,
        export_morph=False,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
    )
    opts.update(DRACO)

    # Blender's exporter drops unknown keywords with a hard error rather than a
    # warning, and the option set moves between releases. Retry without any
    # argument the running build does not recognise instead of failing the phase.
    while True:
        try:
            bpy.ops.export_scene.gltf(**opts)
            break
        except TypeError as exc:
            msg = str(exc)
            bad = [k for k in list(opts) if k in msg and k != "filepath"]
            if not bad:
                raise
            for k in bad:
                print(f"  note: this Blender does not accept {k}, dropping it")
                opts.pop(k)

    size = out.stat().st_size
    print(f"\nwrote {out.relative_to(REPO)}  {size} B")
    print("EXPORT OK" if size > 0 else "EXPORT FAILED")
    sys.exit(0 if size > 0 else 1)


if __name__ == "__main__":
    main()
