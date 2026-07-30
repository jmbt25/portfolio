# Phase 1 picks

Post-processing of the round-two Codex generations. Every measurement below was
produced by running the analysis, not by reading or estimating. Source images
live in `output/imagegen/`, processed output in `assets-src/`.

Recorded 2026-07-30 on `revamp/graded-collection`.

---

## Frame winner

**`tcg-frame-clean-minimal`**, processed to `assets-src/frame-src.png`.

Thin black keyline, red left spine with dot and chevron detail, cyan right
spine, two corner roundels, yellow bottom name bar.

| Property | Measured |
| --- | --- |
| Source | 2048 x 2048, opaque, `#00ff00` key |
| Silhouette bounds | x 394 to 1653, y 144 to 1903 |
| Silhouette size | **1260 x 1760** |
| Measured aspect | **0.715909** |
| Target 63:88 | 0.715909 |
| Deviation | **+0.0000 percent**, passes the 1 percent tolerance |

1260 is 63 x 20 and 1760 is 88 x 20, so the silhouette is exactly 63:88 rather
than approximately. The measurement is the alpha bounding box after keying, not
a nominal figure.

Worth recording for the sake of the selection process: **all four frame
candidates measure the same 1260 x 1760 silhouette**, and the fourth,
`sticker-style`, comes in at 1259 x 1759, still 63:88 to within 0.023 percent.
The aspect check could not discriminate between them, so `clean-minimal` was
chosen on appearance rather than on measurement.

### Chroma strip parameters

Greenness is defined as `G - max(R, B)`. Below 10 is fully opaque, above 60 is
fully transparent, linear in between, which preserves the antialiased edge
rather than producing a hard binary cut. Despill runs in a 2 pixel band inward
from the alpha edge, clamping the green channel to the neutral of the other two.

| Result | Frame | Label |
| --- | --- | --- |
| Despilled pixels | 20026 | 8165 |
| Residual green above threshold | **0** | **0** |

Verified visually by compositing the keyed frame over magenta. No green fringe
survives on the keyline, the roundel, or the corner radius.

### Art window

Measured from the frame by connected-component analysis on the cream fill,
rather than assumed.

| Panel | Bounds | Size | Aspect |
| --- | --- | --- | --- |
| **Art window** | 490,233 to 1585,1226 | **1096 x 994** | **1.102616** |
| Text box | 521,1263 to 1592,1647 | 1072 x 385 | 2.784416 |
| Name bar | 471,1693 to 1576,1837 | 1106 x 145 | 7.627586 |

The art window bounding box is 92.4 percent filled, the shortfall being the
angular notches at three corners. The bounding box is the correct crop target
since the notches overlay the art rather than cutting it.

---

## Card arts

Five full-bleed arts, centre-cropped to the measured window aspect of 1.102616
and downscaled with Lanczos 3.

| Card | Source | Crop | Output | Scale |
| --- | --- | --- | --- | --- |
| hero | `data-scientist-chibi-rounder-cuter` | 2048x1857 at 0,96 | 1096 x 994 | 0.5352 |
| komikfind | `matched-card-art-komikfind` | 2048x1857 at 0,96 | 1096 x 994 | 0.5352 |
| kalakal | `matched-card-art-kalakal` | 2048x1857 at 0,96 | 1096 x 994 | 0.5352 |
| raidyard | `matched-card-art-raidyard` | 2048x1857 at 0,96 | 1096 x 994 | 0.5352 |
| dotaweakness | `matched-card-art-dotaweakness` | 2048x1857 at 0,96 | 1096 x 994 | 0.5352 |

All five are genuine downscales at 0.5352, so no upscaling artifacts enter the
pipeline.

**Sizing resolved, these files stand unchanged.** The Phase 1 prompt asked for 2x
the final texture window without stating the final texture size, and this was
processed under a provisional reading. That reading is now superseded by
[D3](../baseline/DECISIONS.md), which sets the production card texture at
1008 x 1408 and moves all compositing to the 2048 master scale followed by a
single Lanczos downscale of the finished card.

Under D3 these five files at 1096 x 994 are exactly master-window scale, so they
are consumed at native resolution during compositing. **No regeneration is
needed and no Phase 1 output is invalidated.** The art window lands at 877 x 795
in texture space after the 0.8 reduction, but that reduction happens to the
assembled card, not to these source files.

The `project-art-*-rounder-cuter` set was not used. Both sets were complete and
covered the same four projects, and `matched-card-art-*` was selected as the
later corrective pass.

---

## Character sheet

Paste this verbatim into any generation depicting Joshua. Do not paraphrase it,
do not summarise it, and do not reorder it. Round one failed in part because the
style block was not pasted verbatim, so treat this block as literal text.

> Chibi cartoon man, short black spiky hair, round glasses, light chin
> scruff, red hoodie over black pants and black sneakers. Default pose:
> sitting cross-legged with a laptop. Friendly confident grin. Flat
> cel-shaded style with thick clean black outlines per the set style
> block.

The five traits, for checking a generation against the sheet:

1. Short black spiky hair
2. Round glasses
3. Light chin scruff
4. Red hoodie over black pants and black sneakers
5. Friendly confident grin

Default pose is sitting cross-legged with a laptop. Rendering is flat cel-shaded
with thick clean black outlines, per the set style block.

The approved hero art, `assets-src/art/hero-art-src.png`, matches all five.

---

## Label winner

**`certification-label-strict-grid`**, processed to `assets-src/label-ref.png`.

| Property | Measured |
| --- | --- |
| Source | 2048 x 512 |
| Content bounds after key | x 111 to 1935, y 21 to 483 |
| Content size | 1825 x 463 |
| Residual green | 0 pixels |

Layout reference only. The production label is SVG, authored in Phase 3. This
file exists so the SVG can be measured against the intended proportions, and it
should never ship as a raster.

---

## Holo assignments

| Card | Pattern | Source base |
| --- | --- | --- |
| hero | starburst | `starburst-rays-base.png` |
| komikfind | halftone | `halftone-comic-dots-base.png` |
| kalakal | hex | `hex-circuit-mesh-base.png` |
| raidyard | prismatic | `diagonal-prismatic-lines-base.png` |
| dotaweakness | prismatic | `diagonal-prismatic-lines-base.png` |
| spare | weave | `cross-hatch-weave-base.png` |

All six bases were cropped free of their 25 pixel green border and saved to
`assets-src/holo/` at 974 x 974, greyscale.

### Tile test results

Each base was rolled 50 percent on both axes so its outer edges meet in the
interior, then tiled 2x2. Composites are in `assets-src/holo/tile-test/`.

Two checks were run. A numeric one, comparing cross-edge mean absolute
difference against ordinary adjacent-pixel difference, and a visual one at 1:1
on a 600 pixel window centred on where the edges meet.

| Pattern | Numeric ratio v / h | Numeric verdict | Visual verdict |
| --- | --- | --- | --- |
| cross-hatch-weave | 1.63x / 1.20x | seamless | **SEAM** |
| diagonal-prismatic-lines | 0.89x / 0.93x | seamless | **SEAM** |
| halftone-comic-dots | 0.70x / 1.47x | seamless | **SEAM** |
| hex-circuit-mesh | 1.58x / 2.36x | marginal | **SEAM** |
| starburst-rays | 1.82x / 1.49x | seamless | **SEAM** |

**All five patterns are marked non-tileable.** Per the brief this means a
seamless pass in Phase 3 ComfyUI, not rejection. The patterns themselves are
good, they simply were not generated with wrap continuity.

The numeric metric disagreed with the eye on four of five, and the eye wins
here because the brief's criterion is a visible seam. The metric fails on these
inputs because all five are high-frequency textures where ordinary interior
variation is already large, which flatters the ratio. Worth remembering if this
check is automated later: a mean-absolute-difference ratio is not a sufficient
seam detector for dense patterns, and the visual check is not optional.

Observed failure modes, useful as input to the Phase 3 seamless pass:

- `diagonal-prismatic-lines` and `cross-hatch-weave` break directional
  continuity, the lines and the weave step out of alignment across the join
- `halftone-comic-dots` and `starburst-rays` are radially composed around a
  single centre, so they cannot wrap without being restructured rather than
  merely retouched
- `hex-circuit-mesh` is the closest to salvageable, the lattice nearly aligns
  and the break is in the node and trace overlay

---

## Backgrounds

| Asset | Role |
| --- | --- |
| `paper-grain-warm-white` | **Recommended primary** |
| `paper-grain-cool-white` | Alternate |

Both are 1024 x 1024. Neither has been processed yet, since the brief did not
call for it in this phase, and neither has been tile tested. If either is
destined to tile behind the collection, it needs the same 2x2 offset check
before Phase 3.

---

## Deferred

**og-image moves to Phase 5.** It depends on the final card composite, so
generating it before the frame, art, label and holo are assembled would mean
regenerating it. The current `public/og.png`, 175857 bytes at 1200 x 630, stays
in place until then.

---

## Generation IDs

**UNAVAILABLE.** No generation IDs were captured for this run and none are
recoverable. The 26 source PNGs carry no `tEXt`, `iTXt`, `zTXt` or `eXIf` chunks
containing prompt or generation metadata. The only embedded text is an
ImageMagick `date:create` and `date:modify` pair on the four frame candidates.
Nothing has been invented to fill the gap.

Batch timestamps from the filesystem are the **permanent substitute**, recorded
here because they establish the order of the passes and let any output be traced
back to the batch that produced it.

| Time, 2026-07-30 | Batch |
| --- | --- |
| 13:46 | 4 TCG frame candidates |
| 13:54 | 3 certification label candidates |
| 14:10 | 4 chibi style candidates |
| 14:29 | 4 project arts, rounder-cuter |
| 14:44 | 5 holo heightmaps |
| 14:52 | 2 paper grain backgrounds |
| 15:08 | 4 matched card arts |

### Consequence

Without seeds, **regenerations are style-matched via the verbatim style block,
not seed-matched**. Nothing can be reproduced exactly. A regenerated card will
be a new image that resembles the set rather than a controlled variation of the
original.

Therefore **any regenerated card must re-pass the five-card set-coherence check
before entering `assets-src`**. Regenerating one card in isolation and dropping
it in is not permitted, because a card that looks correct alone can still break
the set when seen alongside the other four. The check is against the full set of
five, not against the card it replaces.
