/**
 * Gate 4: two named falsifiers, each with screenshot evidence.
 *
 *   node scripts/verify/falsifiers.mjs [--url URL] [--out DIR]
 *
 * A. Beat 2, raking light on the hero. The starburst foil must read as a
 *    material, not as a mechanical grid. If it fails, the fix is seeded
 *    per-cell jitter in the procedural build, scripts/textures/d_holo.py.
 *
 * B. The slab rim highlight must not step along the corner curves. If it
 *    fails, the fix is more bevel segments in scripts/blender/spec.py and a
 *    re-export.
 *
 * Each falsifier is stated so it can come out false. The numeric test isolates
 * the term under suspicion rather than judging a composite, and the crop is
 * written out either way so the eye gets the last word, which is the lesson
 * PICKS.md records about seam detection: a ratio is not a substitute for
 * looking.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'docs/baseline/phase5-evidence/falsifiers');

/** A grid gives a sharp autocorrelation spike; a material gives a broad decay. */
const GRID_PEAK_LIMIT = 2.5;
/** More than this many equal steps around a 90 degree arc is faceting. */
const STEP_LIMIT = 4;

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function grey(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = luma(data[i * c], data[i * c + 1], data[i * c + 2]);
  }
  return { g: out, w, h };
}

/**
 * Normalised autocorrelation over horizontal lags, averaged down the rows.
 * A repeating cell of period T puts a spike at every multiple of T; a
 * stochastic material decays and stays flat.
 */
function autocorrPeak(g, w, h, minLag, maxLag) {
  let mean = 0;
  for (let i = 0; i < g.length; i++) mean += g[i];
  mean /= g.length;

  const score = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + lag < w; x++) {
        num += (g[y * w + x] - mean) * (g[y * w + x + lag] - mean);
        n++;
      }
    }
    score.push(n ? num / n : 0);
  }
  const abs = score.map(Math.abs);
  const avg = abs.reduce((a, b) => a + b, 0) / abs.length;
  const max = Math.max(...abs);
  return { ratio: avg > 0 ? max / avg : 0, lag: minLag + abs.indexOf(max) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const ready = await page.evaluate(() => !!window.__graded);
  if (!ready) throw new Error('the stage never started, so neither falsifier can be run');

  const results = [];

  /* ------------------------------------------------- A. starburst foil */

  // Park at the middle of beat 2's hold, which is where the reveal bell peaks
  // and the raking light is across the middle of the card.
  await page.evaluate(() => {
    const sec = document.getElementById('beat-2');
    const top = sec.offsetTop + sec.offsetHeight * 0.5 - window.innerHeight / 2;
    window.scrollTo({ top, behavior: 'instant' });
  });
  await page.waitForTimeout(900);

  const holoAmount = await page.evaluate(() => window.__graded.mats[0].uniforms.uHoloAmount.value);

  // The art window in card UV, from handoff spec section 04: x 7.619, y 5.057,
  // w 86.984, h 56.477 percent of the face. Projected through the live camera
  // so the crop follows the pose rather than a guessed rectangle.
  const box = await page.evaluate(() => {
    const g = window.__graded;
    const c = g.scene.getObjectByName('Card') ?? g.scene.getObjectByName('Card_1');
    const bb = c.geometry.boundingBox;
    const pts = [];
    for (const fx of [0.07619, 0.94317]) {
      for (const fy of [0.05057, 0.61534]) {
        const x = bb.min.x + (bb.max.x - bb.min.x) * fx;
        // The art window is measured from the top of the face.
        const y = bb.max.y - (bb.max.y - bb.min.y) * fy;
        pts.push(g.project(x, y, bb.max.z));
      }
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  });
  const clip = {
    x: Math.round(box.x), y: Math.round(box.y),
    width: Math.round(box.width), height: Math.round(box.height),
  };

  const withHolo = await page.screenshot({ clip });
  await page.evaluate(() => {
    for (const m of window.__graded.mats) m.uniforms.uHoloAmount.value = 0;
  });
  await page.waitForTimeout(400);
  const withoutHolo = await page.screenshot({ clip });
  await page.evaluate(() => {
    for (const m of window.__graded.mats) m.uniforms.uHoloAmount.value = 0.90;
  });

  fs.writeFileSync(path.join(OUT, 'a-beat2-art-window.png'), withHolo);
  fs.writeFileSync(path.join(OUT, 'a-beat2-art-window-no-holo.png'), withoutHolo);

  // The isolated holo contribution: everything else in the frame is identical
  // between the two captures, so the difference is only the foil term.
  const a = await grey(withHolo);
  const b = await grey(withoutHolo);
  const diff = new Float64Array(a.g.length);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.abs(a.g[i] - b.g[i]);

  // A spread over a few hundred thousand samples overflows the call stack.
  let dmax = 0;
  for (let i = 0; i < diff.length; i++) if (diff[i] > dmax) dmax = diff[i];
  if (!dmax) dmax = 1;
  await sharp(Buffer.from(Uint8Array.from(diff, (v) => Math.round((v / dmax) * 255))),
    { raw: { width: a.w, height: a.h, channels: 1 } })
    .png().toFile(path.join(OUT, 'a-beat2-holo-isolated.png'));

  const peak = autocorrPeak(diff, a.w, a.h, 6, Math.min(160, Math.floor(a.w / 3)));
  const gridA = peak.ratio > GRID_PEAK_LIMIT;
  results.push({
    id: 'A',
    claim: 'beat 2 raking light on the hero: the starburst foil reads as material, not as a mechanical grid',
    holoAmountAtCapture: holoAmount,
    autocorrelationPeakRatio: Number(peak.ratio.toFixed(2)),
    peakLagPx: peak.lag,
    limit: GRID_PEAK_LIMIT,
    verdict: gridA ? 'FALSIFIED' : 'HOLDS',
    evidence: ['a-beat2-art-window.png', 'a-beat2-art-window-no-holo.png', 'a-beat2-holo-isolated.png'],
    fixIfFalsified: 'seeded per-cell jitter in scripts/textures/d_holo.py, then rebuild the starburst normal',
  });

  /* ------------------------------------------------ B. slab corner rim */

  await page.evaluate(() => {
    const sec = document.getElementById('beat-1');
    const top = sec.offsetTop + sec.offsetHeight * 0.5 - window.innerHeight / 2;
    window.scrollTo({ top, behavior: 'instant' });
  });
  await page.waitForTimeout(900);

  // The top left outer corner of the slab, projected live. The arc centre is
  // one corner radius in from both edges, which is where the 12 segments turn.
  const corner = await page.evaluate(() => {
    const g = window.__graded;
    const s = g.scene.getObjectByName('Slab');
    s.geometry.computeBoundingBox();
    const bb = s.geometry.boundingBox;
    const R = 0.0042; // corner radius in metres, scripts/blender/spec.py
    const centre = g.project(bb.min.x + R, bb.max.y - R, bb.max.z);
    const edge = g.project(bb.min.x, bb.max.y, bb.max.z);
    return { centre, edge, radiusPx: Math.hypot(edge.x - centre.x, edge.y - centre.y) };
  });

  const pad = Math.max(28, corner.radiusPx * 3.4);
  const cornerClip = {
    x: Math.round(corner.centre.x - pad),
    y: Math.round(corner.centre.y - pad),
    width: Math.round(pad * 2),
    height: Math.round(pad * 2),
  };
  const cornerShot = await page.screenshot({ clip: cornerClip });
  fs.writeFileSync(path.join(OUT, 'b-slab-corner.png'), cornerShot);
  await sharp(cornerShot).resize(Math.round(cornerClip.width * 3), null,
    { kernel: 'nearest' }).png().toFile(path.join(OUT, 'b-slab-corner-3x.png'));

  /*
   * Sample the rim brightness around the corner arc and look for steps. A
   * faceted corner shades each of the 12 segments flat, so the intensity is
   * piecewise constant and the derivative in theta spikes once per facet. A
   * smoothed corner varies continuously and has no such spikes.
   */
  const cs = await grey(cornerShot);
  const cx = (corner.centre.x - cornerClip.x) * 3;
  const cy = (corner.centre.y - cornerClip.y) * 3;
  const rPx = corner.radiusPx * 3;
  const samples = [];
  const N = 220;
  for (let i = 0; i < N; i++) {
    const th = Math.PI / 2 + (Math.PI / 2) * (i / (N - 1)); // 90 to 180 degrees
    // Average a short radial band centred on the rim so a one pixel aliasing
    // artefact cannot be mistaken for a facet.
    let acc = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const r = rPx + k * 0.8;
      const x = Math.round(cx + r * Math.cos(th));
      const y = Math.round(cy + r * Math.sin(th));
      if (x < 0 || y < 0 || x >= cs.w || y >= cs.h) continue;
      acc += cs.g[y * cs.w + x];
      n++;
    }
    if (n) samples.push(acc / n);
  }
  const d1 = [];
  for (let i = 1; i < samples.length; i++) d1.push(Math.abs(samples[i] - samples[i - 1]));
  const meanD = d1.reduce((x, y) => x + y, 0) / (d1.length || 1);
  const sd = Math.sqrt(d1.reduce((x, y) => x + (y - meanD) ** 2, 0) / (d1.length || 1));
  const threshold = meanD + 3 * sd;
  let steps = 0;
  for (let i = 1; i < d1.length - 1; i++) {
    if (d1[i] > threshold && d1[i] >= d1[i - 1] && d1[i] >= d1[i + 1]) steps++;
  }

  const gridB = steps > STEP_LIMIT;
  results.push({
    id: 'B',
    claim: 'the slab rim highlight does not step along the corner curves',
    cornerRadiusPx: Number(corner.radiusPx.toFixed(1)),
    arcSamples: samples.length,
    stepsDetected: steps,
    limit: STEP_LIMIT,
    segmentsInModel: 12,
    verdict: gridB ? 'FALSIFIED' : 'HOLDS',
    evidence: ['b-slab-corner.png', 'b-slab-corner-3x.png'],
    fixIfFalsified: 'raise CORNER_SEGS in scripts/blender/spec.py and re-export with node scripts/phase4.mjs',
  });

  await browser.close();

  fs.writeFileSync(path.join(OUT, 'falsifiers.json'), `${JSON.stringify(results, null, 2)}\n`);
  for (const r of results) {
    console.log(`${r.id}  ${r.verdict}  ${r.claim}`);
    for (const [k, v] of Object.entries(r)) {
      if (['id', 'claim', 'verdict', 'evidence', 'fixIfFalsified'].includes(k)) continue;
      console.log(`      ${k.padEnd(26)} ${v}`);
    }
    console.log(`      evidence                   ${r.evidence.join(', ')}`);
    if (r.verdict === 'FALSIFIED') console.log(`      fix                        ${r.fixIfFalsified}`);
    console.log('');
  }
  const bad = results.filter((r) => r.verdict === 'FALSIFIED');
  console.log(bad.length ? `FALSIFIERS: ${bad.length} FAILED` : 'FALSIFIERS OK');
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
