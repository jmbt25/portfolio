# Phase 5, implementation

Recorded 2026-07-30 on `revamp/graded-collection`. Every figure below was
produced by running the thing, not estimated. Evidence is in
[phase5-evidence/](./phase5-evidence/).

Reproduce with:

```
npm run assets            # the whole asset pipeline
npm run build
npm run preview           # then, against http://localhost:4321/
npm run verify:screens
npm run verify:bundle
npm run verify:fps        # headed, so it runs on the real GPU
npm run verify:falsifiers
npm run verify:a11y
npm run verify:identity
```

---

## 0. What shipped

One Astro page, one canvas, one `WebGLRenderer`, vanilla three.js, GSAP
ScrollTrigger, no React. Seven beat sections, seven timelines, the seventh-based
ranges from the handoff spec.

| Piece | File |
| --- | --- |
| Page | `src/pages/index.astro` |
| Layout, meta, og | `src/layouts/Graded.astro` |
| Tokens and layout | `src/styles/graded.css` |
| Island shell and guards | `src/components/Stage.astro` |
| Scene and choreography | `src/islands/graded/main.ts` |
| Foil, glass, shadow, fan shaders | `src/islands/graded/materials.ts` |
| Loading and the lazy sets | `src/islands/graded/loaders.ts` |
| Beats, poses, label copy | `src/data/beats.ts` |
| Asset pipeline | `scripts/phase5/assets.mjs` |

---

## 1. The gates

| Gate | Result |
| --- | --- |
| 1 Layout screenshots | **Pass.** 21 shots plus 21 under reduced motion, 3 widths x 7 scroll positions |
| 2 Bundle | **Pass.** Initial 2.09 MB against 2.5 MB, JS 218.3 KB gzipped against 300 KB |
| 3 Frame trace | **Pass.** p5 58.3 fps against 55, on an RTX 5070 Ti through D3D11 |
| 4 Falsifiers | **A came out false and was fixed. B holds.** Both re-run and both hold now |
| 5 Lighthouse | See section 8 |
| 6 axe-core | **Pass.** Zero violations at 1440 and at 390, canvas `aria-hidden` |
| 7 check-identity | **Pass**, and the Phase 4 caveat is closed. The denylist exists here and the real scan runs |

### Gate 2, itemised

| Tier | Contents | Bytes |
| --- | --- | --- |
| A first paint, no JavaScript | HTML, font, poster, grain, favicon | 209.3 KB |
| B critical 3D, fetched at idle | JS, basis transcoder, GLB, hero KTX2 set, starburst normal | 1849.3 KB |
| C lazy card sets | 4 x (albedo, packed RG, label) plus 3 holo normals | 1638.4 KB |
| D static faces, narrow only | 5 WebP faces | 427.6 KB |

| Budget | Limit | Measured | Headroom |
| --- | --- | --- | --- |
| Initial, A + B | 2.5 MB | **2.09 MB** | 0.41 MB |
| JavaScript, gzipped | 300 KB | **218.3 KB** | 81.8 KB |

Measured against a running server rather than only tallied off disk, because the
tiers are a claim about behaviour and a static walk cannot check one:

```
1440x900  after hydration        2.15 MB   15 requests
1440x900  after a full scroll     3.58 MB   30 requests
1440x900  static faces fetched    0 (want 0)
390x844   first view              0.45 MB    9 requests
390x844   WebGL assets fetched    0 (want 0)
```

**The first version of that measurement read 3.58 MB at hydration and 3.58 MB
after a full scroll, and that identity is what exposed the bug.** The beat 7 fan
needs all five albedos and was asking for all five up front, which quietly
un-lazied the entire scheme. The fan now subscribes to sets as they arrive
rather than requesting them, and by beat 6 all five have been through on the
beats' own schedule.

### Gate 3, the frame trace

```
renderer            ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti, Direct3D11, D3D11)
frames traced       745
p5                  58.3 fps
p50                 60 fps
p95                 61.6 fps
worst frame         26.8 ms
```

At device pixel ratio 2 the same run gives p5 58.5, so the scene is not fill
bound and the DPR cap is not what is holding the frame rate.

p5 rather than a mean: a scrubbed scene is judged on its worst frames, and a
mean of 60 with a stall at every beat boundary is exactly the failure a mean
cannot see. Frame times come from the browser's own `DrawFrame` events over CDP,
not from a `requestAnimationFrame` counter, which measures how often a callback
ran rather than how often a frame reached the screen.

**Flagged for a hardware test.** This is one machine, headed, on a discrete
GPU, at 1440x900. The script reports the renderer string with the number and
refuses to evaluate the gate at all under SwiftShader, so a software result
cannot be mistaken for a pass.

---

## 2. Falsifier A came out false

**Claim.** At beat 2, under the raking light, the starburst foil on the hero
reads as a material rather than as a mechanical grid.

**It did not.** The isolated holo term showed regular banding across the whole
art window. The cause was in the Phase 3 procedural build, and its own docstring
said so:

> Every cell is identical, so the field tiles exactly.

Sixteen identical ray clusters on a perfect 4 x 4 lattice, tiled three more
times across the card, is a grid. Under the view-angle hue term it moired into
even vertical banding over the entire face.

**The numeric test did not catch it, and the eye did.** The autocorrelation
ratio came back 1.79 against a 2.5 limit, with its peak at the smallest lag
tested, which in hindsight is the tell that the metric was looking in the wrong
band. This is the second time on this project that a ratio has been flattered by
a dense pattern; PICKS.md records the first, on seam detection, and draws the
same conclusion. **The visual check is not optional.**

**The fix is the one the falsifier named**, seeded per-cell jitter in
`scripts/textures/d_holo.py`:

- each of the sixteen centres displaced by up to 0.22 of a cell
- ray count varying per centre over 16, 18, 20, 22, so no two clusters share an
  angular frequency
- per-centre phase, reach and amplitude

Continuity is why this sums nine neighbours rather than switching parameters on
`x % cell`. Per-cell parameters keyed off the cell index change discontinuously
at the boundary and print a seam lattice, which trades one grid for another.
The result is still exactly periodic: the wrap step and the interior step are
both 7 of 255.

Two consequences, both real:

**The pattern stopped being compressible.** UASTC went from 68 KB to 845 KB,
because sixteen copies of one cluster is cheap and sixteen different ones are
not. At 1024 that alone would have taken the initial payload from 1.92 MB to
2.70 MB, past the gate. The holo normals now ship at 512, which is still 1.7x
oversampled at the scale they are actually tiled at, and the vectors are
renormalised after the reduction rather than left short.

**The tile repeat came down** from 3.0 x 4.2 to 1.7 x 2.4. At the old figure a
1024 px pattern was minified about twelvefold on a 250 px card, and that
aliasing was the other half of what the falsifier caught.

Re-run: ratio 2.4 against the 2.5 limit, holds, and holds by eye. **2.4 is not a
comfortable margin.** The evidence crops are in
[phase5-evidence/falsifiers/](./phase5-evidence/falsifiers/) and the honest
summary is that this passes on the picture, with the number as corroboration
rather than as the verdict.

## Falsifier B holds

**Claim.** The slab rim highlight does not step along the corner curves.

Three step candidates detected around the 90 degree arc against a limit of 4,
on a corner rendered 26.5 px across at device pixel ratio 3. The 12 segments per
corner from `scripts/blender/spec.py` carry smoothed normals through the
exporter, so the rim response is continuous. `b-slab-corner-3x.png` shows it.

No re-export was needed. The named fix, more bevel segments in `spec.py`, was
not applied because the falsifier did not call for it.

---

## 3. The scene

### Sizing is a ratio, and the camera is the mockup's

Slab display width is **1.1075 x `--cw`**, per
[design-ref/README.md](../handoff/design-ref/README.md), not the mockup's
`calc(var(--cw) + 40px)`. That constant is the 20px inset at one width only.
Expressed as a ratio it holds across the whole `clamp(240px, 24vw, 372px)`
range, and at 390 the slab margin is therefore slimmer than the mockup shows.
That is the intended result, and the 390 screenshots are read against it.

The camera reproduces the mockup's `perspective: 1700px` rather than picking a
field of view: `fov = 2 atan(H / 3400)` and the camera sits `1700 * worldPerPx`
from the slab plane, where `worldPerPx = 0.085 / (1.1075 * cw)`. The
foreshortening on the 3D slab is therefore the same foreshortening as in the
layouts the screenshots are compared against, rather than merely similar.

### The card swap

Two card meshes in the slot, 180 degrees apart. A swap turns the slot half a
turn, which brings the hidden mesh to the front, and the mesh that just left the
front is the one whose textures are replaced. A shader uniform crossfade covers
the handoff, smoothstepped over `raw` 0.42 to 0.58, so the blend runs while the
card is edge on and the slab is at plus or minus 92 degrees besides.

**This deviates from the handoff spec, deliberately and on instruction.**
Section 08 says the face swap happens "by visibility. Never by opacity, and
never crossfaded." The Phase 5 brief specifies a shader-uniform crossfade. The
brief is the later instruction and it is followed, and the window is tight
enough and placed well enough that the two amount to the same thing on screen:
at the midpoint the card has no projected area for a blend to show through. It
is recorded here rather than quietly reconciled.

The accumulated slot rotation is a pure function of the scroll position, in half
turns, so a scrub that reverses lands exactly where it came from. `floor` rather
than `round` on the half-turn count, because `floor` is stable for a whole
window and that is what makes "the mesh that is leaving" a well defined thing to
fade out.

**The card back is not shipped.** Phase 4 staged `back-albedo` and `back-rg`
for "the Phase 5 edge pass". Under the two-mesh slot the reverse of a card is
never the surface facing the camera, so placing them would have put 214 KB in
`dist/` that no code path fetches. They stay staged in `assets-src/ktx2/`.

### One state object per beat

Seven scrubbed timelines writing into one shared state object is a race: GSAP
updates every trigger on a scroll tick, in scroll order, and the beat that is
actually active is not necessarily the last one to write. Each beat owns its own
object and the renderer reads only the active one, which removes the ordering
question rather than depending on it resolving favourably.

### The transition window, and why the easing is sliced

A window straddles a beat boundary: its second half is the incoming beat's first
0.16 of u, its first half the outgoing beat's last 0.16. One timeline per beat
therefore owns half a window at each end, and each half runs the slice of the
shared cubic in-out that belongs to it. Slicing rather than reusing the whole
curve is what makes the two halves meet with a matching tangent on the boundary
instead of with a visible kink. The edge pass is a half sine on the same
parameter and slices the same way.

### Materials

**Card foil.** Albedo, the shared frame emboss normal, the packed RG map with
the foil mask in R and roughness in G, and a tiling holo normal per the PICKS.md
assignments. View-angle hue shift masked by the foil, sparkle from the holo
normal at a tight specular exponent, and the sheen bar at the mockup's 102
degrees. The tangent frame is built from the object axes rather than from a
TANGENT attribute, since the card is a flat plane with a planar UV set and its
tangent frame is its object frame.

The lighting is normalised to land at a multiplier of 1.0 on a card facing the
camera. The first pass ran at about 1.52 and the result read as a washed out
card rather than a bright one, because the printed art is already near white in
the frame and the highlights clipped before the midtones moved.

**Slab glass.** Fresnel rim, translucent, no postprocessing and no transmission
pass. Two things worth recording:

- The alpha is set to half what the case reads at, because the material is
  `DoubleSide` and every ray through the slab crosses two walls. Two layers at
  0.34 composite to 0.56. Setting the intended figure directly gave an opaque
  blue case.
- The acrylic is only nearly clear **over the card**. Everywhere else it is 7 mm
  of material with a sealed void behind it. The well bounds are measured off the
  card geometry and grown by the 1.00 mm cavity clearance, so a change to the
  model cannot leave a hand-copied constant behind. A uniform alpha makes the
  whole thing a pane of glass and the slab stops reading as an object.

The interior fill PHASE4.md asked for is `gl_FrontFacing` flipping the normal on
the cavity's inward faces, so they take the same rim response as the outer shell
instead of reading as the near-black band the Phase 4 render showed.

**Contact shadow.** A rounded-box distance field on a quad, carrying the CSS
figures from spec section 05 directly: shape shrunk by the 26px spread, offset
34px down, blurred over 64px, plus the tight 2px pair. It tracks the slab's
position but never its rotation, because a drop shadow is cast onto the page
behind the case rather than onto a floor it stands on.

The quad sits 60 mm behind the slab. At 6 mm it was **in front of half the
card**: the slab spans 42.5 mm of z at the edge pass, and the first version
painted a grey wash across the lower left of the card at the hero pose. The
perspective shrink from being that far back is compensated on the scale.

**Beat 7 fan.** One `InstancedMesh`, five instances, a per-instance face index
and a per-instance spread multiplier. GLSL ES cannot index an array of samplers
with a value that is not dynamically uniform and an instance index is not, so
the selection is an unrolled comparison over the five slots.

The fan's UVs are flipped in the vertex shader. It is a hand-built
`PlaneGeometry`, whose UV origin is bottom left, sampling KTX2 textures, which
are stored top down and cannot be flipped on upload the way an uncompressed
texture can. The card in the GLB needs no flip because Blender authored its UVs
against glTF's own convention. Without this the whole fan renders upside down,
which is what the first beat 7 screenshot showed.

---

## 4. Poster-first, per D2

The static hero is in the initial HTML with no JavaScript involved, so the
largest paint on this page is an image and the WebGL bundle cannot regress it.
The island imports at idle and the canvas crossfades in only once a frame has
actually been rendered, two frames plus 420ms per spec section 08.

**Astro has no `client:idle` for a vanilla island.** The directive is only
available on framework components and D1 rules out pulling React in to get one.
`Stage.astro` is the vanilla equivalent with the same shape: nothing heavy is
imported during parse, the dynamic import is deferred to `requestIdleCallback`
with a 2500 ms timeout, and the scene module is only reached once the guards
pass.

### The poster is sized off the crop that produced it

`scripts/phase5/assets.mjs` crops the Phase 4 2x render to the slab, writes
`hero-poster.webp` at 824 x 1304, and writes `src/data/poster.json` with the
ratio the page needs. The poster is a render of a **posed** slab, so its pixel
width is the posed width; the page sizes the slab by its **flat** width. The
ratio carries the difference:

```
slab bounds in the 2x render   977 x 1550 at 974, 134
posed over flat width          1.03647     (0.0881 m posed, 0.085 m flat)
poster width as a ratio of cw  1.15494
```

Both numbers are generated, so the CSS that sizes the poster and the crop that
produced it cannot drift apart.

**That ratio was broken for one build and it took the reduced-motion screenshot
to find it.** It was passed through Astro's `define:vars`, which scopes the
custom property to the component's own elements, so a `:root` rule referring to
it never resolved, the `calc()` was invalid, and the image silently fell back to
its 824px width attribute. On every path where the canvas covers the poster
within 3.5 seconds that is invisible. It is only visible where the poster stays
up, which is exactly the reduced-motion path. It is now set inline on the stage
element.

### Known caveat, the poster shows the placeholder glass

The brief specifies cropping the existing `assets-src/poster/` 2x render, and
that is what ships. PHASE4.md notes that render carries the **placeholder** slab
material, not the one authored here. The crossfade therefore swaps a flat light
grey acrylic for the fresnel one. The Phase 5 material was tuned toward the
poster's read to keep the change small, and it is small, but it is a change and
it is not nothing. Re-rendering the poster from the Phase 5 scene would remove
it and is a one-line change to which pose the render script uses.

---

## 5. Fallbacks, all verified by running

`scripts/verify/a11y.mjs` checks each by loading the page under the condition
and asserting on the result, not by reading the source.

| Path | Result |
| --- | --- |
| `prefers-reduced-motion: reduce` | No WebGL context created. Content settled, no entrance transform |
| 390 px | No WebGL context created |
| No WebGL2 | `getContext('webgl2')` returning null before any page script runs. Nothing started |
| Context loss | `WEBGL_lose_context`, after the canvas is ready. Swaps to the static path, poster back to opacity 1 |

In every case all seven beats are present as plain HTML, checked against ten
strings from the copy deck.

**Below 1024 there is no 3D at any width**, which is handoff spec section 06,
"At 768 and below there is no 3D at all", extended to the tablet band because
the mockup's TABLET map also sets the stage to none. The Phase 5 brief names
`<768px` as the fallback trigger; the two agree on everything except the
768-1023 band, where the handoff layout is the stacked static one and that is
what ships.

Context restoration is deliberately **not** resumed. Once the static path is
showing, swapping back mid-scroll is a second unannounced visual change on a
page the visitor is already reading.

### C1 is enforced, not assumed

Entrance reveals animate transform only, translateY 16px on the hero panel and
24px on the others, settling on `cubic-bezier(0.16, 1, 0.30, 1)` over 640ms.
`IntersectionObserver` at threshold 0.01 with a bottom rootMargin of -18%,
unobserved after firing once.

The starting offset is applied by script rather than in the stylesheet, so a
page without JavaScript renders settled rather than permanently displaced.
Anything already on screen at load is left settled, since displacing it would be
an entrance the visitor watches run backwards.

The gate asserts that **no element containing text is composited below opacity
1**, at any point, on any path. The only opacity animation on the page is the
canvas crossfade, which D2 sanctions and whose subtree has no text in it.

---

## 6. Deviations from the mockup

| Deviation | Why |
| --- | --- |
| Face swap crossfades | Phase 5 brief overrides spec section 08's "never crossfaded". Recorded in section 3 |
| Slab sized by ratio, not `+40px` | design-ref README. Slimmer margin at 390 is the intended result |
| No 3D at 768 to 1023 | Spec section 06 and the mockup's own TABLET map |
| Choreography readout hidden below 1024 | It reports the state of a scrub that does not exist there, and sat frozen at `01 HERO 0.00%` on top of the metrics row. Dead chrome covering live copy is not a readout |
| `og.png` replaced by `og.jpg` | The render is photographic. PNG lands at 709 KB against 116 KB for visually identical mozjpeg, and every og:image consumer takes JPEG |
| No tone mapping | Phase 4's ACES framed a lit object on its own. Here the canvas composites over paper next to a still of the same slab, and ACES desaturated the card enough that the crossfade read as a colour shift |

---

## 7. Draco is removed at build time

`public/assets/models/slab-runtime.glb`, 30008 B, is `slab.glb` with
`KHR_draco_mesh_compression` decoded and the four KTX2 textures still external.

The Phase 4 brief asked for Draco and Phase 4 delivered it. At runtime it is a
bad trade and the numbers are not close: the mesh is 590 triangles and 6888 B,
while `DRACOLoader`'s glTF decoder is a 192 KB wasm plus a 58 KB wrapper that
has to be fetched, instantiated and run before the first frame. Decoding at
build time costs 23 KB on the GLB and removes a quarter megabyte from the
critical path.

`slab.glb` is left exactly as Phase 4 wrote it, so the artifact PHASE4.md
records still stands and can still be diffed against a rebuild.

`gltf-transform cp` is not usable for this: its binary writer folds every
resource into the BIN chunk, which re-embeds the four KTX2 textures and takes
the file from 6888 B to 469848 B. The document is written as `.gltf` with
external resources and the GLB assembled by hand, which is the same
transformation `scripts/pack/pack_glb.mjs` performs and for the same reason.

The Basis transcoder is still needed and is vendored into `public/vendor/basis/`
rather than reached for on a CDN.

---

## 8. Lighthouse

See the PR body for the run against the Cloudflare Pages preview and the
comparison with `docs/baseline/lighthouse-*.report.json`.

Per the brief, **LCP movement to the poster is reported, not failed.** The
baseline's LCP was text and a small ASCII block; this page's largest paint is a
57 KB WebP in the initial HTML. That is the D2 trade taken on purpose, and the
number moving is the expected consequence rather than a regression to fix.

---

## 9. The identity guard, and the Phase 4 caveat closed

`scripts/.identity-denylist` **exists on this machine**, so the substantive scan
was run and passes over `dist/`. PHASE4.md recorded this as owed; it is no
longer owed.

`scripts/verify/identity.mjs` also self-tests the guard, because "the guard
passes" and "the guard ran" are different claims and only one is worth anything.
Three runs, all asserted by execution:

| Condition | Expected | Result |
| --- | --- | --- |
| No denylist available | Fails closed | exit 1 |
| A term that is certainly present | Detected | exit 1 |
| A term that is certainly absent | Passes | exit 0 |

D4's other two rules are properties of the built output and are checked
directly: the komikfind panel carries **no** outbound link, and the contact beat
carries exactly two, GitHub and X. Every outbound URL in the built HTML is on a
three-entry allowed list.

## C2, the latin-ext subset

`public/fonts/jetbrains-mono-latin-ext.woff2` is deleted and its `@font-face`
block is gone from `global.css`. C2 says the rule is void if any revamp copy
needs a codepoint in that range, so that is checked rather than assumed: the
built HTML is scanned against all fourteen ranges of the subset's
`unicode-range` and needs none of them.

**One glyph does fall outside both subsets.** `U+2192`, the rightwards arrow in
"3.9s → 472ms" and "Start a conversation →", is absent from the latin file and
from the latin-ext file, and its codepoint is in neither declared range. It
rendered from a system fallback before this change and it still does. Dropping
latin-ext does not affect it, and the copy deck specifies the character, so it
stays.

---

## Caveats

**The frame rate is one machine.** Flagged for a hardware test, per the brief.

**Falsifier A passes at 2.4 against a 2.5 limit.** The picture is convincing and
the number is corroboration. If the holo is ever retuned, re-run the falsifier
and look at the crop rather than at the ratio.

**The poster carries the placeholder slab material.** Section 4.

**The four lazy sets have now been through the loader**, which PHASE4.md flagged
as untested. The face swap works; the beat 3 screenshot shows the komikfind
albedo, packed map and label all resident and swapped together.
