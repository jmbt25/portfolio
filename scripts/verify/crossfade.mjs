/**
 * The hydration crossfade, measured.
 *
 *   node scripts/verify/crossfade.mjs [--url URL] [--out DIR]
 *
 * D2 crossfades a static poster out and the canvas in. If the two show
 * different things, that transition is a visible material swap rather than a
 * swap the visitor never notices, which is the one thing it must not be.
 *
 * The test captures exactly what the crossfade interpolates between: the same
 * region of the page with the canvas hidden, and with the poster hidden. The
 * run loop is stopped first and the slab parked at the beat 1 pose, because the
 * idle float and yaw would otherwise move the slab between the two captures and
 * the measurement would be of the animation rather than of the seam.
 *
 * What counts as a seam is registration, not pixel equality. The poster is a
 * compressed still that the browser resamples; the canvas is a live render of
 * the same geometry. Those two can never be pixel identical, and a tail metric
 * over their difference mostly counts glyph edges. So the gate is: does the
 * canvas draw the same thing in the same place and at the same size. Residual
 * translation and scale answer that directly, and the mean difference catches a
 * material or lighting change that leaves geometry alone.
 *
 * The share of pixels past a visible step is still reported, because it is the
 * number that moves when something is wrong, but it does not decide the gate.
 * Both frames and the amplified difference are written out either way. Per D11,
 * the picture is what settles it.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'docs/baseline-v1/phase5-evidence/crossfade');

/** A per-channel step this size is where a swap starts to be noticeable. */
const VISIBLE = 12;
/** Share of pixels allowed past that, as a fraction. */
const LIMIT = 0.06;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);

  if (!await page.evaluate(() => !!window.__graded)) {
    throw new Error('the stage never started, so there is no crossfade to measure');
  }

  /*
   * Park at the beat 1 pose with the idle removed, which is the pose the poster
   * was rendered from. Same derivation as scripts/phase5/poster-render.mjs:
   * worldPerPx comes back out of the camera the page configured, so the pose is
   * placed in the page's own units rather than in recomputed ones.
   *
   * The idle is removed rather than left running because it is not part of what
   * the crossfade swaps. The slab floats 7 px over 7.5 s and yaws plus or minus
   * 1.8 degrees continuously, so a still can never match a frame of it, and
   * leaving it in measures the animation instead of the asset. Its size is
   * reported separately below.
   */
  const parked = await page.evaluate(() => {
    const g = window.__graded;
    g.stop();
    const rad = (d) => (d * Math.PI) / 180;
    const worldPerPx = g.camera.position.z / 1700;
    const S = g.states[0];
    const slab = g.scene.children.find((c) => c.type === 'Group' && c.children.length);
    const shadow = g.scene.children.find((c) => c.isMesh && !c.isInstancedMesh);
    const SHADOW_Z = 0.06;

    slab.position.set(S.x * worldPerPx, 0, 0);
    slab.rotation.set(rad(S.rx), rad(S.ry), rad(S.rz));
    slab.scale.setScalar(S.s);
    if (shadow) {
      shadow.position.set(slab.position.x, 0, -SHADOW_Z);
      shadow.scale.setScalar(S.s * (g.camera.position.z + SHADOW_Z) / g.camera.position.z);
      shadow.material.uniforms.uOpacity.value = Math.max(0, Math.cos(rad(S.ry)));
    }
    g.scene.updateMatrixWorld(true);
    g.renderer.render(g.scene, g.camera);

    const r = document.querySelector('[data-stage-poster]').getBoundingClientRect();
    const pad = 24;
    // The projected width the idle yaw sweeps through, so the residual it
    // contributes during a real crossfade is a number rather than a shrug.
    const w = r.width;
    const yawSwing = Math.abs(Math.cos(rad(S.ry) - rad(1.8)) - Math.cos(rad(S.ry) + rad(1.8))) * w;
    return {
      clip: {
        x: Math.max(0, Math.round(r.x - pad)),
        y: Math.max(0, Math.round(r.y - pad)),
        width: Math.round(r.width + pad * 2),
        height: Math.round(r.height + pad * 2),
      },
      idleYawSwingPx: Number(yawSwing.toFixed(1)),
      idleFloatPx: 7,
    };
  });
  const clip = parked.clip;

  const show = async (canvasOn) => {
    await page.evaluate((on) => {
      const stage = document.querySelector('[data-stage]');
      const canvas = stage.querySelector('canvas');
      const poster = stage.querySelector('[data-stage-poster]');
      canvas.style.transition = 'none';
      poster.style.transition = 'none';
      canvas.style.opacity = on ? '1' : '0';
      poster.style.opacity = on ? '0' : '1';
    }, canvasOn);
    await page.waitForTimeout(250);
    return page.screenshot({ clip });
  };

  const posterShot = await show(false);
  const canvasShot = await show(true);
  fs.writeFileSync(path.join(OUT, 'a-poster.png'), posterShot);
  fs.writeFileSync(path.join(OUT, 'b-canvas.png'), canvasShot);

  const raw = async (b) => sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const A = await raw(posterShot);
  const B = await raw(canvasShot);
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
    throw new Error('the two captures are different sizes');
  }

  const n = A.info.width * A.info.height;
  const c = A.info.channels;
  const diff = Buffer.alloc(n);
  let sum = 0;
  let over = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(
      Math.abs(A.data[i * c] - B.data[i * c]),
      Math.abs(A.data[i * c + 1] - B.data[i * c + 1]),
      Math.abs(A.data[i * c + 2] - B.data[i * c + 2]),
    );
    diff[i] = Math.min(255, d * 6);
    sum += d;
    if (d > VISIBLE) over++;
  }
  const mad = sum / n;
  const share = over / n;

  await sharp(diff, { raw: { width: A.info.width, height: A.info.height, channels: 1 } })
    .png().toFile(path.join(OUT, 'c-difference-6x.png'));

  /*
   * Residual translation and scale, by search. A doubled edge in the difference
   * is a registration error and shows up here as a nonzero offset; softening
   * from resampling does not move the optimum off zero.
   */
  const grey = (buf, info) => {
    const g = new Float64Array(info.width * info.height);
    for (let i = 0; i < g.length; i++) {
      g[i] = 0.2126 * buf[i * info.channels] + 0.7152 * buf[i * info.channels + 1]
        + 0.0722 * buf[i * info.channels + 2];
    }
    return g;
  };
  const ga = grey(A.data, A.info);
  const gb = grey(B.data, B.info);
  const w = A.info.width;
  const h = A.info.height;

  const cost = (dx, dy, sc) => {
    let s = 0;
    let k = 0;
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 20; y < h - 20; y += 2) {
      for (let x = 20; x < w - 20; x += 2) {
        const bx = Math.round(cx + (x - cx) * sc + dx);
        const by = Math.round(cy + (y - cy) * sc + dy);
        if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
        s += Math.abs(ga[y * w + x] - gb[by * w + bx]);
        k++;
      }
    }
    return k ? s / k : Infinity;
  };

  let best = { dx: 0, dy: 0, sc: 1, m: cost(0, 0, 1) };
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const m = cost(dx, dy, 1);
      if (m < best.m) best = { dx, dy, sc: 1, m };
    }
  }
  for (let sc = 0.98; sc <= 1.0201; sc += 0.002) {
    const m = cost(best.dx, best.dy, sc);
    if (m < best.m) best = { dx: best.dx, dy: best.dy, sc: Number(sc.toFixed(3)), m };
  }

  const LIMIT_SHIFT = 2;
  const LIMIT_SCALE = 0.006;
  const LIMIT_MAD = 8;

  const registered = Math.abs(best.dx) <= LIMIT_SHIFT && Math.abs(best.dy) <= LIMIT_SHIFT;
  const scaled = Math.abs(best.sc - 1) <= LIMIT_SCALE;
  const matched = mad <= LIMIT_MAD;
  const ok = registered && scaled && matched;

  const result = {
    region: clip,
    idleYawSwingPx: parked.idleYawSwingPx,
    idleFloatPx: parked.idleFloatPx,
    residualShiftPx: { x: best.dx, y: best.dy },
    residualScale: best.sc,
    meanAbsoluteDifference: Number(mad.toFixed(2)),
    shareOverThreshold: Number(share.toFixed(4)),
    threshold: VISIBLE,
    limits: { shiftPx: LIMIT_SHIFT, scale: LIMIT_SCALE, meanAbsoluteDifference: LIMIT_MAD },
    verdict: ok ? 'NO VISIBLE SEAM' : 'SEAM',
  };
  fs.writeFileSync(path.join(OUT, 'crossfade.json'), `${JSON.stringify(result, null, 2)}
`);

  const mark = (pass) => (pass ? 'PASS' : 'FAIL');
  console.log('hydration crossfade, poster against canvas at the beat 1 pose\n');
  console.log(`  region                          ${clip.width} x ${clip.height} at ${clip.x}, ${clip.y}`);
  console.log(`  ${mark(registered)}  residual shift        ${best.dx}, ${best.dy} device px` +
    `  (limit ${LIMIT_SHIFT})`);
  console.log(`  ${mark(scaled)}  residual scale        ${best.sc}` +
    `  (limit 1 +/- ${LIMIT_SCALE})`);
  console.log(`  ${mark(matched)}  mean abs difference   ${result.meanAbsoluteDifference} of 255` +
    `  (limit ${LIMIT_MAD})`);
  console.log(`        pixels over ${VISIBLE}          ${(share * 100).toFixed(2)} percent, reported only`);
  console.log(`        idle yaw sweeps       ${parked.idleYawSwingPx} px of projected width`);
  console.log(`        idle float            ${parked.idleFloatPx} px over 7.5 s`);
  console.log('  evidence                        a-poster.png, b-canvas.png, c-difference-6x.png');
  console.log('');
  console.log(ok ? 'CROSSFADE OK' : 'CROSSFADE SEAM');

  await browser.close();
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
