/**
 * Render the hero poster from the current Phase 5 scene.
 *
 *   node scripts/phase5/poster-render.mjs [--url URL] [--out FILE] [--set k=v ...]
 *
 * The Phase 4 poster was a render of the placeholder slab material, so the
 * canvas crossfading in over it swapped one material for another. This renders
 * the same pose, through the same camera, from the scene that actually ships,
 * which removes the swap rather than tuning around it.
 *
 * The camera is the page's own, not Phase 4's, and that is a deliberate
 * departure worth stating plainly because it looks like a smaller decision than
 * it is.
 *
 * Phase 4 framed the slab with a fit-based camera: fov 26, the posed bounding
 * box fitted with a 1.16 margin, which put the camera 0.3496 m away. The live
 * scene reproduces the mockup's `perspective: 1700px`, which at 1440 x 900 puts
 * it 0.3775 m away at a fov of 29.6. The slab is 7 mm deep, so its near face
 * magnifies differently under the two, and the canvas draws the posed slab
 * 8.25 percent wider than a Phase 4 framed poster expects. Measured, not
 * assumed. No single scale factor registers them, because the difference is in
 * the perspective and not only in the size.
 *
 * A poster rendered through a different camera than the canvas therefore cannot
 * be seamless, and seamlessness is the reason this render exists. So the poster
 * is rendered through the page's camera, at the page's own beat 1 pose,
 * including the 318 px offset from centre, since an off-axis object carries
 * asymmetric perspective that a centred render would not reproduce. The output
 * is still 2880 x 1800, which is 2x the 1440 x 900 the gates shoot at and the
 * same size Phase 4 produced. The composition is preserved by the crop rather
 * than by the camera.
 *
 * The residual: the page's camera distance depends on `--cw`, so one poster is
 * exact at one width. Across the whole range the 3D path runs at, `--cw` 245.8
 * to 372, the near-face magnification varies from 1.044 to 1.068, so a poster
 * rendered at 1440 is within 2 percent everywhere and exact at the width the
 * gates measure.
 *
 * Also deliberately not Phase 4's: the light rig. Phase 4 lit
 * MeshStandardMaterials with directional lights and a room environment. The
 * Phase 5 materials carry their own light directions as uniforms, so the poster
 * is lit by the shaders that will draw the canvas over it. That is the whole
 * point of re-rendering it.
 *
 * The contact shadow is included, because the canvas draws one and a poster
 * without it would misalign at the crossfade.
 *
 * Alongside the PNG this writes the geometry the crop needs: the slab's
 * projected bounding box at the beat 1 pose, and its projected width with the
 * rotation removed. Measuring both means the crop and the CSS that sizes the
 * poster are derived from the same render rather than from a constant copied
 * out of PHASE4.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE_URL = arg('--url', 'http://localhost:4321/');
const OUT = arg('--out', 'assets-src/poster/slab-poster-phase5-2x-2880x1800.png');

/** ACES for an A/B against no tone mapping, since 4 is ACESFilmicToneMapping. */

/** Slab material overrides, as --set uBaseAlpha=0.3 --set uGlass=0xeef1f3 */
const SETS = args.reduce((acc, a, i) => {
  if (a !== '--set') return acc;
  const [k, v] = String(args[i + 1] ?? '').split('=');
  if (k) acc[k] = v;
  return acc;
}, {});

/** Phase 4's output size, kept. 2x the 1440 x 900 the gates shoot at. */
const W = 2880;
const H = 1800;
const PAPER = 0xfaf5ee;

/** Beat 1 hero pose, handoff spec section 08. */
const POSE = { rx: 6, ry: -16, rz: -2 };

async function main() {
  const browser = await chromium.launch({
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);

  const ready = await page.evaluate(() => !!window.__graded);
  if (!ready) throw new Error('the stage never started, so there is nothing to render');

  const TONEMAP = arg('--tonemap', '');

  const result = await page.evaluate(async ({ W, H, PAPER, POSE, SETS, TONEMAP }) => {
    const g = window.__graded;
    const { renderer, scene, camera } = g;

    // Freeze the run loop. The idle float and yaw would otherwise put the pose
    // somewhere between frames and the poster would not be the beat 1 pose.
    g.stop();

    if (TONEMAP === 'aces') { renderer.toneMapping = 4; renderer.toneMappingExposure = 1.05; }

    for (const [k, v] of Object.entries(SETS)) {
      const u = g.slabMat.uniforms[k];
      if (!u) throw new Error(`no slab uniform named ${k}`);
      if (u.value && typeof u.value.setHex === 'function') u.value.setHex(Number(v));
      else u.value = Number(v);
    }

    const slab = scene.children.find((c) => c.type === 'Group' && c.children.length);
    const fan = scene.children.find((c) => c.isInstancedMesh);
    const shadow = scene.children.find((c) => c.isMesh && !c.isInstancedMesh);
    if (fan) fan.visible = false;

    /*
     * Park at the beat 1 pose with the idle removed, doing by hand exactly what
     * the run loop does with the float and yaw at zero. worldPerPx comes back
     * out of the camera the page already configured, so the pose is placed in
     * the page's own units rather than in recomputed ones.
     */
    const rad = (d) => (d * Math.PI) / 180;
    const worldPerPx = camera.position.z / 1700;
    const SHADOW_Z = 0.06;

    slab.position.set(318 * worldPerPx, 0, 0);
    slab.rotation.set(rad(POSE.rx), rad(POSE.ry), rad(POSE.rz));
    slab.scale.setScalar(1);

    if (shadow) {
      shadow.position.set(slab.position.x, 0, -SHADOW_Z);
      shadow.scale.setScalar((camera.position.z + SHADOW_Z) / camera.position.z);
      shadow.material.uniforms.uOpacity.value = Math.max(0, Math.cos(rad(POSE.ry)));
    }
    scene.updateMatrixWorld(true);

    // A Vector3 without importing three: clone one the scene already owns.
    const vec = (x, y, z) => camera.position.clone().set(x, y, z);

    // 2x the 1440 x 900 the gates shoot at, which is also Phase 4's size.
    const renderScale = 2;
    renderer.setPixelRatio(renderScale);
    renderer.setSize(W / 2, H / 2, false);
    renderer.setClearColor(PAPER, 1);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    /** Screen-space bounding box of one mesh, in render pixels. */
    function screenBox(o) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [b.min.x, b.max.x]) {
        for (const y of [b.min.y, b.max.y]) {
          for (const z of [b.min.z, b.max.z]) {
            const p = vec(x, y, z);
            o.localToWorld(p);
            p.project(camera);
            const sx = (p.x * 0.5 + 0.5) * W;
            const sy = (-p.y * 0.5 + 0.5) * H;
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
            y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
          }
        }
      }
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    const slabMesh = scene.getObjectByName('Slab');
    const posed = screenBox(slabMesh);

    /*
     * Where the stylesheet anchors the poster: the slab group's origin, which
     * sits on the z = 0 plane and therefore projects to exactly 318 CSS px
     * right of the viewport centre.
     *
     * The slab's projected bounding box is not centred on that point. The case
     * is 7 mm deep and turned 16 degrees, so its near half magnifies and its
     * far half shrinks, and the visual centre lands to one side of the object
     * centre. Cropping the poster on the projected centre and positioning it on
     * the object centre is a 9 px horizontal offset at 1440, which is what a
     * ghosted edge in the crossfade difference looks like.
     */
    const anchorV = vec(0, 0, 0);
    slab.localToWorld(anchorV);
    anchorV.project(camera);
    const anchor = {
      x: (anchorV.x * 0.5 + 0.5) * W,
      y: (-anchorV.y * 0.5 + 0.5) * H,
    };
    const bboxM = { x: 0, y: 0, z: 0 };

    // The same slab with the pose removed, which is the width the page sizes
    // the slab by. Measured rather than carried over as a constant.
    slab.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    const flat = screenBox(slabMesh);
    slab.rotation.set(rad(POSE.rx), rad(POSE.ry), rad(POSE.rz));
    scene.updateMatrixWorld(true);

    renderer.render(scene, camera);
    // Read back in the same task as the render. The context has no
    // preserveDrawingBuffer, so the buffer is still intact only until the
    // browser presents it.
    const data = renderer.domElement.toDataURL('image/png');

    return {
      data,
      posed: { x: posed.x, y: posed.y, width: posed.width, height: posed.height },
      flatWidth: flat.width,
      cameraZ: camera.position.z,
      worldPerPx,
      renderScale,
      /*
       * The slab's width on the z = 0 plane, which is the width the page sizes
       * it by and therefore the only correct denominator for the poster ratio.
       *
       * Not the projected bounding box: the case is 7 mm deep, so even
       * unrotated its front face sits 3.5 mm nearer the camera and magnifies by
       * about 0.9 percent, and the bounding box takes the maximum over every
       * corner. Using the box here made the poster 1.55 percent too small and
       * the crossfade ghosted by 8 device pixels.
       */
      flatAtZ0: (0.085 / worldPerPx) * renderScale,
      anchor,
      bboxM,
    };
  }, { W, H, PAPER, POSE, SETS, TONEMAP });

  await browser.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const png = Buffer.from(result.data.split(',')[1], 'base64');
  fs.writeFileSync(OUT, png);

  const meta = {
    file: path.basename(OUT),
    width: W,
    height: H,
    camera: {
      model: 'page, perspective 1700px at 1440x900',
      z: Number(result.cameraZ.toFixed(5)),
      worldPerPx: Number(result.worldPerPx.toFixed(8)),
    },
    pose: POSE,
    slabPosedPx: {
      x: Number(result.posed.x.toFixed(2)),
      y: Number(result.posed.y.toFixed(2)),
      width: Number(result.posed.width.toFixed(2)),
      height: Number(result.posed.height.toFixed(2)),
    },
    slabFlatWidthPx: Number(result.flatWidth.toFixed(2)),
    slabFlatWidthAtZ0Px: Number(result.flatAtZ0.toFixed(2)),
    anchorPx: { x: Number(result.anchor.x.toFixed(2)), y: Number(result.anchor.y.toFixed(2)) },
    posedOverFlat: Number((result.posed.width / result.flatWidth).toFixed(5)),
    overrides: SETS,
    note: 'Generated by scripts/phase5/poster-render.mjs. Do not edit by hand.',
  };
  const metaPath = OUT.replace(/\.png$/, '.json');
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`${OUT}  ${png.length} B  ${W} x ${H}`);
  console.log(`  camera z                    ${meta.camera.z}  (page camera, not Phase 4's)`);
  console.log(`  slab posed, render px       ${meta.slabPosedPx.width} x ${meta.slabPosedPx.height}` +
    ` at ${meta.slabPosedPx.x}, ${meta.slabPosedPx.y}`);
  console.log(`  slab flat bbox, render px   ${meta.slabFlatWidthPx}`);
  console.log(`  slab flat at z=0, render px ${meta.slabFlatWidthAtZ0Px}  (the ratio denominator)`);
  console.log(`  css anchor, render px       ${meta.anchorPx.x}, ${meta.anchorPx.y}`);
  console.log(`  projected centre offset     ${(meta.slabPosedPx.x + meta.slabPosedPx.width / 2 - meta.anchorPx.x).toFixed(2)}` +
    `, ${(meta.slabPosedPx.y + meta.slabPosedPx.height / 2 - meta.anchorPx.y).toFixed(2)}`);
  console.log(`  posed over flat             ${meta.posedOverFlat}`);
  if (Object.keys(SETS).length) console.log(`  overrides                   ${JSON.stringify(SETS)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
