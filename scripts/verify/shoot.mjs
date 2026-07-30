/**
 * Gate 1: layout screenshots.
 *
 *   node scripts/verify/shoot.mjs [--out DIR] [--url URL] [--tag NAME]
 *
 * Three widths against the handoff layouts, seven scroll positions each. The
 * scroll positions are percentages of the scrollable range, and the page is
 * given time to settle at each one because the slab is scrubbed rather than
 * tweened, so a shot taken mid-scroll is a shot of a pose that does not exist.
 *
 * At 390 the slab margin is expected to be slimmer than the mockup shows. That
 * is the ratio replacing the mockup's fixed 40px inset, per
 * docs/handoff/design-ref/README.md, and it is the intended result.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'docs/baseline-v1/phase5-evidence/screens');
const TAG = arg('--tag', '');
const REDUCED = args.includes('--reduced');

const WIDTHS = [
  { w: 390, h: 844, name: '390x844' },
  { w: 768, h: 1024, name: '768x1024' },
  { w: 1440, h: 900, name: '1440x900' },
];
const STOPS = [0, 15, 30, 45, 60, 75, 100];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  const rows = [];
  for (const v of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      deviceScaleFactor: 1,
      reducedMotion: REDUCED ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    const failed = [];
    page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
    page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));

    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    // The island hydrates at idle and then waits two frames plus 420ms before
    // the crossfade, so a shot taken on networkidle alone catches the poster.
    await page.waitForTimeout(REDUCED || v.w < 1024 ? 800 : 3500);

    const state = await page.evaluate(() => {
      const stage = document.querySelector('[data-stage]');
      return {
        canvas: stage?.getAttribute('data-canvas') ?? 'absent',
        dpr: stage?.getAttribute('data-dpr') ?? '',
        probeFps: stage?.getAttribute('data-probe-fps') ?? '',
      };
    });

    for (const pctStop of STOPS) {
      await page.evaluate((p) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: (max * p) / 100, behavior: 'instant' });
      }, pctStop);
      await page.waitForTimeout(700);
      /*
       * Captured as PNG and stored as WebP at quality 90. Forty-two full page
       * captures across three widths is 8.8 MB of PNG in the repository
       * against 2.0 MB here, and these are read for layout, not for
       * pixel-level judgements. The falsifier crops stay lossless, because
       * those are exactly the pixel-level judgements this is not.
       */
      const name = `${TAG ? `${TAG}-` : ''}${v.name}-${String(pctStop).padStart(3, '0')}.webp`;
      const shot = await page.screenshot();
      await sharp(shot).webp({ quality: 90, effort: 6 }).toFile(path.join(OUT, name));
      rows.push({ viewport: v.name, scroll: pctStop, file: name });
    }

    // Back to the top before reading the renderer, so the draw call count is
    // the hero beat rather than whatever beat 7 happened to leave up.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);
    const beatState = await page.evaluate(() => {
      const g = window.__graded;
      if (!g) return null;
      return { beat: g.activeBeat(), calls: g.info().render.calls, tris: g.info().render.triangles };
    });

    console.log(`${v.name}  canvas=${state.canvas}` +
      `${state.dpr ? ` dpr=${state.dpr}` : ''}${state.probeFps ? ` probe=${state.probeFps}fps` : ''}` +
      `${beatState ? ` drawCalls=${beatState.calls} tris=${beatState.tris}` : ''}`);
    if (failed.length) {
      console.log('  request failures:');
      for (const f of failed) console.log(`    ${f}`);
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\n${rows.length} shots in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
