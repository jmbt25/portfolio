# Phase 3, texture production

Recorded 2026-07-30 on `revamp/graded-collection`. All generation ran on the
local RTX 5070 Ti through ComfyUI at `127.0.0.1:8188`. Nothing went to a cloud
service. Acceptance evidence is in [phase3-evidence/](./phase3-evidence/).

---

## 0. ComfyUI update gate

| Item | Value |
| --- | --- |
| Old hash | `c9602625e445e9ee37d3ac6faf5ea9ec1e0de87e` |
| New hash after pull | `9cf91339b708a245762fa38ffeec9702b381e0db` |
| **Gate result** | **FAILED on the new hash, rolled back, running on the old hash** |

The pull brought 74 files and a `requirements.txt` bump. After installing the
new pins the server would not start:

```
File "comfy/ldm/cosmos/model.py", line 25, in <module>
    from torchvision import transforms
RuntimeError: operator torchvision::nms does not exist
```

torch 2.13.0+cu130 and torchvision 0.28.0+cu130 are a matched pair and both
import cleanly on their own, and so does `comfy.model_base`; the failure only
appears inside `main.py`'s startup sequence. Per the gate rule the repo was
reset to `c9602625` and the pinned requirements reinstalled, rather than spend
the phase debugging an upstream regression.

### A second, unrelated failure surfaced during the rollback

The rolled-back server then failed differently:

```
ImportError: DLL load failed while importing core:
An Application Control policy has blocked this file.
```

This is Windows Smart App Control, not the update. Confirmed by
`VerifiedAndReputablePolicyState: 1` and CodeIntegrity events 3033 and 3077
naming `av\device.pyd` and `av\container\core.pyd` under policy
`{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. The `av` DLLs were dated 19 July and
untouched by either pip run, so the policy verdict changed on its own.

`av` sits on ComfyUI's core import path via
`comfy_api/latest/_input/video_types.py`, so nothing starts without it.
Resolved by installing `av==16.0.0`, which satisfies the existing
`av>=16.0.0` pin and which Smart App Control accepts. **No security setting
was changed or weakened.**

**Worth knowing for the next gate:** the new-hash torchvision failure has the
same shape as a silently blocked native extension, and it happened while Smart
App Control was demonstrably blocking a different `.pyd` in the same venv. The
9cf91339 failure deserves one retry now that `av` is fixed, before it is
treated as an upstream bug.

### Gate steps, as amended

| Step | Result |
| --- | --- |
| Driver test suite | **15 tests, all pass** |
| Trivial 512x512 end to end | **Pass**, 5.13 s, prompt id `69dc71ce-65f2-4e67-9564-376b7ae48b6f` |

MCP route recorded not applicable on this machine, driver sanctioned as the
transport. See [D6](./DECISIONS.md).

Running configuration: ComfyUI 0.28.0, torch 2.13.0+cu130, RTX 5070 Ti 15.9 GB.

---

## A. Card face albedos

`scripts/textures/a_faces.py`, deterministic, no ComfyUI.

| Output | Size | Bytes |
| --- | --- | --- |
| `assets-src/faces/hero-albedo.png` | 1008 x 1408 | 1911232 |
| `assets-src/faces/komikfind-albedo.png` | 1008 x 1408 | 2022678 |
| `assets-src/faces/kalakal-albedo.png` | 1008 x 1408 | 1888019 |
| `assets-src/faces/raidyard-albedo.png` | 1008 x 1408 | 1725198 |
| `assets-src/faces/dotaweakness-albedo.png` | 1008 x 1408 | 1904321 |

Composited at the 2048 master, art placed at the measured window 1096 x 994 at
origin 490,233 through a flood-filled cream mask so the three angular notches
stay frame rather than being cut from the art, text rasterised once at master
scale, then a single Lanczos reduction of the 1260 x 1760 silhouette to
1008 x 1408. Copy is verbatim from the handoff copy deck. JetBrains Mono
throughout; the handoff names no other face for card text.

### Acceptance

| Criterion | Evidence |
| --- | --- |
| Text crisp at 100 percent | [A-five-faces.png](./phase3-evidence/A-five-faces.png), inspected at 1:1 on the ability box and name bar |
| Frame pixels identical across all five | **PASS.** `a_faces.py --verify` diffs the 308806 px that are neither art window, ability box, name bar nor roundel: max abs diff **0**, differing px **0**, on all four pairs |
| Zero studio-name pixels | No studio string appears in any card copy, and all six faces were reviewed visually. See the caveat below |
| Script rerunnable end to end | **PASS.** Full clean rerun from a wiped `build/`, then a second rerun: all 29 outputs byte-identical |

### Two things worth recording

**The roundel figures in the handoff spec do not match the frame.** The spec
quotes card-space centres `101` and `1061` at `y 103`. The frame's actual cream
discs, measured by connected component, are centred at `(131.5, 128.0)` and
`(1134.5, 125.5)` with inner diameters 172 x 169 and 162 x 160. The quoted pair
is not symmetric about the card and does not land on the drawn discs. The
measurement was used. The same measurement pass reproduces the PICKS.md table
for the art window, text box and name bar to the pixel, which is why the
roundel disagreement is read as an error in the quoted figure rather than a
different convention.

**The holo glyph in the right roundel is drawn, not set.** The shipped
JetBrains Mono subset is latin only and carries no character that reads as
starburst, halftone, hex or prismatic, so each is a small vector mark instead.
Sizes and tracking not stated in the spec follow the spec's own rule from
section 02: 0.16em on micro labels, 0 at body sizes.

---

## B. Card back

`scripts/textures/b_back.py` plus one local generation.

| Output | Size | Bytes |
| --- | --- | --- |
| `assets-src/faces/back-albedo.png` | 1008 x 1408 | 1035615 |

[B-card-back.png](./phase3-evidence/B-card-back.png). Original design,
symmetrical radial composition in the set palette, angular chevrons and notched
corners matching clean-minimal, and no text anywhere except the monogram.

**The JMBT monogram is not generated.** The prompt reserves a blank cream
medallion and the monogram is set in JetBrains Mono at master scale into the
detected disc, for the same reason D4 authors the certification label as SVG:
lettering baked by an image model cannot be grepped by the identity guard and
cannot be corrected. This also keeps round two's no-text-in-image-prompts rule.
The medallion is located by connected component, not by a hardcoded position,
and the script refuses to proceed if what it finds is not disc-like: measured
centre (633, 855), radius 248, circle-fill 1.037.

The art is generated at 1264 x 1760 and **cropped**, not resampled, to the
1260 x 1760 master silhouette, so the back still meets exactly one Lanczos
reduction. The silhouette alpha is taken from `frame-src.png` itself, so back
and face share one outline rather than two that nearly agree.

Provenance: workflow `flux2-klein-card-back.api.json`, seed 30500, 8 steps.
Model hashes in [PICKS.md](../design-inputs/PICKS.md).

---

## C. Foil masks

`scripts/textures/c_foilmask.py`, procedural, no ComfyUI.

| Output | Size | Mean | Foil > 128 |
| --- | --- | --- | --- |
| `hero-foilmask.png` | 1008 x 1408 | 43.67 | 16.47 percent |
| `komikfind-foilmask.png` | 1008 x 1408 | 46.27 | 17.64 percent |
| `kalakal-foilmask.png` | 1008 x 1408 | 43.50 | 16.09 percent |
| `raidyard-foilmask.png` | 1008 x 1408 | 53.54 | 21.87 percent |
| `dotaweakness-foilmask.png` | 1008 x 1408 | 41.99 | 15.34 percent |
| `back-foilmask.png` | 1008 x 1408 | 169.07 | 65.95 percent |

Frame holo regions are segmented by alpha and chroma, so the two spines, the
name bar and the roundel rings are selected while the cream panels and the ink
keyline are excluded by measurement rather than by hand-drawn boxes. Art
highlights are unioned in, inside the measured window only, on a soft
percentile ramp so the mask carries a gradient for the raking-light sweep
instead of a binary cut. Reduced through the same crop-then-single-Lanczos path
as the albedo.

### The ragged-edge check the brief asks about

**The first procedural pass was ragged, and it was fixed procedurally. No
generative segmentation was used or needed.**

Taking a percentile straight off raw art luminance produced a mask of thin
wires: the art is flat cel-shaded with thick black outlines, so every
light-against-outline boundary clears any threshold and the mask traces edges
rather than lit regions. `raidyard` was the worst, essentially speckle.

The fix is a 9 px pre-blur before the percentile, so the ramp selects broad lit
areas rather than edges, followed by a grey morphological opening with a 7 px
disc, which deletes any structure narrower than the disc. The result is
coherent highlight regions with no wire and no speckle. Both parameters are
named constants at the top of the script.

---

## D. Seamless holo rebuild

`scripts/textures/d_holo.py`.

| Output | Size | Bytes |
| --- | --- | --- |
| `assets-src/holo/hex-circuit-mesh-height.png` | 1024 x 1024 | 91806 |
| `assets-src/holo/diagonal-prismatic-lines-height.png` | 1024 x 1024 | 230670 |
| `assets-src/holo/cross-hatch-weave-height.png` | 1024 x 1024 | 20449 |
| `assets-src/holo/halftone-comic-dots-height.png` | 1024 x 1024 | 134032 |
| `assets-src/holo/starburst-rays-height.png` | 1024 x 1024 | 116132 |

All five 8-bit grayscale. The Phase 1 `*-base.png` files are kept as the
character reference the rebuilds were matched against.

### Acceptance, 2x2 offset composite judged by eye

The numeric MAD check was not used, per the brief and per the Phase 1 finding
that it disagreed with the eye on four of five.

| Pattern | 2x2 composite | Verdict |
| --- | --- | --- |
| hex-circuit-mesh | [view](./phase3-evidence/D-tile2x2-hex-circuit-mesh.png) | **No seam.** Hexagon lattice, traces and vias continuous across the join |
| diagonal-prismatic-lines | [view](./phase3-evidence/D-tile2x2-diagonal-prismatic-lines.png) | **No seam.** Streak direction and brightness continuous |
| cross-hatch-weave | [view](./phase3-evidence/D-tile2x2-cross-hatch-weave.png) | **No seam.** Ribbon over-under parity continuous |
| halftone-comic-dots | [view](./phase3-evidence/D-tile2x2-halftone-comic-dots.png) | **No seam.** Cell grid continuous |
| starburst-rays | [view](./phase3-evidence/D-tile2x2-starburst-rays.png) | **No seam.** Ray clusters interleave across the join |

Every pattern is periodic **by construction**, not edge-blended: built from
integer-frequency functions of the pixel coordinate, or drawn nine times at
plus and minus one period on each axis so anything crossing an edge is redrawn
on the opposite side. Opposite edges are the same pixels, not similar ones.

### Deviation: the three non-radial patterns are procedural, not generated

The brief asks for hex-circuit, prismatic and weave through seamless-tiling
workflows. **That was attempted first and does not work on this model.**

A seamless-tiling node was written for the local server
(`scripts/textures/comfyui-workflows/portfolio_seamless.py`, switching every
Conv2d in the model and VAE to circular padding, the standard patch). Running
it reports:

```
[portfolio-seamless] mode=circular model_convs=0 vae_convs=72
```

**FLUX.2 Klein is a transformer and has zero Conv2d modules.** Circular padding
can therefore only make the VAE decode continuous; it cannot make the latent
structure wrap, because Klein's spatial mixing is attention, not convolution.
The generated result confirms it:
[D-rejected-comfyui-seamless-2x2.png](./phase3-evidence/D-rejected-comfyui-seamless-2x2.png)
shows hard horizontal and vertical seams and, separately, a loss of the hex
circuit character into a generic dotted grid.

Rather than ship non-tiling maps from a section whose entire purpose is
tiling, all five were built procedurally. The trial generation and its sidecar
are tracked as the evidence. **Flagging this as a method change for review:**
if you want the generative route pursued, it needs a different model, a
UNet-based one with convolutions to patch, or a patch-based synthesis stage.

The two radials were always specified as restructured repeating cells, so those
two follow the brief exactly: a per-cell radial gradient dot grid and a per-cell
ray cluster.

### One pattern needs your call

**`starburst-rays`.** Side-by-side, Phase 1 base left, Phase 3 rebuild right:
[D-sidebyside-starburst-rays.png](./phase3-evidence/D-sidebyside-starburst-rays.png)

The restructure holds the important properties: ray clusters on a repeating
grid, mid-grey all-over field, clusters interleaving rather than sitting
isolated in dead field. The first attempt failed both of the last two and was
rebuilt once, widening the radial envelope past the cell corner and dropping a
second harmonic that was printing a moire lattice between cells.

What is still different from the base: the rebuild is **more mechanical**. The
base has an irregular brushed quality, varied ray lengths and soft waviness;
the rebuild is exactly regular, because exact regularity is what makes it tile.
Whether that reads as the same material is your call, so this one stops here as
the brief instructs.

`halftone-comic-dots` is **not** flagged. Side-by-side:
[D-sidebyside-halftone-comic-dots.png](./phase3-evidence/D-sidebyside-halftone-comic-dots.png).
It keeps the concentric halftone ring structure and the comic dot read clearly.
It is tonally lighter and more regular than the base, which is the same
regularity trade, but the character survives.

---

## E. Normal maps

`scripts/textures/e_normals.py`, deterministic, no ComfyUI.

| Output | Size | Tiling |
| --- | --- | --- |
| `assets-src/normals/hex-circuit-mesh-normal.png` | 1024 x 1024 | tileable |
| `assets-src/normals/diagonal-prismatic-lines-normal.png` | 1024 x 1024 | tileable |
| `assets-src/normals/cross-hatch-weave-normal.png` | 1024 x 1024 | tileable |
| `assets-src/normals/halftone-comic-dots-normal.png` | 1024 x 1024 | tileable |
| `assets-src/normals/starburst-rays-normal.png` | 1024 x 1024 | tileable |
| `assets-src/normals/frame-emboss-normal.png` | 1008 x 1408 | non-tiling |

Holo gradients are taken with `np.roll`, so the derivative wraps and the normal
map stays as seamless as the height map it came from. Taking them without wrap
would have reintroduced at the derivative the exact seam section D removed.
Confirmed by the wrap-versus-interior step being equal or lower on every
pattern, for example `starburst-rays` at 5/5 against an interior 5/5, and
`diagonal-prismatic-lines` at 23/24 against an interior 24/23.

The frame emboss is built from the frame lineart, the ink keyline isolated by
luminance and alpha at 278363 px, 6.64 percent of the master canvas, blurred
into a ridge and differentiated with edge-clamped gradients. It is reduced
through the same crop-then-single-Lanczos path as the albedo, so it lands in
register with the face it belongs to.

---

## F. Packed RG

`scripts/textures/f_packed.py`, deterministic, no ComfyUI.

| Output | Size | R mean | G range |
| --- | --- | --- | --- |
| `assets-src/packed/hero-rg.png` | 504 x 704 | 43.59 | 38..89 |
| `assets-src/packed/komikfind-rg.png` | 504 x 704 | 46.18 | 38..89 |
| `assets-src/packed/kalakal-rg.png` | 504 x 704 | 43.42 | 38..89 |
| `assets-src/packed/raidyard-rg.png` | 504 x 704 | 53.46 | 38..89 |
| `assets-src/packed/dotaweakness-rg.png` | 504 x 704 | 41.91 | 38..89 |
| `assets-src/packed/back-rg.png` | 504 x 704 | 169.08 | 38..89 |

R is the section C foil mask. G is roughness, 0.35 base falling to 0.15 inside
foil, which lands at 89 and 38 in 8-bit. Roughness is **interpolated by the
mask rather than switched on a threshold**, so a partly foiled pixel gets a
partly lowered roughness and the raking-light sweep has somewhere to ramp.
B is 0, unused.

504 x 704 is exactly half the face on both axes, so the reduction is a clean
2:1 with no fractional sampling. `back-rg.png` is included for symmetry with
`back-foilmask.png`; the brief names only the five cards.

No KTX2 compression was performed. That is Phase 4.

---

## Caveats

**The identity guard could not be run.** `scripts/.identity-denylist` does not
exist on this machine, and per D4 the guard fails closed without it. The
denylist is untracked by design and has to be recreated by hand. Nothing in
this phase introduces a studio string: all card copy comes from the handoff
copy deck, the only lettering added anywhere is the four-character monogram on
the back, and every face was reviewed visually. But that is a human check, not
the mechanical one, and the mechanical one is still owed.

**The Phase 3 outputs are not yet wired to anything.** They sit in `assets-src`
for Phase 4 to compress and Phase 5 to consume.

**`av` is pinned at 16.0.0 in the ComfyUI venv,** down from 18.0.0, purely to
get past Smart App Control. If that policy verdict changes again this may need
revisiting, and the failure mode is a hard startup crash, not a degradation.

---

## Reproducing

```
python -m venv .venv-textures
.venv-textures/Scripts/python -m pip install pillow numpy scipy fonttools brotli
cd scripts/textures
python a_faces.py && python a_faces.py --verify
python b_back.py
python c_foilmask.py
python d_holo.py
python e_normals.py
python f_packed.py
```

Sections A, C, E and F need nothing but the repo. Section B consumes the
tracked generation in `scripts/textures/comfyui-workflows/generations/`.
Section D needs nothing; its ComfyUI trial is recorded but not consumed.

To regenerate anything through ComfyUI, start the local server, copy
`scripts/textures/comfyui-workflows/portfolio_seamless.py` into
`ComfyUI/custom_nodes/`, restart, then drive it with
`run_texture_workflow.py`.
