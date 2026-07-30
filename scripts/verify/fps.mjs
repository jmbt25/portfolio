/**
 * Gate 3: scripted-scroll frame trace over the DevTools protocol.
 *
 *   node scripts/verify/fps.mjs [--url URL] [--headless]
 *
 * Fails below 55 fps at p5.
 *
 * p5 rather than a mean, because a scrubbed scene is judged on its worst
 * frames. A mean of 60 with a stall at every beat boundary is exactly the
 * failure this is meant to catch, and a mean cannot see it.
 *
 * The trace comes from the browser's own DrawFrame events rather than from a
 * requestAnimationFrame counter inside the page. A rAF counter measures how
 * often the callback ran, which is not the same as how often a frame reached
 * the screen, and it cannot see a frame the compositor dropped.
 *
 * The renderer string is printed with the result. A number produced by
 * SwiftShader is a software rasteriser's floor and says nothing about the
 * machine this ships to, so it is reported as what it is rather than as a pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'docs/baseline-v1/phase5-evidence');
const HEADLESS = args.includes('--headless');
const DPR = Number(arg('--dpr', '1'));

const TARGET_P5 = 55;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i];
}

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2');
    const d = g?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g?.getParameter(g.RENDERER) ?? 'none'),
      canvas: document.querySelector('[data-stage]')?.getAttribute('data-canvas') ?? 'absent',
      dpr: document.querySelector('[data-stage]')?.getAttribute('data-dpr') ?? '',
    };
  });

  const client = await page.context().newCDPSession(page);
  const events = [];
  client.on('Tracing.dataCollected', ({ value }) => { events.push(...value); });

  await client.send('Tracing.start', {
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: [
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
      ],
    },
  });

  /*
   * A scripted scroll through the whole document at a fixed step per frame.
   * It runs inside the page on rAF rather than as a sequence of scrollTo calls
   * from the driver, so the scrub is continuous and the trace covers the beat
   * boundaries, which is where the work actually is.
   */
  await page.evaluate(async () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 400));
    const STEP = max / (60 * 12); // roughly 12 seconds at 60 fps
    await new Promise((resolve) => {
      let y = 0;
      const tick = () => {
        y += STEP;
        window.scrollTo({ top: Math.min(y, max), behavior: 'instant' });
        if (y >= max) resolve(undefined);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  const done = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  await done;

  /*
   * Only DrawFrame, and only one per timestamp. The frame category also emits
   * BeginFrame and per-thread duplicates for the same presented frame, and
   * counting those turns a 60 fps trace into an 800 fps one made of sub
   * millisecond gaps between events describing the same frame.
   */
  const frames = [...new Set(events.filter((e) => e.name === 'DrawFrame').map((e) => e.ts))]
    .sort((a, b) => a - b);

  const deltas = [];
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i] - frames[i - 1]) / 1000; // microseconds to milliseconds
    if (dt >= 1 && dt < 500) deltas.push(dt);
  }
  const fps = deltas.map((d) => 1000 / d).sort((a, b) => a - b);

  const result = {
    renderer: gl.renderer,
    canvas: gl.canvas,
    devicePixelRatio: gl.dpr,
    frames: frames.length,
    p5: Number(percentile(fps, 5).toFixed(1)),
    p50: Number(percentile(fps, 50).toFixed(1)),
    p95: Number(percentile(fps, 95).toFixed(1)),
    worstFrameMs: Number((deltas.length ? Math.max(...deltas) : 0).toFixed(1)),
  };

  const software = /swiftshader|llvmpipe|software/i.test(String(result.renderer));

  console.log('scripted-scroll frame trace, 1440x900, one pass over the whole document\n');
  console.log(`  renderer          ${result.renderer}`);
  console.log(`  canvas state      ${result.canvas}`);
  console.log(`  device pixel ratio ${result.devicePixelRatio}`);
  console.log(`  frames traced     ${result.frames}`);
  console.log(`  p5                ${result.p5} fps`);
  console.log(`  p50               ${result.p50} fps`);
  console.log(`  p95               ${result.p95} fps`);
  console.log(`  worst frame       ${result.worstFrameMs} ms\n`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `fps-dpr${DPR}.json`), `${JSON.stringify(result, null, 2)}\n`);

  await browser.close();

  if (software) {
    console.log('SOFTWARE RASTERISER. This number is a floor, not a verdict. The gate is');
    console.log('not evaluated against it. Re-run without --headless on the target machine.');
    return;
  }
  const ok = result.p5 >= TARGET_P5;
  console.log(ok
    ? `FPS PASS  p5 ${result.p5} at or above ${TARGET_P5}`
    : `FPS FAIL  p5 ${result.p5} below ${TARGET_P5}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
