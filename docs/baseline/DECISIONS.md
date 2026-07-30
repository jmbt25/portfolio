# Architecture decisions, revamp/graded-collection

Recorded 2026-07-30, after baseline recon. Evidence for every number cited here
is in [RECON.md](./RECON.md).

These decisions bind the phases that follow. They do not get patched into
`main`. Anything that changes production behavior lands through the revamp
branch on its own schedule.

---

## D1. Renderer: vanilla three.js

**Decided.** The graded-collection hero and card work uses vanilla three.js on
an Astro island. React Three Fiber is rejected.

Measured cost, esbuild production build, brotli, both entry points implementing
the identical scene:

| Bundle | Brotli |
| --- | --- |
| Vanilla three.js | 99.9 KB |
| React Three Fiber stack | 230.2 KB |

R3F costs 130.3 KB extra, a 2.30x multiplier. Only 50.8 KB of that is React
itself; the remaining 79.5 KB is R3F's reconciler and event layer. R3F earns
that cost in a React application, by sharing state with React components and
opening up drei. This codebase has no React application, so the reconciler would
be imported to serve one island that nothing else on the site talks to.

99.9 KB brotli fits inside the 300 KB JS budget with room to spare.

### The CSS-transforms alternative, raised and rejected

During recon I argued the 99.9 KB floor was worth questioning, on the grounds
that flat cards with shader transitions might not need a 3D renderer at all.

That challenge was correct to raise and is **rejected for this brief.**

CSS holo cards are a known demo genre with a recognizable ceiling. The technique
cannot produce the three beats that carry the quality bar here:

- the slab fresnel, which needs real view-dependent rim response
- the raking-light foil reveal, which needs a light direction the geometry
  actually resolves against
- the card-inside-case depth, which needs true parallax between two surfaces at
  different depths, not a simulated offset

Those beats are the product. Landing them at 60 percent fidelity for a smaller
bundle is not the trade being made. The renderer stays.

The challenge is recorded rather than deleted because the reasoning stays
relevant: if a later phase adds surfaces that are genuinely flat, those should
not be routed through WebGL by default.

---

## D2. Hydration: poster-first

**Adopted as an amendment to the Phase 5 plan. This supersedes "client:load on
desktop."**

The load sequence:

1. A static hero WebP renders in plain HTML immediately, in the initial payload,
   with no JavaScript involved
2. The island hydrates at `client:idle`
3. The canvas crossfades in once the first frame is ready

Consequences that make this the right shape:

**LCP stays on the static image.** The baseline is 100 performance with LCP at
1.1s mobile and 0.5s desktop, 0 ms total blocking time and 0 CLS. Under
poster-first, the largest paint is a static image in the initial HTML, so the
WebGL bundle cannot regress LCP no matter how long it takes to hydrate. Only the
crossfade depends on the renderer.

**The fallback path is exercised on every load, not just on failure.** The mobile
and reduced-motion fallback uses the same WebP asset as the poster. That means
the fallback is not a rarely-taken branch that silently rots. Every single
visitor renders it, including desktop visitors who then get the canvas on top of
it. A broken fallback becomes immediately visible instead of surfacing only for
the users least able to report it.

**`client:idle` rather than `client:load`** keeps the hydration off the critical
path entirely, which `client:load` would not.

The crossfade must wait for an actual first rendered frame, not for the module
to finish importing. Hydration completing is not the same event as the scene
being ready to look at, and swapping on the wrong one produces a visible flash
of an empty canvas.

---

## D3. Card texture 1008x1408, composite at master scale

**Decided. Supersedes the 1024x1408 figure in the plan doc, and supersedes the
"2x final window" phrasing in the Phase 1 prompt.**

### Texture size

Production card texture is **1008 x 1408**.

| Spec | Aspect | Deviation from 63:88 |
| --- | --- | --- |
| **1008 x 1408** | 0.715909 | **0.0000 percent** |
| 1024 x 1408, superseded | 0.727273 | 1.5873 percent |

1008 is 16 x 63 and 1408 is 16 x 88, so the texture is exactly 63:88 at an
integer scale rather than approximately. Both dimensions divide by 4, 1008 into
252 and 1408 into 352, which is what KTX2 and Basis need for block compression.

The superseded 1024 x 1408 was not a rounding convenience. It carried a real
1.59 percent aspect distortion, which on a card read against a real trading card
silhouette is the kind of error that looks wrong without the viewer being able
to say why.

### Compositing pipeline

All card compositing happens at the **2048 master scale**, where the frame
silhouette is 1260 x 1760. That includes the frame, the art, and the SVG text
overlays. The finished card is then reduced to 1008 x 1408 in a **single Lanczos
downscale**.

One resample at the end, not one per layer. Compositing at target size would
resample each layer independently and accumulate softening, and it would land
the SVG text on a fractional grid. Text stays crisp because it is rasterised
once at master scale and reduced once.

### Canonical scale chain

This is the reference for Phase 3 and Phase 4. Verified by arithmetic.

| Element | Master, 2048 space | Scale | Texture, 1008x1408 space |
| --- | --- | --- | --- |
| Card silhouette | 1260 x 1760 | 0.800000 | **1008 x 1408** |
| Art window | 1096 x 994 | 0.800000 | **877 x 795** |
| Art window origin | 490, 233 | 0.800000 | 392, 186 |
| Text box | 1072 x 385 | 0.800000 | 858 x 308 |
| Name bar | 1106 x 145 | 0.800000 | 885 x 116 |

The scale is **exactly 0.8000 on both axes**, uniform, with no anisotropy:
1008 / 1260 = 0.8 and 1408 / 1760 = 0.8. That the reduction is a clean 4:5 is a
consequence of choosing 1008 rather than 1024, and it is the reason the whole
chain stays on integers.

Art window rounding: 1096 x 0.8 is 876.8 and 994 x 0.8 is 795.2, so the window
rounds to 877 x 795. The sub-pixel rounding shifts the window aspect from
1.102616 to 1.103145, a 0.048 percent change, which is below anything that can
be seen and well inside the tolerance the frame notches already impose.

### Consequence for existing assets

**The five `assets-src/art/*-art-src.png` files stand unchanged at 1096 x 994.**
Under this pipeline they are exactly master-window scale, so they are consumed
at native resolution during compositing and reduced once with the rest of the
card. The earlier Phase 1 note that they might need regenerating is void. No
Phase 1 output is invalidated by this decision.

---

## D4. Identity boundary, portfolio and studio stay separate

**Decided. Binds every phase and every asset.**

This portfolio and the studio are separate entities. They do not reference each
other, and the separation is enforced mechanically rather than by memory.

The rules:

- **No studio name, brand, or domain appears anywhere in this repository.** Not
  in source, not in content, not in comments, not in commit messages, not in
  documentation, not baked into an image asset.
- **komikfind ships unlinked.** It appears as a project with no outbound link.
  It is a studio property, so linking it would join the two identities on a
  public page regardless of how the link is labelled.
- **Contact is GitHub and X only.** No studio contact route, no studio email
  domain, no cross-site footer link.

The studio is deliberately not named in this document. Naming it here to define
the rule would place it in tracked history permanently and defeat the rule.

### Current state, verified

At the time this was recorded the working tree was already clean. A case
insensitive search of the entire working tree, excluding `.git` and
`node_modules`, returned **zero hits**, as did a search of every object on every
branch in history and a search of the build output. The expected hits in a plan
document and in `PICKS.md` did not exist, because no plan document is tracked
here and `PICKS.md` refers to the label by generation filename rather than by
brand. No grading-mark substitution was needed, and no studio links existed to
remove.

`assets-src/label-ref.png` was checked visually as well, since text rendered
into a raster is invisible to grep. It contains placeholder bars and a grade
numeral, no lettering. That is round two's no-text-in-image-prompts rule paying
off, and it is why the production label is authored as SVG in Phase 3.

### The guard

`scripts/check-identity.sh` greps the built `dist/` for every denied term and
exits nonzero on any hit.

Run it as `npm run check:identity`, or `npm run verify` to build and check in
one step.

**The denylist file must exist locally.** Create `scripts/.identity-denylist`
with the studio terms, one per line. Blank lines and anything after a `#` are
ignored, matching is case insensitive and literal. The file is gitignored, and
that is the entire point: putting the denied terms under version control would
write them into history permanently, which is the outcome the guard prevents.
Because it is untracked, **every clone needs the file recreated by hand**, and a
fresh clone cannot run the guard until that is done.

The script fails closed. A missing denylist, an empty denylist, or a missing
`dist/` all exit nonzero rather than passing quietly. A guard that reports green
when it could not actually run is worse than no guard. On failure it prints the
offending file paths but never the term itself, so a denied string cannot leak
into a CI log.

**Deliberate limitation, worth knowing before relying on this.** The guard is
wired into `npm run verify`, not into `npm run build`. Cloudflare Pages runs the
plain build and has no access to the untracked denylist, so wiring it into
`build` would either break every deploy or force the guard to pass when the file
is absent. As it stands this is a local and pre-push gate, not a deploy gate. To
make it a true deploy gate, set the `IDENTITY_DENYLIST` environment variable as
a build secret in Cloudflare with the terms newline separated, which the script
already reads in preference to the file, then move the call into `build`.

A second limitation: grep over `dist/` catches literal strings, including inside
binary assets, but it cannot read text rendered into an image. Rendered
lettering still needs a human check, which is one more reason the label is SVG.

These bind all new work on this branch.

### C1. Entrance reveals animate transform only, never opacity, on text

**Carry into Phase 2 brief.** This rule replaces the earlier opacity-floor
constraint wholesale. When the Phase 2 brief goes to Claude Design, this is the
motion constraint that ships with it, and the 0.55 floor must not travel
alongside it. The two are alternatives, not layers.

The rule:

- Entrance and scroll-driven reveals animate `transform` only. `translateY` from
  16px to 24px, settling with an ease-out curve.
- `opacity` stays at `1` at all times for any subtree containing text. It is not
  animated, not on the container, not on the text itself.
- `prefers-reduced-motion: reduce` removes the transform animation as well.
  Content renders settled, in final position, with no entrance at all.
- Opacity animation remains allowed for **non-text elements only**. The D2 canvas
  crossfade is explicitly unaffected, since there is no text in that subtree.

**Rationale.** An opacity reveal can only ever be proven safe one token at a
time, at one alpha at a time. Every new color, every new alpha, every new
pairing reopens the question and needs a fresh contrast calculation. A
translate-only reveal cannot regress contrast at any point in the animation,
under any palette, because the rendered color never changes. It removes the bug
class instead of tuning around it, and it reads nearly the same on screen.

This supersedes the 0.55 opacity floor, which was necessary but not sufficient.
Measured, the floor passed `--fg` at 5.29:1 and left `--dim` at 2.57:1, still
failing 4.5:1. The full table is attached below as the evidence for why the
floor approach was abandoned rather than raised.

The underlying defect this addresses is the axe `color-contrast` finding that
holds the baseline accessibility score at 95. The cause is not the palette.
Every color token passes AA against the background, `--fg` at 16.16:1 and
`--dim` at 6.12:1. The cause is this rule in `global.css`:

```css
main > section {
  animation: rise 1ms linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 60%;
}
```

`@keyframes rise` starts at `opacity: 0.2`, so every below-fold section renders
its text at 20 percent alpha. Blended over `#0a0a0a` that turns `#e8e8e8` into
`#363636` at 1.64:1 and `#8f8f8f` into `#252525` at 1.29:1, which is exactly
what axe reported. Verified by execution at Lighthouse's 412x823 emulation:
below-fold sections report `opacity=0.2`, and under reduced motion all sections
report `opacity=1`.

**Why the opacity-floor approach was abandoned.** Measured contrast against
`#0a0a0a` at each candidate alpha:

| Alpha | `--fg` #e8e8e8 | `--dim` #8f8f8f |
| --- | --- | --- |
| 0.20 | 1.64:1 fail | 1.29:1 fail |
| 0.55 | 5.29:1 pass | 2.57:1 fail |
| 0.70 | 8.04:1 pass | 3.50:1 fail |
| 0.85 | 11.71:1 pass | 4.68:1 pass |
| 1.00 | 16.16:1 pass | 6.12:1 pass |

0.55 clears `--fg` comfortably. It does not clear `--dim`, which needs 0.85
before it crosses 4.5:1. That matters because the axe failures were not all
`--fg`. The `#252525` entries in the report are `--dim` elements:
`.project-stack`, `.project-title .year`, and `.dim` spans. Holding those at
0.55 during a reveal leaves them at 2.57:1 and the audit still fails.

Raising the floor to 0.85 would have worked for today's two text tokens, but it
weakens the reveal to near invisibility and, more importantly, it is a result
that holds only for this exact palette. Any new dim token in the revamp would
need the table recomputed. That is the fragility the transform-only rule
removes.

The existing rule in `global.css` is left alone for now. It gets fixed when the
stylesheet is rewritten, not as a patch to `main`.

### C2. Drop the dead latin-ext font subset

`public/fonts/jetbrains-mono-latin-ext.woff2`, 11624 bytes, is declared with a
`unicode-range` that no current page content triggers. It never loads. Confirmed
against production: the only font request on any page is
`jetbrains-mono-latin.woff2`.

Remove it in Phase 5, when fonts are being touched anyway. Not before, since
deleting it in isolation is a change with no runtime effect and a nonzero chance
of breaking a page that later needs extended Latin coverage. If any revamp copy
introduces characters in that range, this rule is void and the subset stays.

---

## Known cosmetic, no action

**`.gitkeep` files copy into `dist/`.** `public/assets/cards/.gitkeep` and
`public/assets/models/.gitkeep` are copied verbatim into `dist/assets/` by
Astro, since everything under `public/` ships as-is, and they would deploy as
two empty files. Reviewed and accepted as harmless. It self-resolves in Phase 1
once real card assets land in those directories and the `.gitkeep` placeholders
are no longer needed. Recorded here so it is not rediscovered and investigated a
second time.
