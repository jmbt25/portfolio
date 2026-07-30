# Phase 4, slab modelling, baking and export

Recorded 2026-07-30 on `revamp/graded-collection`. Every figure below was
produced by running the pipeline, not estimated. Evidence is in
[phase4-evidence/](./phase4-evidence/).

Everything runs headless. Blender is driven by scripted `bpy` through
`blender --background --python`; there is no interactive session anywhere in
this phase and no BlenderMCP bridge. See [D8](./DECISIONS.md).

---

## 0. Preflight

| Check | Result |
| --- | --- |
| Blender on PATH | **Not on PATH.** Found at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, invoked by absolute path, overridable with `BLENDER` |
| Blender version | **5.2.0 LTS**, build hash `fbe6228777e7`, not the 4.x the brief named |
| Headless render | **Pass.** Cycles CPU 320x200 at 16 samples, 38953 B; EEVEE, 31810 B. Confirmed by looking at the image, not by exit code |
| glTF exporter | **Pass.** `io_scene_gltf2` enabled, `export_scene.gltf` present, generator string `Khronos glTF Blender I/O v5.2.39` |
| Draco encoder | **Pass.** Round tripped a cube at position 14, normal 10, uv 12: 1752 B to 1140 B |
| gltf-transform | **Absent, installed.** `npm i -g @gltf-transform/cli`, now 4.4.2. `inspect` decodes Draco, `sharp` native binding loads at libvips 8.15.3 |
| KTX-Software | **Absent, installed.** See below |

### Blender 5.2 rather than 4.x

The brief specified 4.x "for current glTF exporter". 5.2 is newer, and the
requirement's purpose was verified by execution rather than assumed: the
exporter loads, emits a GLB, and drives the Draco encoder at the exact
quantization the brief asks for. Treated as satisfying the requirement.

### The preflight failure, and the stop

`gltf-transform`'s `etc1s` and `uastc` are wrappers, not encoders. Both declare
`Dependencies: KTX-Software`, and neither `toktx` nor `ktx` was present.
KTX-Software is **not in winget**, so it had no one-line install.

Per the brief's "any failure: report and stop", the phase stopped at preflight
rather than modelling first and discovering it at step 4. Unblocked on approval
with `KTX-Software-4.4.2-Windows-x64.exe` from the Khronos GitHub release,
Authenticode signature verified as `CN=The Khronos Group Inc` before running,
sha256 `1F323B0FEC19794F5E6C0425A61D4B1DA396872A10BE862D105F4F4B2D2957FE`.

**The silent install does not register PATH.** It is an NSIS package marked
`requireAdministrator`; `/S` completes with exit 0 and leaves
`C:\Program Files\KTX-Software\bin` off the machine PATH. Every script that
needs it prepends the directory itself. Worth knowing before assuming a green
install means a usable `toktx`.

---

## 1. Geometry

`scripts/blender/spec.py` holds every dimension, `scripts/blender/build_scene.py`
builds from it. Units are millimetres in source and metres in the file, because
glTF's unit is the metre.

### Axis convention

The slab stands in Blender's XZ plane with its front face along Blender -Y. The
exporter converts Z-up to Y-up as `(x, y, z) -> (x, z, -y)`, so a Blender normal
of `(0, -1, 0)` exports as glTF `(0, 0, +1)`. That is how the card ends up **+Z
facing** in three.js space with no corrective rotation on the object.

### Slab

Original geometry. No brand's contour, radius or label block is reproduced.

| Property | Value |
| --- | --- |
| Outer | 85.0 x 134.0 x 7.0 mm |
| Corner radius | 4.2 mm, 12 segments per corner |
| Rim chamfer | 0.9 mm, front and back |
| Cavity | 65.0 x 90.0 x 1.30 mm, corner radius 1.6 mm |
| Cavity clearance | **1.00 mm per side in plane, 0.50 mm per card face** |
| Label recess | 73.0 x 19.097 mm, 0.40 mm deep, corner radius 1.2 mm |

Vertical stack from the top edge, summing to 134.0 mm exactly: 5.0 top margin,
19.097 label recess, 4.5 gap, 90.0 cavity, 15.403 bottom margin.

The cavity is a genuine internal void, not an open pocket: the slab is a closed
outer shell plus an inward-facing inner shell, which is exactly what a boolean
difference against a fully interior cutter produces. It is built directly rather
than solved for, so the vertex count stays as authored. The label recess **is** a
boolean, since a rectangle cut into a rounded-corner face has no clean
hand-authored topology at this budget.

### Card

| Property | Value |
| --- | --- |
| Face | 63.0 x 88.0 mm, exactly 63:88, exactly 1008:1408 |
| Thickness | 0.30 mm, real card stock |
| Front chamfer | 0.35 mm wide, 0.07 mm deep |
| UV | single set, planar XZ, edge to edge |

The card is a thin solid rather than a zero-thickness plane. The brief says
"plane", and 0.30 mm still reads as one, but a real thickness means the Phase 5
edge pass, which rotates the slab to near edge-on, does not show a card of zero
width, and it gives the cavity clearance check something to measure.

Edge to edge means the outer boundary lands on UV 0 and 1 exactly. The chamfer
takes the outermost 0.56 percent of the texture, which is what a real cut edge
does to the print.

### Label plate

Flat inset quad, 72.2 x 18.297 mm, sitting 0.05 mm proud of the recess floor.

**The plate's aspect is derived from the texture, not the other way round.** The
first build sized the recess first and inset it uniformly, which stretched the
label by 3.3 percent: a uniform inset of a non-square rectangle changes its
aspect. The build now asserts plate aspect against texture aspect exactly, and
fails rather than shipping a stretched label.

### Measured result

```
  Slab   tris    568 / 10000  [PASS]  verts   288  dims mm (85.0, 7.0, 134.0)  open edges 0
  Card   tris     20 / 500    [PASS]  verts    12  dims mm (63.0, 0.3, 88.0)   open edges 0
  Label  tris      2 / 100    [PASS]  verts     4  dims mm (72.2, 0.0, 18.297) open edges 4
  total  tris    590 / 20000
```

The label plate's 4 open edges are its boundary; it is a single quad by design.

Orientation is verified by computation, not by argument:

```
  [PASS] slab signed volume 71116.6 mm3, inside 0..79730.0 bbox
        cavity void is 7605.0 mm3 of that, solid without it would be 78721.6
  [PASS] card signed volume 1659.512 mm3, expected about 1663.200
  [PASS] Card  frontmost face normal y = -1.0000
  [PASS] Label frontmost face normal y = -1.0000
  [PASS] Slab  frontmost face normal y = -1.0000
```

**This check exists because the first bake came out solid black.** The card's
front cap had been wound by hand and pointed into the card body, so every AO ray
was cast into solid geometry. Winding is now solved with
`bmesh.ops.recalc_face_normals` and asserted by signed volume, which removes the
whole class of error rather than the one instance of it.

---

## 2. Label

`scripts/label/measure_label_ref.py` then `scripts/label/build_label.py`.

### Precedence, stated once because the sources disagree

- **Zone and rule proportions**: measured from `label-ref.png`, which the handoff
  spec names as the proportion reference.
- **Type sizes and tracking**: from handoff spec section 05, which states them
  explicitly as em of card width.

### Measured from label-ref.png

Content box 1825 x 463 at (111, 21), aspect 3.941685.

| Feature | Measured |
| --- | --- |
| Zone 1 width | 0.618082 of content width |
| Zone 2 width | 0.237808 |
| Zone 3 width | 0.144110 |
| Bottom band height | 0.179266 of content height |
| Copy line centres | 0.1685, 0.3542, 0.5400 of height |

Two measurement traps, both hit and fixed:

- **The grade numeral registers as a zone divider.** "10" is tall enough to cover
  more than 55 percent of the label height, so a coverage test alone finds five
  verticals instead of two. Keylines are discriminated by thickness: 3 to 4 px
  against the numeral's 32 to 68 px.
- **Every copy line measured the same length** until the keyline columns were
  cropped out of the zone slice, because each row picks up ink at both ends.

The dividers were then checked and **do run the full height**, so the bottom band
is three cells, not one. The set line sits in its zone 1 cell.

### Deviations, both deliberate

**Plate aspect follows label-ref, not the 0.23 figure.** Spec section 05 gives
"CERT LABEL 0.23 x CARD W" and also names `label-ref.png` as the proportion
reference. These are not consistent: 0.23 x 63 mm is 14.49 mm, which at
label-ref's 3.9417 aspect implies a label 57.1 mm wide, narrower than the card it
sits above. The measured aspect was used at a slab-appropriate 73 mm width. The
shipped plate is 0.108 percent off label-ref's aspect, from rounding the texture
to dimensions divisible by 4 for block compression.

**The red rule's y is derived, not measured.** Spec section 05 gives zone 1 four
copy lines; label-ref draws three bars. Taking the rule at its measured 0.743 of
height leaves the cert line a 20 px strip for a 14 px cap. The rule and the cert
line now share the slack between the subject line and the bottom band, split
three ways.

**The set line copy is not quoted in the handoff.** `THE GRADED COLLECTION · SET
OF FIVE · 2026` is assembled from the handoff's own language, "The Graded
Collection" and "Five cards, one set".

**The seven-bar block is four horizontals and three verticals**, each stopping
short of one edge so the runs interlock. That is literally the seven bars section
05 names, at the woven character label-ref draws.

### Two SVGs per card, and why

`librsvg` silently falls back to a serif face for `<text>`, because JetBrains
Mono is a repo file and not an installed system font. Verified by rendering it.

- `label-<slug>.svg` carries real `<text>` with per-glyph `x` positions. This is
  the production asset Phase 5 consumes, its copy stays greppable for the D4
  identity guard, and per-glyph positioning removes any dependence on how a
  renderer interprets `letter-spacing`.
- `label-<slug>-paths.svg` is the identical layout with glyphs converted to
  filled paths by fontTools, instanced from the variable font at weight 400 and
  600. This is what gets rasterised, so the texture cannot depend on font
  availability.

Rasterised at **2336 x 592**, twice the 1168 x 296 plate resolution. Both
dimensions divide by 4. Plate resolution is 16 px/mm, the card texture's own
density of 1008 px over 63 mm.

All five labels are built. Only the hero ships to `public/`; the other four are
staged, matching what the brief does with the lazy card textures.

---

## 3. Materials and the AO bake

Materials are bake-only, per the brief. The runtime material is Phase 5's job.

**The card's packed map is wired G to roughness, B to metallic**, which is glTF's
own metallicRoughness channel convention. Driving metallic from R, the foil mask,
is closer to the map's intent, but the Blender exporter cannot express it and the
texture would be dropped from the GLB entirely. Nothing is lost: B is 0 so
metallic reads 0, correct for a paper card, and the foil mask stays in R inside
the shipped KTX2 for the Phase 5 shader. AO is cast geometrically and never
evaluates the surface shader, so the bake is unaffected either way.

### Each object is baked against itself

The other objects' render visibility is switched off for the duration. This is a
deliberate call, and the obvious alternative is wrong here: the card is sealed
inside a cavity whose front wall sits 0.50 mm away, so baking it with the slab
visible occludes every texel and produces a near black map. That is not a
hypothetical, it is what the first bake did.

| Bake | Distance | Result |
| --- | --- | --- |
| `slab-ao.png` | 10 mm | Outer faces open, sealed cavity interior fully occluded, chamfer bands mid grey |
| `card-ao.png` | 2 mm | Near white with the frame emboss ridges self-shadowing |

### The multiply is small, and that is the honest result

```
AO factor: min 0.8667  mean 0.9981  max 1.0000
  pixels below 0.99:  5.808 percent
  pixels below 0.95:  0.932 percent
8-bit delta against the original albedo: max 12, mean 0.0882
  pixels changed at all: 4.989 percent
```

A flat card baked against itself has almost nothing to occlude except its own
chamfer and the emboss ridges. The effect is a light crevice darkening along the
frame lineart, not a dramatic one. Recorded rather than dressed up.

Done in **linear light**: AO is a linear occlusion factor and the albedo is sRGB
encoded, so the albedo is decoded, multiplied, and re-encoded. Output goes to
`assets-src/baked/hero-albedo-ao.png`; the original is never opened for writing.

---

## 4. Export and compression

### Draco is applied twice, and this is not redundant

Blender exports `build/blender/scene.glb` at position 14, normal 10, texcoord 12,
as the brief specifies. Then `gltf-transform uastc` and `etc1s` both **decode
Draco to read the file and do not put it back**, which they say out loud:

```
warn: Decoded KHR_draco_mesh_compression. Further compression will be lossy.
```

`scripts/pack/pack_glb.mjs` re-applies it at the identical quantization, so the
shipped file carries the settings the brief asked for.

### Textures are external, not embedded

The budget is stated as "GLB + hero textures + shared normals summed by ls", and
the normal map is shared across all five cards rather than being per card, so the
textures cannot live inside the GLB. Phase 5 also swaps card faces per beat,
which should be swapping a URL and not rebuilding a GLB.

glTF-Transform's binary writer packs every resource into the BIN chunk, so the
document is written as `.gltf` with external resources first and the GLB is
assembled from that by hand: JSON chunk plus BIN chunk, image URIs left pointing
outward. Only `buffers[0].uri` changes in that transformation, which is why it is
safe to do directly.

### Codec assignment

| Texture | Codec | Rationale |
| --- | --- | --- |
| `hero-albedo` | ETC1S | Albedo, per the brief |
| `label-hero` | ETC1S | Colour |
| `frame-emboss-normal` | UASTC | Normal, per the brief |
| `hero-rg` | **UASTC** | **Deviation.** The brief names normals and albedos; the packed map is neither. It is two-channel data, foil mask and roughness, and ETC1S on that produces channel crosstalk. Treated as data, like a normal map |

### Result

| Texture | PNG | KTX2 | Codec |
| --- | --- | --- | --- |
| `hero-albedo` | 1911232 B | **216130 B** | ETC1S, 8.84x |
| `frame-emboss-normal` | 130337 B | **110863 B** | UASTC, 1.18x |
| `hero-rg` | 71047 B | **74613 B** | UASTC, 0.95x |
| `label-hero` | 58541 B | **38085 B** | ETC1S, 1.54x |

**The packed RG maps get slightly larger, and that is expected.** PNG is very
good at flat two-channel data. The win is GPU-native format: `hero-rg`'s VRAM
footprint drops from 1.89 MB to 473.63 KB, and it needs no CPU decode. The same
holds for the four staged sets, which run 0.90x to 1.16x.

---

## 5. Verification, all by running

### gltf-transform inspect on the shipped file

```
extensionsUsed     KHR_draco_mesh_compression, KHR_materials_ior,
                   KHR_materials_transmission, KHR_texture_basisu
extensionsRequired KHR_draco_mesh_compression, KHR_texture_basisu

MESHES
  Card   TRIANGLES  1 prim   20 glPrimitives   40 verts  u16  NORMAL, POSITION, TEXCOORD_0
  Label  TRIANGLES  1 prim    2 glPrimitives    4 verts  u16  NORMAL, POSITION, TEXCOORD_0
  Slab   TRIANGLES  1 prim  568 glPrimitives  664 verts  u16  NORMAL, POSITION, TEXCOORD_0

MATERIALS
  CardBake              baseColorTexture, normalTexture, metallicRoughnessTexture
  LabelBake             baseColorTexture
  SlabGlassPlaceholder  (none)

TEXTURES
  frame-emboss-normal  ../cards/frame-emboss-normal.ktx2  UASTC  1008x1408  110.86 KB  gpu 1.89 MB
  hero-albedo          ../cards/hero-albedo.ktx2          ETC1S  1008x1408  216.13 KB  gpu 946.15 KB
  hero-rg              ../cards/hero-rg.ktx2              UASTC   504x704    74.61 KB  gpu 473.63 KB
  label-hero-2x        ../cards/label-hero.ktx2           ETC1S  2336x592    38.09 KB  gpu 921.91 KB

ANIMATIONS
  No animations found.
```

### Budgets

| Budget | Limit | Measured | Result |
| --- | --- | --- | --- |
| Total triangles | 20000 | **590** | **PASS** |
| Geometry bytes | 400 KB | **6888 B, 6.7 KB** | **PASS** |
| Hero path, summed | 1.5 MB | **446579 B, 436.1 KB** | **PASS**, 1099.9 KB headroom |

Draw calls: 3 mesh primitives against 3 materials, so three opaque calls, plus
whatever three.js adds for the transmission pass. The render reported 5.

### Headless three.js render

`scripts/verify/render.mjs` drives the installed Chrome over the DevTools
protocol on a raw WebSocket, with SwiftShader for WebGL. Chrome's own
`--screenshot` flag was the simpler option and is **not** used, because it fires
on a timer rather than on the page reporting that it finished: a GLB with Draco
geometry and four transcoded KTX2 textures is not reliably ready inside any fixed
budget, and a screenshot of a half loaded scene that looks plausible is worse
than none.

Pose is the beat 1 hero pose from the handoff choreography, rotateY -16,
rotateX 6, rotateZ -2, read as a real 3D pose.

```
meshes: Card, Label, Slab
material:Card:  MeshStandardMaterial maps=map+normalMap+metalnessMap+roughnessMap
material:Label: MeshStandardMaterial maps=map
material:Slab:  MeshPhysicalMaterial maps=none
bbox_m: 0.0881 x 0.1392 x 0.0449
drawCalls: 5   triangles: 612   textures: 7
probe_centre: 127,126,133   probe_label: 225,223,221   probe_corner: 250,245,238
```

| Criterion | Evidence |
| --- | --- |
| Card seated in slab | [slab-1440x900.png](./phase4-evidence/slab-1440x900.png). The card reads through 3.35 mm of acrylic, so transmission is resolving it, and the 1 mm cavity clearance is visible as an even gap on all four sides |
| Label legible | Every line reads at 1440x900 and all copy is sharp at 2x: `JMBT GRADING`, `JOSHUA`, `DATA SCIENTIST / AI SYSTEMS ENGINEER`, `CERT 2026 0001 · FIRST EDITION`, `GEM MT`, `10` |
| No z-fighting | None visible at either resolution. Asserted numerically at build time as well: minimum card-to-cavity gap 0.500 mm, no coplanar surfaces |

**The dark band around the card is the cavity, not a texture bug.** It was
checked rather than assumed: `hero-albedo.png` is 99.09 percent fully opaque with
an alpha bounding box of the full 1008 x 1408, so the band is the 1 mm clearance
seen through the acrylic. It is darker than a real slab because the sealed void
receives no light from the placeholder material. Phase 5 should lift it with an
interior fill.

---

## The poster

`assets-src/poster/slab-poster-2x-2880x1800.png`, 760987 B.

**This is the canonical poster source**, per the Phase 2 closeout. It is the raw
2x render, uncropped and unoptimised. Phase 5 crops and optimises it, and the
result **replaces `hero-poster-v2.png` for all purposes**.

The handoff names `hero-poster.png` at 824 x 1330, so the crop has a target to
hit. Note the slab material in this render is the **placeholder** glass; if the
poster is meant to show the final material, it needs re-rendering after Phase 5
authors it.

---

## Reproducing

```
node scripts/phase4.mjs           # every step
node scripts/phase4.mjs --from 7  # resume
node scripts/phase4.mjs --list    # list steps
```

Clean run from a wiped `build/`, `public/assets/cards/`, `assets-src/ktx2/`,
`assets-src/baked/`, `assets-src/label/` and `assets-src/poster/`: **54.1 s, exit
0, all twelve steps pass.**

Tool paths are overridable by `BLENDER`, `PY` and `KTX_BIN`. The glTF-Transform
SDK is resolved from the global CLI's vendored copies, so the SDK and the CLI
driving the same pipeline can never drift apart. ESM ignores `NODE_PATH`, so it
is reached through `createRequire` rooted inside the CLI package.

---

## Caveats

**The identity guard still could not be run.** `scripts/.identity-denylist` does
not exist on this machine and per D4 the guard fails closed without it. The
lettering added in this phase is the label copy, which is authored as SVG with
real `<text>` precisely so it stays greppable, and all of it comes from the
handoff copy deck plus the set line noted above. That is a human check, not the
mechanical one, and the mechanical one is still owed.

**The slab material is a placeholder and looks it.** Flat light grey with
transmission. Phase 5 authors the real one, including the fresnel that D1 named
as one of the three beats that justify the renderer.

**`gltf-transform inspect` exits nonzero under PowerShell** after printing its
tables correctly. It is a pager quirk in how the output stream closes, not a
failure; the same command reports exit 0 when the output is captured to a
variable.

**The four staged card sets have not been rendered.** They are converted and
verified as files, but only the hero path has been through the three.js loader.
Phase 5 should expect the first face swap to be the real test.
