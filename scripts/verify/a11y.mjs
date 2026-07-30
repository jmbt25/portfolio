/**
 * Gate 6: axe-core, plus the fallback paths, all verified by running.
 *
 *   node scripts/verify/a11y.mjs [--url URL]
 *
 * Fails on any axe violation, on a canvas that is not aria-hidden, or on a
 * fallback that does not actually take the static path.
 *
 * The fallbacks are here rather than in their own script because they are the
 * same question asked four ways: does the page still deliver all seven beats as
 * plain HTML when the renderer is not available. D2 makes that path the one
 * every visitor renders, so it is checked the way a shipped path is checked.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'docs/baseline-v1/phase5-evidence');

let failed = false;
const report = {};

function check(label, ok, detail) {
  if (!ok) failed = true;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

/** Every beat's copy must be present in the DOM whichever path is taken. */
const REQUIRED_COPY = [
  'joshua',
  'Data Scientist / AI Systems Engineer',
  'Build the boring rails first',
  'komikfind',
  'kalakal',
  'Raidyard',
  'dotaweakness',
  'Five cards, one set.',
  'github.com/jmbt25',
  'x.com/jmbt_dev',
];

async function contentComplete(page) {
  const text = await page.evaluate(() => document.body.innerText);
  return REQUIRED_COPY.filter((c) => !text.includes(c));
}

async function scenario(browser, name, contextOpts, prep) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...contextOpts,
  });
  const page = await ctx.newPage();
  if (prep) await prep(page);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => {
    const stage = document.querySelector('[data-stage]');
    return {
      canvasState: stage?.getAttribute('data-canvas') ?? 'never started',
      webglContexts: window.__graded ? 1 : 0,
      canvasAriaHidden: document.querySelector('canvas')?.getAttribute('aria-hidden') ?? null,
      stageAriaHidden: stage?.getAttribute('aria-hidden') ?? null,
      posterVisible: !!document.querySelector('[data-stage-poster]'),
      // C1: nothing carrying text may be composited at an alpha below 1.
      textOpacities: [...document.querySelectorAll('[data-reveal], h1, h2, p, dd, dt, a')]
        .map((el) => Number(getComputedStyle(el).opacity))
        .filter((o) => o < 1),
      revealTransforms: [...document.querySelectorAll('[data-reveal]')]
        .map((el) => getComputedStyle(el).transform),
    };
  });
  const missing = await contentComplete(page);
  return { page, ctx, state, missing };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  /* ------------------------------------------------------------- axe-core */

  console.log('axe-core, 1440x900 and 390x844\n');
  for (const [label, viewport] of [
    ['1440x900', { width: 1440, height: 900 }],
    ['390x844', { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(viewport.width >= 1024 ? 3500 : 800);
    // Scroll through once so every reveal has fired and no panel is audited in
    // its pre-entrance transform.
    await page.evaluate(async () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      for (let p = 0; p <= 1.0001; p += 0.1) {
        window.scrollTo({ top: max * p, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(700);

    await page.addScriptTag({ path: AXE });
    const res = await page.evaluate(async () => window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    }));
    report[`axe-${label}`] = res.violations.map((v) => ({
      id: v.id, impact: v.impact, nodes: v.nodes.length,
      help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
    check(`axe ${label}`, res.violations.length === 0,
      `${res.violations.length} violation(s)`);
    for (const v of res.violations) {
      console.log(`          ${v.id} (${v.impact}, ${v.nodes.length} node(s)) ${v.help}`);
      for (const n of v.nodes.slice(0, 5)) console.log(`            ${n.target.join(' ')}`);
    }
    await ctx.close();
  }

  /* ---------------------------------------------------------- canvas ARIA */

  console.log('\ncanvas and stage are out of the accessibility tree\n');
  {
    const s = await scenario(browser, 'wide', {});
    check('canvas aria-hidden', s.state.canvasAriaHidden === 'true', `= ${s.state.canvasAriaHidden}`);
    check('stage aria-hidden', s.state.stageAriaHidden === 'true', `= ${s.state.stageAriaHidden}`);
    check('canvas is not focusable', await s.page.evaluate(
      () => document.querySelector('canvas')?.tabIndex !== 0), '');
    check('all seven beats present as text', s.missing.length === 0,
      s.missing.length ? `missing ${s.missing.join(', ')}` : '');
    check('C1: no text subtree below opacity 1', s.state.textOpacities.length === 0,
      s.state.textOpacities.length ? `${s.state.textOpacities.length} element(s)` : '');
    report.wide = s.state;
    await s.ctx.close();
  }

  /* ------------------------------------------------------------ fallbacks */

  console.log('\nfallback paths\n');

  {
    const s = await scenario(browser, 'reduced', { reducedMotion: 'reduce' });
    check('reduced motion: no WebGL started', s.state.webglContexts === 0,
      `canvas state ${s.state.canvasState}`);
    check('reduced motion: content complete', s.missing.length === 0,
      s.missing.length ? `missing ${s.missing.join(', ')}` : '');
    check('reduced motion: content settled, no entrance transform',
      s.state.revealTransforms.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'),
      s.state.revealTransforms.filter((t) => t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)').join(' | '));
    report.reduced = s.state;
    await s.ctx.close();
  }

  {
    const s = await scenario(browser, 'mobile',
      { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    check('390px: no WebGL started', s.state.webglContexts === 0,
      `canvas state ${s.state.canvasState}`);
    check('390px: content complete', s.missing.length === 0,
      s.missing.length ? `missing ${s.missing.join(', ')}` : '');
    report.mobile = s.state;
    await s.ctx.close();
  }

  {
    // WebGL2 removed before any page script runs, which is the shape of the
    // real failure: a browser or a driver that simply does not offer it.
    const s = await scenario(browser, 'no-webgl2', {}, async (page) => {
      await page.addInitScript(() => {
        const real = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type === 'webgl2') return null;
          return real.call(this, type, ...rest);
        };
      });
    });
    check('no WebGL2: nothing started', s.state.webglContexts === 0,
      `canvas state ${s.state.canvasState}`);
    check('no WebGL2: content complete', s.missing.length === 0,
      s.missing.length ? `missing ${s.missing.join(', ')}` : '');
    report.noWebgl2 = s.state;
    await s.ctx.close();
  }

  {
    // Context loss, forced through the extension the browser provides for it,
    // after the scene is already running and visible.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    const before = await page.evaluate(() =>
      document.querySelector('[data-stage]')?.getAttribute('data-canvas'));
    const lost = await page.evaluate(async () => {
      const gl = window.__graded.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'extension unavailable';
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 700));
      return document.querySelector('[data-stage]')?.getAttribute('data-canvas');
    });
    const posterBack = await page.evaluate(() =>
      Number(getComputedStyle(document.querySelector('[data-stage-poster]')).opacity));
    const stillThere = await contentComplete(page);
    check('context loss: canvas ready before', before === 'ready', `= ${before}`);
    check('context loss: swaps to the static path', lost === 'lost', `= ${lost}`);
    check('context loss: poster returns to full opacity', posterBack === 1, `opacity ${posterBack}`);
    check('context loss: content complete', stillThere.length === 0,
      stillThere.length ? `missing ${stillThere.join(', ')}` : '');
    await page.screenshot({ path: path.join(OUT, 'fallback-context-loss.png') });
    report.contextLoss = { before, after: lost, posterOpacity: posterBack };
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'a11y.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(failed ? '\nA11Y AND FALLBACKS FAIL' : '\nA11Y AND FALLBACKS OK');
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
