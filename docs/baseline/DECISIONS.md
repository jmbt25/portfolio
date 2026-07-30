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

## Carry-forward rules

These bind all new work on this branch.

### C1. Entrance animations start at opacity 0.55 minimum, never 0.2

All new CSS. Entrance and scroll-driven reveal animations start at an opacity of
at least `0.55`. `prefers-reduced-motion: reduce` forces opacity to `1`.

This is the fix for the axe `color-contrast` finding that holds the baseline
accessibility score at 95. The cause is not the palette. Every color token
passes AA against the background, `--fg` at 16.16:1 and `--dim` at 6.12:1. The
cause is this rule in `global.css`:

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

**The 0.55 floor is necessary but not sufficient, and the gap needs a decision
in Phase 5.** Measured contrast against `#0a0a0a` at each candidate alpha:

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

So C1 as written binds, and the remaining gap gets closed one of two ways in
Phase 5, whichever suits the new stylesheet:

- raise the floor to 0.85 for any element whose subtree contains `--dim` text,
  which keeps the reveal but weakens it considerably, or
- animate `transform` only on reveals and leave `opacity` at 1, which sidesteps
  the blend entirely and is the option I would take

The second is cleaner. A translate-only reveal reads nearly the same, cannot
regress contrast at any point in the animation, and removes the whole class of
bug rather than tuning around it.

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
