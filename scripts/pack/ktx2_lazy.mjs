/**
 * Phase 4 step 4d: convert the four lazy card texture sets to KTX2 and stage
 * them in assets-src/ktx2/ for Phase 5 to place.
 *
 *   node scripts/pack/ktx2_lazy.mjs
 *
 * These do not go through gltf-transform, because gltf-transform's etc1s and
 * uastc commands operate on a glTF document and these textures are not in one.
 * They are driven straight through toktx, which is the same encoder
 * gltf-transform shells out to, with settings matched to the passes that
 * produced the hero set so the five cards compress identically.
 *
 * The card back is included. The brief names five cards; the back is a sixth
 * face that Phase 3 built and Phase 5's edge pass will need.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const OUT = path.join(REPO, 'assets-src', 'ktx2');
const FACES = path.join(REPO, 'assets-src', 'faces');
const PACKED = path.join(REPO, 'assets-src', 'packed');
const LABELS = path.join(REPO, 'assets-src', 'label');

const KTX_BIN = 'C:\\Program Files\\KTX-Software\\bin';

// The hero set is already shipped under public/assets/cards/, so it is not here.
const LAZY = ['komikfind', 'kalakal', 'raidyard', 'dotaweakness'];

/** ETC1S for colour, matching the gltf-transform etc1s pass on the hero albedo. */
const ETC1S = ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '190',
  '--genmipmap', '--assign_oetf', 'srgb'];

/** UASTC for data, matching the gltf-transform uastc pass on the hero packed RG. */
const UASTC = ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18',
  '--genmipmap', '--assign_oetf', 'linear'];

function toktx(args, out, src) {
  // Windows spells it "Path". A spread copy of process.env does not do the case
  // insensitive lookup the real object does, so the existing key is found by
  // name rather than assumed, or the child loses the inherited PATH entirely.
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = `${KTX_BIN}${path.delimiter}${env[key] ?? ''}`;
  const exe = fs.existsSync(path.join(KTX_BIN, 'toktx.exe'))
    ? path.join(KTX_BIN, 'toktx.exe')
    : 'toktx';
  execFileSync(exe, [...args, out, src], { env, stdio: 'pipe' });
}

function convert(src, out, args, label) {
  if (!fs.existsSync(src)) throw new Error(`missing source: ${src}`);
  toktx(args, out, src);
  const before = fs.statSync(src).size;
  const after = fs.statSync(out).size;
  const ratio = (before / after).toFixed(2);
  console.log(`  ${label.padEnd(34)} ${String(before).padStart(8)} B -> ` +
    `${String(after).padStart(8)} B  ${ratio}x`);
  return after;
}

function main() {
  if (!fs.existsSync(path.join(KTX_BIN, 'toktx.exe'))) {
    console.warn(`note: ${KTX_BIN} not found, relying on toktx being on PATH`);
  }
  fs.mkdirSync(OUT, { recursive: true });

  let total = 0;
  console.log('lazy card texture sets, staged in assets-src/ktx2/ for Phase 5\n');
  for (const slug of LAZY) {
    console.log(`${slug}:`);
    total += convert(path.join(FACES, `${slug}-albedo.png`),
      path.join(OUT, `${slug}-albedo.ktx2`), ETC1S, `${slug}-albedo.ktx2 (ETC1S)`);
    total += convert(path.join(PACKED, `${slug}-rg.png`),
      path.join(OUT, `${slug}-rg.ktx2`), UASTC, `${slug}-rg.ktx2 (UASTC)`);
    total += convert(path.join(LABELS, `label-${slug}-2x.png`),
      path.join(OUT, `label-${slug}.ktx2`), ETC1S, `label-${slug}.ktx2 (ETC1S)`);
  }

  console.log('\nback face, needed by the Phase 5 edge pass:');
  total += convert(path.join(FACES, 'back-albedo.png'),
    path.join(OUT, 'back-albedo.ktx2'), ETC1S, 'back-albedo.ktx2 (ETC1S)');
  total += convert(path.join(PACKED, 'back-rg.png'),
    path.join(OUT, 'back-rg.ktx2'), UASTC, 'back-rg.ktx2 (UASTC)');

  console.log(`\nstaged ${fs.readdirSync(OUT).length} files, ${total} B total`);
  console.log('KTX2 LAZY OK');
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
