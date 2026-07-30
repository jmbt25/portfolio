# Baseline recon, jmbt.dev

Branch: `revamp/graded-collection`
Captured: 2026-07-30
Repo commit under test: `8e84b73`
Production URL: https://jmbt.dev

Every number here was produced by running something. Nothing is quoted from
documentation or estimated from memory. Commands and scripts used are noted per
section so the measurements can be reproduced.

---

## 1. Stack facts

| Fact | Value | How verified |
| --- | --- | --- |
| Astro | 4.16.19 | `npx astro --version` |
| Node | v24.18.0 | `node -v` |
| npm | 11.16.0 | `npm -v` |
| UI framework integrations | none | `npm ls react react-dom` empty, `integrations: [sitemap()]` is the only entry |
| Output mode | `static` | astro.config.mjs |
| Runtime deps at HEAD | `astro` only | package.json at 8e84b73 |
| Dev deps at HEAD | `@astrojs/sitemap` | package.json at 8e84b73 |
| Hosting | Cloudflare Pages | `Server: cloudflare` response header |
| Pages built | 4 | index, about, projects, 404 |

The build inlines all CSS (`inlineStylesheets: 'always'`) and minifies HTML
(`compressHTML: true`), so there is no external stylesheet request.

### Bundle size

Built from a clean git worktree at `8e84b73` so that in-progress experiment
files did not contaminate the numbers. The resulting `index.html` is 15168
bytes, byte for byte identical to what production serves, which confirms
production is running this exact commit.

| Artifact | Raw | Gzip | Brotli |
| --- | --- | --- | --- |
| index.html | 15168 | 4915 | 4100 |
| about/index.html | 9383 | 3452 | 2779 |
| projects/index.html | 11798 | 4103 | 3322 |
| 404.html | 7148 | 2624 | 2166 |

External JavaScript bundles emitted by the build: **zero**. There is no `.js`
file anywhere in `dist/`.

That is not the same as saying the site ships no JavaScript. It ships:

- 1738 bytes of inline classic JS, the rotating ASCII donut in
  `src/components/AsciiHero.astro`, marked `is:inline` and guarded by
  `prefers-reduced-motion`
- 601 bytes of inline JSON-LD, which is data rather than executable code

Measured transfer weight of the homepage, from the Lighthouse mobile run:

| Resource | Transfer bytes |
| --- | --- |
| /fonts/jetbrains-mono-latin.woff2 | 31818 |
| Cloudflare `beacon.min.js` | 11578 |
| / (HTML, compressed) | 5874 |
| /favicon.svg | 797 |
| /cdn-cgi/rum | 494 |
| **Total** | **50561, about 49 KiB** |

First-party weight is 38489 bytes, about 37.6 KiB. The single largest
first-party asset is the font, at 83 percent of first-party bytes.

Worth knowing before the revamp: **Cloudflare Web Analytics injects 11.6 KiB of
compressed third-party JavaScript** (31612 bytes uncompressed) into every page.
That is roughly 18 times the size of all the first-party JavaScript on the site.
It is not in the repo, it is added at the edge, and it is currently the largest
script on the page by a wide margin.

### Fonts

JetBrains Mono, self-hosted, variable, weight range 400 to 600.

| File | Bytes | Requested on any current page |
| --- | --- | --- |
| jetbrains-mono-latin.woff2 | 31432 | yes, and preloaded |
| jetbrains-mono-latin-ext.woff2 | 11624 | no |

The latin-ext subset is declared with a `unicode-range` that no current page
content triggers, so it never loads. It costs nothing at runtime but it is dead
weight in the repo.

Only one family is used, for headings and body copy alike. `font-display: swap`.
Both faces are variable across 400 to 600, and only 400 and 600 are actually
used.

### Color tokens

Six custom properties exist in total. That is the entire token system.

| Token | Value | Contrast vs bg | Verdict |
| --- | --- | --- | --- |
| `--bg` | `#0a0a0a` | n/a | |
| `--fg` | `#e8e8e8` | 16.16:1 | AAA |
| `--dim` | `#8f8f8f` | 6.12:1 | AA, AAA large only |
| `--accent` | `#d4a857` | 8.99:1 | AAA |
| `--border` | `#1c1c1c` | 1.16:1 | decorative separator only |

Plus `--max-width: 720px` and `--font`. Dark theme only, declared via
`<meta name="color-scheme" content="dark">`. There is no light mode and no
`prefers-color-scheme` handling anywhere in the codebase.

Everything else in the stylesheet is a hard-coded literal. There are no spacing
tokens, no radius tokens, no shadow tokens, no type-scale tokens.

### Type scale

Read from `getComputedStyle` on the live site at 1440x900, not from source.

| Size | px | Line height | Weight | Used by |
| --- | --- | --- | --- | --- |
| 0.875rem | 14 | 23.8 | 400 | `.project-stack`, `.site-footer` |
| 1rem | 16 | 27.2 | 400 | `html`, `p`, `.role`, `.nav a` |
| 1rem | 16 | 27.2 | 600 | `h2`, `.project-title`, `.brand` |
| 1.5rem | 24 | 40.8 | 600 | `h1` |
| 1.75rem | 28 | 47.6 | 600 | `.hero-name` |

Base 16px, line height 1.7, dropping to a 14px root below 600px.

The scale is very flat. Four distinct sizes across the whole site, and `h2` is
the same size as body text, distinguished only by weight and a literal `"## "`
pseudo-element marker. Hierarchy is currently carried by color, weight and
terminal-style glyph prefixes rather than by size. That is a deliberate part of
the look, and it is also the largest piece of typographic headroom the revamp
has to work with.

The one piece of fluid type is the ASCII hero, at
`min(12px, calc((100vw - 3rem) / 48))`, sized to hold 48 columns on one line.

### Layout

Single 720px column shared by header, main and footer, 1.5rem gutters, roughly a
72 character measure. No border radius anywhere. No box shadow anywhere. Three
breakpoints, all `max-width`, so the system is desktop-first: 600px drops the
root font size, 500px collapses the definition lists, 480px stacks the header.

---

## 2. Lighthouse

Lighthouse 13.4.1 against production, headless Chrome.
Reports saved to `docs/baseline/`:

- `lighthouse-mobile.report.html` and `.json`
- `lighthouse-desktop.report.html` and `.json`

| Category | Mobile | Desktop |
| --- | --- | --- |
| Performance | 100 | 100 |
| Accessibility | 95 | 95 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |

| Metric | Mobile | Desktop |
| --- | --- | --- |
| First contentful paint | 0.9 s | 0.5 s |
| Largest contentful paint | 1.1 s | 0.5 s |
| Total blocking time | 0 ms | 0 ms |
| Cumulative layout shift | 0 | 0 |
| Speed index | 0.9 s | 1.1 s |
| Time to interactive | 1.1 s | 0.5 s |

This is close to a perfect baseline, and it is worth being explicit that the
revamp starts from 100 performance with 0 ms blocking time and 0 layout shift.
Any WebGL work has to be measured against that.

### The one accessibility defect, and its actual cause

The single failing audit is `color-contrast`, and the reason is not the palette.

Axe reports foreground colors of `#363636` and `#252525`, which appear nowhere
in the stylesheet. They are the result of blending the real tokens over the
background at 20 percent alpha:

- `#e8e8e8` at 0.2 over `#0a0a0a` gives `#363636`, ratio 1.64:1, axe said 1.63
- `#8f8f8f` at 0.2 over `#0a0a0a` gives `#252525`, ratio 1.29:1, axe said 1.29

The source is this rule in `global.css`:

```css
main > section {
  animation: rise 1ms linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 60%;
}
```

`@keyframes rise` starts at `opacity: 0.2`, so every section below the fold sits
at 20 percent opacity until it scrolls into view.

Verified by execution, homepage at Lighthouse's 412x823 mobile emulation:

```
animation-timeline supported: true, innerHeight=823
section[0] top=  114 belowFold=false opacity=1
section[1] top=  646 belowFold=false opacity=1
section[2] top=  932 belowFold=true  opacity=0.2
section[3] top= 1671 belowFold=true  opacity=0.2
```

and with `prefers-reduced-motion: reduce`, all four sections report `opacity=1`.

So the resting palette is fine. Every token passes AA comfortably. What fails is
the entry state of a scroll-driven animation, which axe samples as a static
snapshot. A sighted user scrolling normally never sees it, and reduced-motion
users never see it at all.

It is still worth fixing, because the text genuinely is at 1.29:1 while
off-screen and any assistive tooling that samples the page statically will keep
flagging it. Raising the `rise` start opacity to roughly 0.55 would clear the
audit while keeping the effect, and is a one-line change. Not making that change
now, since it belongs to the revamp rather than to recon.

---

## 3. Screenshots

Saved to `docs/baseline/screenshots/`, 18 files. Playwright driving real Chrome,
`deviceScaleFactor: 2`, `reducedMotion: 'reduce'` so the captures are stable and
not caught mid-animation.

Three pages, home, projects and about, at each of the three requested viewports.
Both an above-the-fold capture and a full-page capture per combination.

| Viewport | Naming | Full-page scroll height, home / projects / about |
| --- | --- | --- |
| 390x844 | `<page>-390x844.png`, `<page>-390x844-full.png` | 1999 / 2234 / 1730 |
| 768x1024 | `<page>-768x1024.png`, `<page>-768x1024-full.png` | 1934 / 1875 / 1396 |
| 1440x900 | `<page>-1440x900.png`, `<page>-1440x900-full.png` | 1934 / 1875 / 1396 |

All nine navigations returned HTTP 200 and fonts were awaited via
`document.fonts.ready` before capture. Layout at 768 and 1440 is identical
because the only layout breakpoints are at 600px and below.

---

## 4. Design tokens

Extracted to `docs/baseline/tokens.json`. Valid JSON, verified by parsing.

The file separates what is genuinely declared from what had to be inferred. Six
values are real custom properties. Colors, fonts, spacing, type scale,
breakpoints, radius, elevation and motion are all included, with a `_status`
field on each group marking it `declared` or `derived`.

The spacing section is an inventory rather than a scale, because no spacing
tokens exist. It lists the twelve distinct rem values found in `global.css` with
usage counts. The distribution is broadly a 4px grid, carried mostly by 0.5rem,
1.5rem and 2rem, with 0.875rem and 1.75rem as the two off-grid outliers.

Two entries in the file deserve attention downstream, since they are defining
traits of the current look rather than oversights: `radius` is `0` everywhere,
and `elevation` is `none` everywhere. Depth comes only from the `--border`
hairline and the fixed dot-grid backdrop.

---

## 5. React runtime, and three.js versus React Three Fiber

### No React runtime ships. Confirmed.

Four independent checks, all run rather than read:

1. `npm ls react react-dom` at HEAD returns empty
2. No framework integration in `astro.config.mjs`, only `sitemap()`
3. In the live page, `window.React`, `window.ReactDOM`, `window.preact`,
   `window.Vue` and `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` are all `undefined`
4. `document.querySelectorAll('astro-island').length` is 0, and there are no
   `[data-reactroot]`, `#root` or `#__next` elements

The complete list of network requests on the homepage is: the HTML document, one
woff2, the favicon, the Cloudflare beacon, and the Cloudflare RUM ping. No
framework runtime of any kind.

Note that `three@0.180.0` and `@types/three` are present in the working tree as
uncommitted changes from the `experiment/cinematic-scroll` work. They are not in
`8e84b73` and they are not on production. `window.THREE` is `undefined` on the
live site.

### Bundle math

Measured, not quoted. esbuild 0.28.1, `--bundle --minify --format=esm
--target=es2020`, `NODE_ENV=production`. Both entry points implement the same
scene so the comparison is like for like: a shader-material backdrop plane, six
textured card meshes, pointer-driven hover, and a render loop. Versions:
three 0.180.0, react 19.2.8, react-dom 19.2.8, @react-three/fiber 9.6.1.

| Bundle | Minified | Gzip | Brotli |
| --- | --- | --- | --- |
| Vanilla three.js | 476.4 KB | 121.2 KB | **99.9 KB** |
| React plus react-dom, alone | 189.6 KB | 59.1 KB | 50.8 KB |
| React Three Fiber full stack | 1037.1 KB | 287.9 KB | **230.2 KB** |

Brotli is the meaningful column, since that is what Cloudflare serves.

Decomposing the R3F number: 99.9 KB of three, 50.8 KB of React, and 79.5 KB of
R3F's own reconciler and event layer. Choosing R3F costs **130.3 KB extra
brotli over vanilla, a 2.30x multiplier**, and only 50.8 KB of that is React
itself. The reconciler is the larger half.

Against the measured baseline of 37.6 KiB of first-party transfer:

| Scenario | First-party transfer | Multiple of today |
| --- | --- | --- |
| Today | 37.6 KB | 1.00x |
| Plus vanilla three.js | 137.5 KB | 3.66x |
| Plus React Three Fiber | 267.8 KB | 7.12x |

Framed against the JavaScript actually on the site today, which is 1738 bytes of
inline donut: vanilla three is 59 times that, R3F is 136 times.

### Recommendation: vanilla three.js

The reasons, in order of weight:

**R3F's value proposition does not apply here.** R3F earns its cost by letting a
React application express a scene declaratively, share state with React
components, and reuse the drei ecosystem. This site has no React application to
integrate with. Adding R3F means importing an entire component runtime and
reconciler to serve one island that no other part of the site talks to. The
130.3 KB buys ergonomics inside a paradigm the codebase does not otherwise use.

**Astro's architecture makes vanilla cheaper than it looks.** A vanilla island is
one `<script>` in one `.astro` file, code-split by Astro and loadable with
`client:visible` so it costs nothing until the hero scrolls into view. With R3F
the same deferral is possible, but the payload being deferred is 2.3 times
larger, and adopting `@astrojs/react` changes the build for the whole project
rather than for one component.

**The performance baseline is unusually strong and worth protecting.** 100
performance, 0 ms total blocking time, 0 CLS. 230 KB of brotli is meaningfully
more parse and execute work than 100 KB on a mid-range phone, and total blocking
time is the metric most exposed to it.

**The 99.9 KB floor is worth questioning too.** That figure is what a real
tree-shaken scene costs, and `WebGLRenderer` is most of it. Before committing to
either option, it is worth confirming that the graded-collection concept
actually needs a 3D renderer. If the cards are flat planes with shader
transitions, 2D canvas or CSS transforms with a small shader could land the
effect for a small fraction of 99.9 KB. That question is design-led and belongs
to Phase 2, but the bundle math is the same either way and the cheapest bundle
is the one not shipped.

If the design does call for real 3D, vanilla three.js on a `client:visible`
island is the right shape for this codebase.

---

## Reproducing these measurements

Scripts live in the session scratchpad, not in the repo, since they are
throwaway measurement tools:

- `shots.mjs`, Playwright screenshot capture
- `probe.mjs`, live runtime probe for computed styles, framework globals and the
  network request list
- `verify-contrast.mjs`, opacity verification at mobile emulation
- `bundle-test/`, the three entry points and esbuild invocation

The baseline build used a detached git worktree at `8e84b73` with a junction to
the main `node_modules`, so that uncommitted experiment files could not affect
the output.
