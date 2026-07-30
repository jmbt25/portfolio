/**
 * Phase 4, end to end.
 *
 *   node scripts/phase4.mjs            run every step
 *   node scripts/phase4.mjs --from 6   resume from step 6
 *   node scripts/phase4.mjs --list     list the steps and stop
 *
 * Tool locations can be overridden by environment variable:
 *   BLENDER   path to blender.exe        (4.x or newer, needs the glTF exporter)
 *   PY        path to a python with PIL, numpy and fontTools
 *   KTX_BIN   directory holding toktx    (KTX-Software, required by gltf-transform)
 *
 * Every step is expected to exit 0 and to print its own PASS or FAIL lines. This
 * runner adds nothing to the verification, it only sequences it.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const BLENDER = process.env.BLENDER
  || 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const PY = process.env.PY || path.join(REPO, '.venv-textures', 'Scripts', 'python.exe');
const KTX_BIN = process.env.KTX_BIN || 'C:\\Program Files\\KTX-Software\\bin';

const NODE_BIN = path.dirname(process.execPath);
const GLTF = path.join(NODE_BIN, process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');

const BUILD = path.join(REPO, 'build', 'blender');

const blenderArgs = (script, extra) => [
  '--background', '--factory-startup', '--python', path.join(REPO, script), '--', ...extra,
];

const STEPS = [
  { n: 1, title: 'Measure label-ref.png', cmd: PY, args: ['scripts/label/measure_label_ref.py'] },
  { n: 2, title: 'Build label SVG and 2x raster', cmd: PY, args: ['scripts/label/build_label.py'] },
  { n: 3, title: 'Build scene: slab, card, label', cmd: BLENDER, args: blenderArgs('scripts/blender/build_scene.py', ['--out', 'build/blender']) },
  { n: 4, title: 'Bake AO at 1024', cmd: BLENDER, args: blenderArgs('scripts/blender/bake_ao.py', ['--blend', 'build/blender/scene.blend']) },
  { n: 5, title: 'Multiply AO into hero albedo copy', cmd: PY, args: ['scripts/blender/composite_ao.py'] },
  { n: 6, title: 'Export GLB with Draco 14/10/12', cmd: BLENDER, args: blenderArgs('scripts/blender/export_glb.py', ['--blend', 'build/blender/scene.blend', '--out', 'build/blender/scene.glb']) },
  {
    n: 7,
    title: 'KTX2 UASTC: normal and packed RG',
    cmd: GLTF,
    args: ['uastc', 'build/blender/scene.glb', 'build/blender/p1.glb',
      '--slots', '{normalTexture,metallicRoughnessTexture}',
      '--level', '2', '--rdo', '4', '--zstd', '18'],
    needsKtx: true,
  },
  {
    n: 8,
    title: 'KTX2 ETC1S: albedos',
    cmd: GLTF,
    args: ['etc1s', 'build/blender/p1.glb', 'build/blender/p2.glb',
      '--slots', 'baseColorTexture', '--quality', '190', '--compression', '4'],
    needsKtx: true,
  },
  { n: 9, title: 'Externalise textures, re-apply Draco, write slab.glb', cmd: process.execPath, args: ['scripts/pack/pack_glb.mjs', 'build/blender/p2.glb'] },
  { n: 10, title: 'Stage the four lazy card sets as KTX2', cmd: process.execPath, args: ['scripts/pack/ktx2_lazy.mjs'], needsKtx: true },
  { n: 11, title: 'Verify budgets', cmd: process.execPath, args: ['scripts/verify/budgets.mjs'] },
  { n: 12, title: 'Headless three.js render, 1440x900 and 2x', cmd: process.execPath, args: ['scripts/verify/render.mjs'] },
];

/**
 * Copy the environment with KTX-Software prepended to PATH.
 *
 * Windows names the variable "Path". process.env looks it up case insensitively,
 * but a spread copy is an ordinary object that does not, so `{...process.env}.PATH`
 * is undefined and assigning to `.PATH` adds a second, competing key. The child
 * then inherits both, picks the new one, and loses System32 along with it: the
 * symptom is gltf-transform reporting that `where` is not a recognised command.
 */
function withKtxOnPath() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = `${KTX_BIN}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

function preflight() {
  const problems = [];
  if (!fs.existsSync(BLENDER)) problems.push(`BLENDER not found at ${BLENDER}`);
  if (!fs.existsSync(PY)) problems.push(`PY not found at ${PY}`);
  if (!fs.existsSync(GLTF)) problems.push(`gltf-transform not found at ${GLTF}`);
  if (!fs.existsSync(path.join(KTX_BIN, 'toktx.exe')) && process.platform === 'win32') {
    problems.push(`toktx not found in ${KTX_BIN}. KTX2 steps will fail. ` +
      'Install KTX-Software from github.com/KhronosGroup/KTX-Software/releases');
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const s of STEPS) console.log(`${String(s.n).padStart(2)}. ${s.title}`);
    return;
  }
  const fromIdx = args.indexOf('--from');
  const from = fromIdx >= 0 ? parseInt(args[fromIdx + 1], 10) : 1;

  const problems = preflight();
  if (problems.length) {
    console.error('preflight failed:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  fs.mkdirSync(BUILD, { recursive: true });

  const started = STEPS.filter((s) => s.n >= from);
  for (const step of started) {
    console.log(`\n${'='.repeat(72)}`);
    console.log(`STEP ${step.n}  ${step.title}`);
    console.log('='.repeat(72));
    const env = step.needsKtx ? withKtxOnPath() : { ...process.env };
    const r = spawnSync(step.cmd, step.args, {
      cwd: REPO,
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32' && step.cmd.endsWith('.cmd'),
    });
    if (r.status !== 0) {
      console.error(`\nSTEP ${step.n} FAILED with exit ${r.status}`);
      process.exit(r.status ?? 1);
    }
  }
  console.log(`\n${'='.repeat(72)}`);
  console.log('PHASE 4 COMPLETE');
  console.log('='.repeat(72));
}

main();
