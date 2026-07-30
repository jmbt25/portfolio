# Design reference renders

These are Claude Design reference renders for visual comparison only. They are
**NOT production assets.**

Canonical card faces are built in Phase 3 per D3 in
[DECISIONS.md](../../baseline/DECISIONS.md). The canonical poster is rendered in
Phase 4. Nothing in this folder ships, and nothing here is an input to the
build. Its only job is to let a finished Phase 3 or Phase 4 asset be held up
against what the design tool produced.

## Expected contents

Six PNGs imported from the Claude Design project
`de995370-6f0b-47ad-906d-5b142a7a332f`:

| File | Source path in the design project | Dimensions |
| --- | --- | --- |
| `hero-face.png` | `assets/cards/hero-face.png` | 1008 x 1408 |
| `komikfind-face.png` | `assets/cards/komikfind-face.png` | 1008 x 1408 |
| `kalakal-face.png` | `assets/cards/kalakal-face.png` | 1008 x 1408 |
| `raidyard-face.png` | `assets/cards/raidyard-face.png` | 1008 x 1408 |
| `dotaweakness-face.png` | `assets/cards/dotaweakness-face.png` | 1008 x 1408 |
| `hero-poster-v2.png` | `assets/hero-poster-v2.png` | 824 x 1323 |

The five card faces are 1008 x 1408, which is exactly the D3 production texture
size and exactly 63:88.

## Status: the six PNGs are not present yet

The import could not retrieve them. The design MCP `get_file` method caps a
single response at 256 KiB and offers no range or offset parameter, so every one
of the six came back with `truncated: true` at exactly that cap. The recoverable
fraction was 7.7 to 7.9 percent of each card face and 23.2 percent of the
poster.

Partial files were deliberately not written here under the canonical names. A
truncated PNG sitting at the expected path would read as a complete reference
render to anyone who came to this folder later, which is worse than an empty
folder that says so.

The dimensions in the table above are trustworthy regardless: they were read
from the PNG IHDR header, which is in the first 33 bytes and survived
truncation intact.

To populate this folder, download the six files from the design project through
the web UI and drop them in. The filenames in the table are the expected names.

## hero-poster-v2.png is reference-only, dimensions included

Nothing about this file is canonical, its pixel dimensions least of all. The
asset table in the handoff spec says 824 x 1330 and the delivered file measures
824 x 1323. The spec figure is stale. The 1323 is simply what the mockup
happens to render, not a target. Neither number should be carried into
implementation.

The production poster is the Phase 4 render, taken from real slab geometry at
2x. It will be sized by that render, not by matching either figure here. Treat
this PNG as something to look at, never as a dimension source.

## Implementation note: slab display size is a ratio, not a constant

The mockup sizes the slab case as `calc(var(--cw) + 40px)`. That constant is the
card well inset of 20px per side, and it is a mockup convenience rather than the
rule to ship. Implementation should express slab display size as a ratio of
`--cw` so it holds across the whole `clamp(240px, 24vw, 372px)` range instead of
only at one width.

Calibrated at the 372px clamp maximum: 372 + 40 = 412, so the ratio is
412 / 372 = 1.1075, approximately **1.11x**. This was specified as approximately
1.12x, which would give 416.6px at the clamp maximum, 4.6px wider than the
mockup. The derived 1.1075 is used here pending confirmation.

The consequence to expect in testing: because a fixed 40px is a larger share of
a narrow card than a wide one, converting it to a ratio slims the margin at the
bottom of the range. At a 390px viewport `--cw` sits at its 240px clamp minimum,
where the mockup's constant gives a 20px inset per side but the ratio gives
about 12.9px. **Playwright comparisons at 390px should therefore expect a
slightly slimmer slab margin than the mockup shows.** That is the intended
result, not a regression.
