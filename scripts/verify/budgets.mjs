/**
 * Phase 4 step 5a: assert the shipped budgets by measuring the shipped files.
 *
 *   node scripts/verify/budgets.mjs
 *
 * Budgets from the phase brief:
 *   total triangles          <= 20,000
 *   geometry                 <= 400 KB
 *   hero path, summed by ls  <= 1.5 MB
 *
 * The hero path is the GLB plus the textures the hero beat actually fetches:
 * the hero albedo, the hero packed RG, the hero label, and the frame emboss
 * normal, which is shared by all five cards rather than being per card. The four
 * lazy card sets are staged outside public/ and are not part of this sum.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { gltfTransformRequire } from '../pack/resolve.mjs';

const require = gltfTransformRequire();
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const draco3d = require('draco3dgltf');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const GLB = path.join(REPO, 'public', 'assets', 'models', 'slab.glb');
const CARDS = path.join(REPO, 'public', 'assets', 'cards');

const HERO_TEXTURES = [
  'hero-albedo.ktx2',
  'hero-rg.ktx2',
  'label-hero.ktx2',
  'frame-emboss-normal.ktx2', // shared across all five cards
];

const KB = 1024;
const BUDGET_TRIS = 20000;
const BUDGET_GEOMETRY = 400 * KB;
const BUDGET_HERO_PATH = 1.5 * 1024 * KB;

const fmt = (b) => `${b} B (${(b / KB).toFixed(1)} KB)`;

async function main() {
  let ok = true;
  const fail = (cond) => { if (!cond) ok = false; return cond ? 'PASS' : 'FAIL'; };

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
  const doc = await io.read(GLB);

  console.log('=== triangles, counted from the shipped GLB ===');
  let tris = 0;
  const perMesh = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    let n = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
      n += count / 3;
    }
    tris += n;
    perMesh.push([mesh.getName(), n]);
  }
  for (const [name, n] of perMesh) console.log(`  ${name.padEnd(8)} ${String(n).padStart(6)} tris`);
  console.log(`  ${'TOTAL'.padEnd(8)} ${String(tris).padStart(6)} tris / ${BUDGET_TRIS}` +
    `  [${fail(tris <= BUDGET_TRIS)}]`);

  console.log('\n=== draw calls ===');
  const prims = doc.getRoot().listMeshes()
    .reduce((a, m) => a + m.listPrimitives().length, 0);
  const mats = doc.getRoot().listMaterials().length;
  console.log(`  mesh primitives ${prims}, materials ${mats}`);
  console.log('  one draw call per primitive, so 3 opaque calls before the');
  console.log('  transmission pass, which three.js adds at render time');

  console.log('\n=== geometry bytes ===');
  const glbSize = fs.statSync(GLB).size;
  console.log(`  slab.glb ${fmt(glbSize)} / ${fmt(BUDGET_GEOMETRY)}  [${fail(glbSize <= BUDGET_GEOMETRY)}]`);
  console.log('  the GLB holds geometry and materials only; every texture is external');

  console.log('\n=== hero path, summed by file size ===');
  let sum = glbSize;
  console.log(`  ${'public/assets/models/slab.glb'.padEnd(46)} ${String(glbSize).padStart(8)} B`);
  for (const f of HERO_TEXTURES) {
    const p = path.join(CARDS, f);
    if (!fs.existsSync(p)) {
      console.log(`  ${`public/assets/cards/${f}`.padEnd(46)} ${'MISSING'.padStart(8)}  [FAIL]`);
      ok = false;
      continue;
    }
    const s = fs.statSync(p).size;
    sum += s;
    console.log(`  ${`public/assets/cards/${f}`.padEnd(46)} ${String(s).padStart(8)} B`);
  }
  console.log(`  ${'TOTAL'.padEnd(46)} ${String(sum).padStart(8)} B  = ${(sum / KB).toFixed(1)} KB`);
  console.log(`  budget ${(BUDGET_HERO_PATH / KB).toFixed(0)} KB  [${fail(sum <= BUDGET_HERO_PATH)}]` +
    `  headroom ${((BUDGET_HERO_PATH - sum) / KB).toFixed(1)} KB`);

  console.log('\n=== texture inventory ===');
  for (const tex of doc.getRoot().listTextures()) {
    console.log(`  ${(tex.getName() || '?').padEnd(22)} ${tex.getMimeType().padEnd(11)} ` +
      `uri=${tex.getURI()}`);
  }

  console.log('\n=== extensions ===');
  const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).sort();
  const req = doc.getRoot().listExtensionsRequired().map((e) => e.extensionName).sort();
  console.log(`  used:     ${used.join(', ')}`);
  console.log(`  required: ${req.join(', ')}`);
  const wantDraco = req.includes('KHR_draco_mesh_compression');
  const wantKtx = req.includes('KHR_texture_basisu');
  console.log(`  [${fail(wantDraco)}] Draco present`);
  console.log(`  [${fail(wantKtx)}] KTX2 present`);

  console.log(ok ? '\nBUDGETS OK' : '\nBUDGETS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
