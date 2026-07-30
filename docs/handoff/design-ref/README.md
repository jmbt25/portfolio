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
