/**
 * Phase 5 asset pipeline.
 *
 *   node scripts/phase5/assets.mjs
 *
 * Everything Phase 5 ships out of public/ is produced here, from sources that
 * were already committed by Phases 1 through 4. Nothing in this script
 * generates new imagery; it crops, resamples, transcodes and places.
 *
 * Steps:
 *   1  poster       crop the Phase 4 2x render to the slab, emit WebP + metrics
 *   2  og           1200x630 social card built from the same render
 *   3  faces        five card faces to WebP for the static and narrow layouts
 *   4  paper        the warm-white grain tile
 *   5  holo         four tiling holo normals to KTX2 UASTC
 *   6  lazy         the four staged KTX2 card sets placed under public/
 *
 * The poster step writes src/data/poster.json. The page reads its ratios from
 * that file rather than carrying a hand-copied constant, so the CSS that sizes
 * the poster and the crop that produced it cannot drift apart.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const SRC = path.join(REPO, 'assets-src');
const OUT = path.join(REPO, 'public', 'assets');
const CARDS = path.join(OUT, 'cards');
const DATA = path.join(REPO, 'src', 'data');

const KTX_BIN = process.env.KTX_BIN || 'C:\\Program Files\\KTX-Software\\bin';

const PAPER = '#faf5ee';

/** Slab outer dimensions in millimetres, from scripts/blender/spec.py. */
const SLAB_W_MM = 85.0;

/**
 * Posed bounding box of the beat 1 hero pose, in metres, as measured by the
 * Phase 4 headless render and recorded in PHASE4.md section 5. The poster is a
 * render of the slab at that pose, so its pixel width is the posed width, not
 * the flat width. The page sizes the slab by its flat width, so the poster
 * needs this ratio to line up with the canvas underneath it.
 */
const POSED_BBOX_M = { x: 0.0881, y: 0.1392 };

/** Slab display width as a ratio of --cw. Per docs/handoff/design-ref/README.md. */
const SLAB_RATIO_OF_CW = 1.1075;

const log = (...a) => console.log(...a);

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function stamp(label, file) {
  const size = fs.statSync(file).size;
  log(`  ${label.padEnd(38)} ${String(size).padStart(9)} B  ${kb(size).padStart(10)}`);
  return size;
}

/**
 * Bounding box of everything that is not the flat paper ground.
 *
 * The render is opaque, so there is no alpha channel to read a silhouette out
 * of. Distance from the known ground colour is the silhouette, and the
 * threshold is deliberately low so the antialiased edge is inside the box
 * rather than clipped off it.
 */
async function contentBounds(file, ground, threshold = 6) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const d = Math.abs(data[i] - ground[0]) + Math.abs(data[i + 1] - ground[1])
        + Math.abs(data[i + 2] - ground[2]);
      if (d > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error(`no content found in ${file}`);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, imageW: W, imageH: H };
}

/* ------------------------------------------------------------------ 1 poster */

async function poster() {
  log('\n1  poster');
  const src = path.join(SRC, 'poster', 'slab-poster-2x-2880x1800.png');
  const bounds = await contentBounds(src, [0xfa, 0xf5, 0xee]);
  log(`  slab bounds in the 2x render          ${bounds.width} x ${bounds.height}` +
    ` at ${bounds.left}, ${bounds.top}`);

  // Three pixels of ground on every side. The silhouette threshold puts the
  // antialiased edge inside the box already; this keeps the reduction from
  // pulling ground colour across a hard boundary.
  const PAD = 3;
  const crop = {
    left: bounds.left - PAD,
    top: bounds.top - PAD,
    width: bounds.width + PAD * 2,
    height: bounds.height + PAD * 2,
  };

  // 412 CSS px is the slab at the clamp maximum, 372 * 1.1075. The poster ships
  // at 2x that so it is sharp on the displays that will actually see it.
  const targetW = Math.round(SLAB_RATIO_OF_CW * 372) * 2;
  const targetH = Math.round(crop.height * (targetW / crop.width));

  const out = path.join(OUT, 'hero-poster.webp');
  await sharp(src).extract(crop).resize(targetW, targetH, { kernel: 'lanczos3' })
    .webp({ quality: 84, effort: 6 }).toFile(out);
  stamp('hero-poster.webp', out);

  // The flat slab is 85 mm wide. At this pose it projects to POSED_BBOX_M.x, so
  // the crop is wider than the flat width by that ratio plus the padding. The
  // page sizes the slab flat, so the poster has to carry the difference.
  const posedOverFlat = POSED_BBOX_M.x / (SLAB_W_MM / 1000);
  const padOverPosed = crop.width / bounds.width;
  const widthRatioOfCw = SLAB_RATIO_OF_CW * posedOverFlat * padOverPosed;

  const meta = {
    src: '/assets/hero-poster.webp',
    width: targetW,
    height: targetH,
    // CSS: width = calc(var(--cw) * widthRatioOfCw)
    widthRatioOfCw: Number(widthRatioOfCw.toFixed(5)),
    slabRatioOfCw: SLAB_RATIO_OF_CW,
    posedOverFlat: Number(posedOverFlat.toFixed(5)),
    crop,
    sourceBounds: bounds,
    note: 'Generated by scripts/phase5/assets.mjs. Do not edit by hand.',
  };
  ensure(DATA);
  fs.writeFileSync(path.join(DATA, 'poster.json'), `${JSON.stringify(meta, null, 2)}\n`);
  log(`  posed over flat width                  ${posedOverFlat.toFixed(5)}`);
  log(`  poster width as a ratio of --cw        ${meta.widthRatioOfCw}`);
  return { src, crop, targetW, targetH };
}

/* ---------------------------------------------------------------------- 2 og */

async function og(posterInfo) {
  log('\n2  og-image');
  const W = 1200;
  const H = 630;

  // The slab is centred and fills 88 percent of the height. Cropped from the
  // same 2x render the poster comes from, per the Phase 1 relocation of item
  // 1g. No lettering is drawn over it: the label inside the render already
  // carries the name and the subject line, and text composited here would be
  // invisible to the D4 identity guard, which greps strings and cannot read a
  // raster.
  const slabH = Math.round(H * 0.88);
  const slabW = Math.round(posterInfo.crop.width * (slabH / posterInfo.crop.height));
  const slab = await sharp(posterInfo.src).extract(posterInfo.crop)
    .resize(slabW, slabH, { kernel: 'lanczos3' }).png().toBuffer();

  const grain = await sharp(path.join(REPO, 'output', 'imagegen', 'paper-grain-warm-white.png'))
    .resize(W, H, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();

  // JPEG, not PNG. The render is photographic, so PNG lands at 709 KB against
  // 116 KB for visually identical mozjpeg, and every consumer of an og:image
  // accepts JPEG. The old og.png is removed rather than left to ship as a dead
  // 175 KB in dist/.
  const out = path.join(REPO, 'public', 'og.jpg');
  // The grain goes on last, over the slab as well as the ground. Under it, the
  // slab crop carries its own flat #faf5ee margin, which reads as a lighter
  // rectangle against a grained background. One grain pass over everything
  // removes that edge instead of having to key the crop.
  await sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .composite([
      { input: slab, left: Math.round(W / 2 - slabW / 2), top: Math.round((H - slabH) / 2) },
      { input: grain, blend: 'multiply', opacity: 0.55 },
    ])
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(out);
  stamp('og.jpg  1200 x 630', out);
  const stale = path.join(REPO, 'public', 'og.png');
  if (fs.existsSync(stale)) {
    fs.rmSync(stale);
    log('  removed the superseded og.png');
  }
}

/* ------------------------------------------------------------------- 3 faces */

const SLUGS = ['hero', 'komikfind', 'kalakal', 'raidyard', 'dotaweakness'];

async function faces() {
  log('\n3  static card faces');
  // 620 px covers every static use: 300 px at 2x on tablet, 208 px at 2x on
  // mobile, and the 140 px minimum grid cell at 2x with room over.
  const W = 620;
  let total = 0;
  for (const slug of SLUGS) {
    const src = path.join(SRC, 'faces', `${slug}-albedo.png`);
    const out = path.join(CARDS, `${slug}-face.webp`);
    await sharp(src).resize(W, Math.round(W * 1408 / 1008), { kernel: 'lanczos3' })
      .flatten({ background: PAPER })
      .webp({ quality: 82, effort: 6 }).toFile(out);
    total += stamp(`${slug}-face.webp`, out);
  }
  log(`  five faces                             ${String(total).padStart(9)} B  ${kb(total).padStart(10)}`);
}

/* ------------------------------------------------------------------- 4 paper */

async function paper() {
  log('\n4  paper grain');
  const src = path.join(REPO, 'output', 'imagegen', 'paper-grain-warm-white.png');
  const out = path.join(OUT, 'paper-warm-white.webp');

  // The 2x2 offset tile test the handoff asks for, run before the tile ships.
  // Opposite edges are pixel identical on both axes, so this is periodic by
  // construction rather than merely close. PICKS.md warns that a mean absolute
  // difference ratio is a weak seam detector on dense patterns; a literal zero
  // is not that metric being flattered, it is the same pixels.
  const seam = await tileSeam(src);
  log(`  2x2 offset tile test                   cross-edge delta ` +
    `v ${seam.v}, h ${seam.h} against interior v ${seam.vi}, h ${seam.hi}`);
  if (seam.v !== 0 || seam.h !== 0) throw new Error('paper grain tile is not periodic');

  // Quality 95 rather than lossless. The grain carries a standard deviation of
  // about one 8-bit level, so the default quality erases it outright: measured
  // 0.17 against 1.01 on the blue channel. Lossless preserves it exactly at
  // 70 KB, q95 preserves the amplitude at 4.7 KB, and the layer renders at 0.55
  // opacity under multiply where the difference cannot be seen.
  await sharp(src).resize(512, 512, { kernel: 'lanczos3' })
    .webp({ quality: 95, effort: 6 }).toFile(out);
  stamp('paper-warm-white.webp  512 x 512', out);
}

/** Cross-edge against interior absolute difference, summed over all channels. */
async function tileSeam(src) {
  const { data, info } = await sharp(src).resize(512, 512, { kernel: 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = (x, y, c) => data[(y * W + x) * C + c];
  let v = 0, vi = 0, h = 0, hi = 0;
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < C; c++) {
      v += Math.abs(px(W - 1, y, c) - px(0, y, c));
      vi += Math.abs(px(W - 1, y, c) - px(W - 2, y, c));
    }
  }
  for (let x = 0; x < W; x++) {
    for (let c = 0; c < C; c++) {
      h += Math.abs(px(x, H - 1, c) - px(x, 0, c));
      hi += Math.abs(px(x, H - 1, c) - px(x, H - 2, c));
    }
  }
  return { v, vi, h, hi };
}

/* -------------------------------------------------------------------- 5 holo */

/** Per PICKS.md holo assignments. The weave spare is not shipped. */
const HOLO = [
  ['starburst', 'starburst-rays-normal.png'],
  ['halftone', 'halftone-comic-dots-normal.png'],
  ['hex', 'hex-circuit-mesh-normal.png'],
  ['prismatic', 'diagonal-prismatic-lines-normal.png'],
];

/**
 * UASTC for data, matching the Phase 4 rule that non-colour maps are UASTC.
 *
 * `--wmode wrap` is not accepted by toktx 4.4.2 outside a resize, so mip
 * generation clamps at the edges. That affects a one texel band in the lower
 * mips only; sampling wrap is set on the three.js texture, which is what tiling
 * actually depends on.
 */
const UASTC = ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18',
  '--genmipmap', '--assign_oetf', 'linear'];

function toktx(args, out, src) {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = `${KTX_BIN}${path.delimiter}${env[key] ?? ''}`;
  const exe = fs.existsSync(path.join(KTX_BIN, 'toktx.exe'))
    ? path.join(KTX_BIN, 'toktx.exe')
    : 'toktx';
  execFileSync(exe, [...args, out, src], { env, stdio: 'pipe' });
}

/**
 * Shipped tile resolution.
 *
 * The authored normals are 1024, which is the right size to author at and the
 * wrong size to ship. The foil shader tiles these 1.7 times across a card that
 * is at most 250 CSS px wide, so one tile covers about 294 device pixels at a
 * device pixel ratio of 2 and a 512 tile is already oversampled by 1.7.
 *
 * The reason this matters is a real cost, not a tidiness argument. After
 * falsifier A forced the seeded jitter into the starburst build, the pattern
 * stopped being sixteen copies of one cluster and became high entropy, and its
 * UASTC file went from 68 KB to 845 KB. At 1024 that alone would have taken the
 * initial payload from 1.92 MB to 2.70 MB, past the 2.5 MB gate. Halving the
 * axis is a four times reduction in texels and costs nothing visible at the
 * scale this is actually sampled at.
 */
const HOLO_SHIP_PX = 512;

async function holo() {
  log('\n5  tiling holo normals to KTX2 UASTC');
  const tmp = path.join(REPO, 'build', 'phase5');
  ensure(tmp);
  let total = 0;
  for (const [name, file] of HOLO) {
    const src = path.join(SRC, 'normals', file);
    // Resampling a normal map denormalises it, so the vectors are renormalised
    // after the reduction rather than left slightly short.
    const small = path.join(tmp, `holo-${name}.png`);
    await renormalise(src, small, HOLO_SHIP_PX);
    const out = path.join(CARDS, `holo-${name}-normal.ktx2`);
    toktx(UASTC, out, small);
    total += stamp(`holo-${name}-normal.ktx2  ${HOLO_SHIP_PX}px`, out);
  }
  log(`  four holo normals                      ${String(total).padStart(9)} B  ${kb(total).padStart(10)}`);
}

async function renormalise(src, out, size) {
  const { data, info } = await sharp(src).resize(size, size, { kernel: 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true });
  const c = info.channels;
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    let x = (data[i * c] / 255) * 2 - 1;
    let y = (data[i * c + 1] / 255) * 2 - 1;
    let z = (data[i * c + 2] / 255) * 2 - 1;
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    px[i * 3] = Math.round((x * 0.5 + 0.5) * 255);
    px[i * 3 + 1] = Math.round((y * 0.5 + 0.5) * 255);
    px[i * 3 + 2] = Math.round((z * 0.5 + 0.5) * 255);
  }
  await sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toFile(out);
}

/* -------------------------------------------------------------------- 6 lazy */

async function lazy() {
  log('\n6  lazy card sets placed under public/assets/cards/');
  const from = path.join(SRC, 'ktx2');
  const wanted = [];
  for (const slug of ['komikfind', 'kalakal', 'raidyard', 'dotaweakness']) {
    wanted.push(`${slug}-albedo.ktx2`, `${slug}-rg.ktx2`, `label-${slug}.ktx2`);
  }
  /*
   * The card back is deliberately not placed.
   *
   * Phase 4 staged it for "the Phase 5 edge pass", on the reading that the
   * reverse of the card would be on screen during a swap. Under the two mesh
   * slot it never is: both meshes cull back faces, so the surface facing the
   * camera is always some card's front, and at the midpoint of the turn the
   * card is edge on with the slab at plus or minus 92 degrees besides. Placing
   * it would put 214 KB into dist/ that no code path fetches. The staged files
   * stay in assets-src/ktx2/ in case a later beat wants a real back.
   */

  let total = 0;
  for (const f of wanted) {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) throw new Error(`missing staged texture: ${src}`);
    const out = path.join(CARDS, f);
    fs.copyFileSync(src, out);
    total += stamp(f, out);
  }
  log(`  ${String(wanted.length).padStart(2)} files                              ` +
    `${String(total).padStart(9)} B  ${kb(total).padStart(10)}`);
}

/* ------------------------------------------------------------------- 7 model */

/**
 * The runtime GLB, with Draco removed and the textures still external.
 *
 * Phase 4 ships slab.glb with KHR_draco_mesh_compression at position 14,
 * normal 10, texcoord 12, because the Phase 4 brief asked for it. At runtime
 * that is a bad trade and the numbers are not close: the whole mesh is 590
 * triangles and 6888 B, while DRACOLoader's glTF decoder is a 192 KB wasm plus
 * a 58 KB wrapper that has to be fetched, instantiated and run before the first
 * frame can be drawn. Decoding at build time costs a few KB on the GLB and
 * removes a quarter megabyte from the critical path.
 *
 * slab.glb is left exactly as Phase 4 wrote it, so the artifact PHASE4.md
 * records still stands and can still be diffed against a rebuild.
 *
 * `gltf-transform cp` is not usable here: its binary writer folds every
 * resource into the BIN chunk, which would re-embed the four KTX2 textures and
 * take the file from 6888 B to 469848 B. The document is written as .gltf with
 * external resources and the GLB is assembled by hand, which is the same
 * transformation scripts/pack/pack_glb.mjs performs and for the same reason.
 */
async function model() {
  log('\n7  runtime GLB, Draco decoded');
  const { gltfTransformRequire } = await import('../pack/resolve.mjs');
  const req = gltfTransformRequire();
  const { NodeIO } = req('@gltf-transform/core');
  const { ALL_EXTENSIONS, KHRDracoMeshCompression } = req('@gltf-transform/extensions');
  const draco3d = req('draco3dgltf');

  const MODELS = path.join(OUT, 'models');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

  const doc = await io.read(path.join(MODELS, 'slab.glb'));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === KHRDracoMeshCompression.EXTENSION_NAME) ext.dispose();
  }

  const tmpGltf = path.join(MODELS, '_runtime.tmp.gltf');
  const tmpBin = path.join(MODELS, '_runtime.tmp.bin');
  doc.getRoot().listBuffers()[0].setURI('_runtime.tmp.bin');
  await io.write(tmpGltf, doc);

  const json = JSON.parse(fs.readFileSync(tmpGltf, 'utf8'));
  const bin = fs.readFileSync(tmpBin);
  delete json.buffers[0].uri;

  const out = path.join(MODELS, 'slab-runtime.glb');
  fs.writeFileSync(out, assembleGlb(json, bin));
  fs.rmSync(tmpGltf);
  fs.rmSync(tmpBin);

  const embedded = (json.images ?? []).filter((i) => i.bufferView !== undefined).length;
  if (embedded > 0) throw new Error(`${embedded} image(s) re-embedded into the runtime GLB`);
  const required = json.extensionsRequired ?? [];
  if (required.includes('KHR_draco_mesh_compression')) {
    throw new Error('Draco is still required by the runtime GLB');
  }
  stamp('slab-runtime.glb', out);
  log(`  extensionsRequired                     ${JSON.stringify(required)}`);
  log(`  images by URI                          ${(json.images ?? []).length}`);
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const pad4 = (n) => (4 - (n % 4)) % 4;

function assembleGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20);
  const binPad = Buffer.alloc(pad4(bin.length), 0x00);
  const jsonLen = jsonBuf.length + jsonPad.length;
  const binLen = bin.length + binPad.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonLen + 8 + binLen, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLen, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLen, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, jsonPad, binHeader, bin, binPad]);
}

/* ------------------------------------------------------------------ 8 vendor */

/**
 * The Basis transcoder, vendored into public/ rather than reached for on a CDN.
 * KTX2Loader needs it at runtime and the whole texture set is KTX2, so this is
 * on the critical path. Draco's decoder is deliberately not vendored; step 7
 * removes the need for it.
 */
async function vendor() {
  log('\n8  basis transcoder vendored');
  const from = path.join(REPO, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  const to = path.join(REPO, 'public', 'vendor', 'basis');
  ensure(to);
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    fs.copyFileSync(path.join(from, f), path.join(to, f));
    stamp(f, path.join(to, f));
  }
}

/* -------------------------------------------------------------------- driver */

async function main() {
  ensure(OUT);
  ensure(CARDS);
  const p = await poster();
  await og(p);
  await faces();
  await paper();
  await holo();
  await lazy();
  await model();
  await vendor();
  log('\nPHASE5 ASSETS OK');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
