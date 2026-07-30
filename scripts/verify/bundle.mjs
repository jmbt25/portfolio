/**
 * Gate 2: the bundle report.
 *
 *   node scripts/verify/bundle.mjs [--url URL]
 *
 * Fails if the initial payload exceeds 2.5 MB or the JavaScript exceeds 300 KB
 * gzipped.
 *
 * Two tallies, because a static walk of dist/ and a measured page load answer
 * different questions and either alone can mislead. The static walk itemises
 * what each tier costs and cannot be fooled by a cache; the network trace
 * proves the tiers are real, which is the whole claim behind lazy card sets and
 * behind static faces that a desktop visitor never fetches.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const PAGE_URL = (() => {
  const i = args.indexOf('--url');
  return i >= 0 ? args[i + 1] : 'http://localhost:4321/';
})();

const DIST = 'dist';
const LIMIT_INITIAL = 2.5 * 1024 * 1024;
const LIMIT_JS_GZ = 300 * 1024;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function size(rel) {
  const p = path.join(DIST, rel);
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

function gz(rel) {
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) return 0;
  return zlib.gzipSync(fs.readFileSync(p), { level: 9 }).length;
}

function jsFiles() {
  const dir = path.join(DIST, '_astro');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => `_astro/${f}`);
}

/* ------------------------------------------------------------ static walk */

const TIERS = [
  {
    name: 'A  first paint, no JavaScript involved',
    files: [
      'index.html',
      'fonts/jetbrains-mono-latin.woff2',
      'assets/hero-poster.webp',
      'assets/paper-warm-white.webp',
      'favicon.svg',
    ],
  },
  {
    name: 'B  critical 3D, fetched by the island at idle',
    files: [
      ...jsFiles(),
      'vendor/basis/basis_transcoder.js',
      'vendor/basis/basis_transcoder.wasm',
      'assets/models/slab-runtime.glb',
      'assets/cards/hero-albedo.ktx2',
      'assets/cards/hero-rg.ktx2',
      'assets/cards/frame-emboss-normal.ktx2',
      'assets/cards/label-hero.ktx2',
      'assets/cards/holo-starburst-normal.ktx2',
    ],
  },
  {
    name: 'C  lazy card sets, one beat ahead of the beat that shows them',
    files: [
      ...['komikfind', 'kalakal', 'raidyard', 'dotaweakness'].flatMap((s) => [
        `assets/cards/${s}-albedo.ktx2`,
        `assets/cards/${s}-rg.ktx2`,
        `assets/cards/label-${s}.ktx2`,
      ]),
      'assets/cards/holo-halftone-normal.ktx2',
      'assets/cards/holo-hex-normal.ktx2',
      'assets/cards/holo-prismatic-normal.ktx2',
    ],
  },
  {
    name: 'D  static faces, narrow layouts only, never fetched at 1024 and up',
    files: ['hero', 'komikfind', 'kalakal', 'raidyard', 'dotaweakness']
      .map((s) => `assets/cards/${s}-face.webp`),
  },
];

console.log('Phase 5 bundle report\n');

const totals = [];
for (const tier of TIERS) {
  console.log(tier.name);
  let sum = 0;
  for (const f of tier.files) {
    const s = size(f);
    if (!s) { console.log(`  MISSING  ${f}`); process.exitCode = 1; continue; }
    sum += s;
    console.log(`  ${f.padEnd(46)} ${String(s).padStart(9)} B  ${kb(s).padStart(10)}`);
  }
  console.log(`  ${'tier total'.padEnd(46)} ${String(sum).padStart(9)} B  ${kb(sum).padStart(10)}\n`);
  totals.push(sum);
}

const initial = totals[0] + totals[1];
const jsRaw = jsFiles().reduce((a, f) => a + size(f), 0);
const jsGz = jsFiles().reduce((a, f) => a + gz(f), 0);

console.log('budgets');
const rows = [
  ['initial payload, A + B', initial, LIMIT_INITIAL, mb],
  ['JavaScript, gzipped', jsGz, LIMIT_JS_GZ, kb],
];
let failed = false;
for (const [label, value, limit, fmt] of rows) {
  const ok = value <= limit;
  if (!ok) failed = true;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} ${fmt(value).padStart(10)}` +
    ` against ${fmt(limit)}   ${ok ? `${fmt(limit - value)} headroom` : `${fmt(value - limit)} over`}`);
}
console.log(`        ${'JavaScript, raw'.padEnd(30)} ${kb(jsRaw).padStart(10)}`);
console.log(`        ${'everything in dist/assets'.padEnd(30)} ` +
  `${mb(totals.reduce((a, b) => a + b, 0)).padStart(10)}`);

/* --------------------------------------------------------- network trace */

async function trace(width, height, scrollAll) {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const seen = new Map();
  page.on('response', async (r) => {
    const u = new URL(r.url()).pathname;
    if (seen.has(u)) return;
    let n = 0;
    try { n = (await r.body()).length; } catch { n = 0; }
    seen.set(u, n);
  });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(width >= 1024 ? 3500 : 900);
  const atIdle = new Map(seen);
  if (scrollAll) {
    for (let p = 0; p <= 100; p += 10) {
      await page.evaluate((q) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: (max * q) / 100, behavior: 'instant' });
      }, p);
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(1500);
  }
  await browser.close();
  return { atIdle, atEnd: seen };
}

const sum = (m, pred = () => true) => [...m.entries()]
  .filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);

console.log('\nmeasured, transfer bodies as served by astro preview');

const wide = await trace(1440, 900, true);
console.log(`  1440x900  after hydration      ${mb(sum(wide.atIdle)).padStart(9)}` +
  `  ${String(wide.atIdle.size).padStart(3)} requests`);
console.log(`  1440x900  after a full scroll  ${mb(sum(wide.atEnd)).padStart(9)}` +
  `  ${String(wide.atEnd.size).padStart(3)} requests`);
const faceLeak = [...wide.atEnd.keys()].filter((k) => k.endsWith('-face.webp'));
console.log(`  1440x900  static faces fetched ${faceLeak.length} (want 0)`);
if (faceLeak.length) { failed = true; console.log(`    ${faceLeak.join('\n    ')}`); }

const narrow = await trace(390, 844, false);
console.log(`  390x844   first view           ${mb(sum(narrow.atIdle)).padStart(9)}` +
  `  ${String(narrow.atIdle.size).padStart(3)} requests`);
const wasmLeak = [...narrow.atIdle.keys()]
  .filter((k) => k.includes('basis') || k.endsWith('.ktx2') || k.endsWith('.glb'));
console.log(`  390x844   WebGL assets fetched ${wasmLeak.length} (want 0)`);
if (wasmLeak.length) { failed = true; console.log(`    ${wasmLeak.join('\n    ')}`); }

console.log(failed ? '\nBUNDLE FAIL' : '\nBUNDLE OK');
if (failed) process.exitCode = 1;
