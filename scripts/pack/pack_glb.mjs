/**
 * Phase 4 step 4c: move the KTX2 textures out of the GLB into standalone files
 * and re-apply Draco, producing the shipped public/assets/models/slab.glb.
 *
 *   node scripts/pack/pack_glb.mjs <input.glb>
 *
 * Two things this has to fix about the CLI stage that runs before it.
 *
 * Draco. `gltf-transform uastc` and `etc1s` both decode KHR_draco_mesh_compression
 * to read the file and do not put it back, which they say out loud:
 * "Decoded KHR_draco_mesh_compression. Further compression will be lossy."
 * Draco is therefore re-applied here at the brief's quantization, position 14,
 * normal 10, texcoord 12, identical to what Blender wrote.
 *
 * External textures. The hero path budget is stated as "GLB + hero textures +
 * shared normals summed by ls", and the normal map is shared across all five
 * cards, so the textures cannot live inside the GLB. Phase 5 also has to swap
 * card faces per beat, which means swapping a URL rather than rebuilding a GLB.
 *
 * glTF-Transform's binary writer packs every resource into the BIN chunk, so the
 * document is written as .gltf with external resources first and the GLB is then
 * assembled from that: JSON chunk plus BIN chunk, with the image URIs left
 * pointing outward. Only buffers[0].uri changes in the transformation, which is
 * why it is safe to do by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { gltfTransformRequire } from './resolve.mjs';

const require = gltfTransformRequire();
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRDracoMeshCompression } = require('@gltf-transform/extensions');
const draco3d = require('draco3dgltf');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const MODELS_DIR = path.join(REPO, 'public', 'assets', 'models');
const CARDS_DIR = path.join(REPO, 'public', 'assets', 'cards');
const OUT_GLB = path.join(MODELS_DIR, 'slab.glb');

// Texture name in the GLB -> shipped filename under public/assets/cards/.
const TEXTURE_NAMES = {
  'hero-albedo': 'hero-albedo.ktx2',
  'frame-emboss-normal': 'frame-emboss-normal.ktx2',
  'hero-rg': 'hero-rg.ktx2',
  'label-hero-2x': 'label-hero.ktx2',
};

const QUANTIZATION = { POSITION: 14, NORMAL: 10, COLOR: 8, TEX_COORD: 12, GENERIC: 12 };

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/** Assemble a GLB from a glTF JSON object and its binary buffer. */
function assembleGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20); // spaces
  const binPad = Buffer.alloc(pad4(bin.length), 0x00);

  const jsonLen = jsonBuf.length + jsonPad.length;
  const binLen = bin.length + binPad.length;
  const total = 12 + 8 + jsonLen + 8 + binLen;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLen, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binLen, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, jsonPad, binHeader, bin, binPad]);
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('usage: node scripts/pack/pack_glb.mjs <input.glb>');
  const inputPath = path.isAbsolute(input) ? input : path.join(REPO, input);
  if (!fs.existsSync(inputPath)) throw new Error(`missing input: ${inputPath}`);

  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.mkdirSync(CARDS_DIR, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

  const doc = await io.read(inputPath);
  const root = doc.getRoot();

  // Point every texture at a file under public/assets/cards/. The URI is
  // relative to the GLB, which lives one directory across in models/.
  const written = [];
  for (const tex of root.listTextures()) {
    const name = tex.getName();
    const file = TEXTURE_NAMES[name];
    if (!file) {
      throw new Error(`no shipped filename mapped for texture "${name}". ` +
        'Refusing to guess, since Phase 5 loads these by path.');
    }
    if (tex.getMimeType() !== 'image/ktx2') {
      throw new Error(`texture "${name}" is ${tex.getMimeType()}, not KTX2. ` +
        'The uastc and etc1s passes did not cover it.');
    }
    tex.setURI(`../cards/${file}`);
    written.push({ name, file, bytes: tex.getImage().byteLength });
  }

  // Re-apply Draco at the brief's quantization.
  doc.createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizationBits: QUANTIZATION,
    });

  // Write as .gltf so resources land outside, then fold it into a GLB.
  const tmpGltf = path.join(MODELS_DIR, '_slab.tmp.gltf');
  const tmpBin = path.join(MODELS_DIR, '_slab.tmp.bin');
  root.listBuffers()[0].setURI('_slab.tmp.bin');
  await io.write(tmpGltf, doc);

  const json = JSON.parse(fs.readFileSync(tmpGltf, 'utf8'));
  const bin = fs.readFileSync(tmpBin);
  delete json.buffers[0].uri; // GLB carries the buffer in its BIN chunk

  fs.writeFileSync(OUT_GLB, assembleGlb(json, bin));
  fs.rmSync(tmpGltf);
  fs.rmSync(tmpBin);

  console.log('external textures written to public/assets/cards/');
  for (const w of written) {
    const p = path.join(CARDS_DIR, w.file);
    const onDisk = fs.existsSync(p) ? fs.statSync(p).size : 0;
    const ok = onDisk > 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${w.file.padEnd(28)} ${String(onDisk).padStart(8)} B  (from ${w.name})`);
    if (!ok) process.exitCode = 1;
  }

  const glbSize = fs.statSync(OUT_GLB).size;
  console.log(`\nwrote public/assets/models/slab.glb  ${glbSize} B`);
  console.log(`  images embedded in GLB: ${json.images.filter((i) => i.bufferView !== undefined).length} (want 0)`);
  console.log(`  images by URI:          ${json.images.filter((i) => i.uri !== undefined).length} (want ${written.length})`);
  console.log(`  extensionsRequired:     ${JSON.stringify(json.extensionsRequired ?? [])}`);

  if (json.images.some((i) => i.bufferView !== undefined)) {
    console.error('FAIL: an image is still packed into the GLB');
    process.exitCode = 1;
  }
  if (!(json.extensionsRequired ?? []).includes('KHR_draco_mesh_compression')) {
    console.error('FAIL: Draco was not re-applied');
    process.exitCode = 1;
  }
  console.log(process.exitCode ? 'PACK FAILED' : 'PACK OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
