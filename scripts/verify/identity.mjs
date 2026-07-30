/**
 * Gate 7 support: the D4 rules that can be checked mechanically from here.
 *
 *   node scripts/verify/identity.mjs
 *
 * scripts/check-identity.sh is the guard that matters. It needs
 * scripts/.identity-denylist, which is untracked by design and holds the terms
 * this repository must never contain, so it cannot run on a fresh clone until
 * that file is recreated by hand. If it is present the substantive scan runs
 * here, which closes the caveat PHASE4.md left open.
 *
 * D4's other two rules are properties of the built output rather than of a
 * secret list, so they are checked directly:
 *
 *   komikfind ships with no outbound link
 *   contact is GitHub and X only
 *
 * The guard is also self-tested, because "the guard passes" and "the guard
 * ran" are different claims and only one of them is worth anything. Three
 * runs: no list must fail closed, a term that is certainly present must be
 * caught, a term that is certainly absent must pass.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DIST = 'dist';
const HTML = path.join(DIST, 'index.html');

let failed = false;
const check = (label, ok, detail) => {
  if (!ok) failed = true;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

function sh(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('bash', args, { encoding: 'utf8', ...opts }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

if (!fs.existsSync(HTML)) {
  console.error('dist/index.html is missing. Run the build first.');
  process.exit(1);
}
const html = fs.readFileSync(HTML, 'utf8');

console.log('D4 rules checkable from the built output\n');

/*
 * The komikfind beat carries no outbound link. The beat is bounded by its own
 * section id and the next one, so this reads the actual panel rather than the
 * whole document.
 */
const beat3 = html.slice(html.indexOf('id="beat-3"'), html.indexOf('id="beat-4"'));
const beat3Links = [...beat3.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
check('komikfind panel carries no outbound link', beat3Links.length === 0,
  beat3Links.length ? beat3Links.join(', ') : '');

/*
 * Contact is GitHub and X only. dotaweakness.com is on the allowed list because
 * it is one of the five projects' own domains, named in the copy deck, not a
 * contact route.
 */
const ALLOWED = new Set([
  'https://github.com/jmbt25',
  'https://x.com/jmbt_dev',
  'https://dotaweakness.com',
]);
const all = [...new Set([...html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]))]
  // schema.org is the JSON-LD vocabulary and jmbt.dev is this site's own
  // origin, carried by the canonical and og:image tags. Neither is an outbound
  // reference to anywhere.
  .filter((u) => !u.startsWith('https://schema.org') && !u.startsWith('https://jmbt.dev'));
const unexpected = all.filter((u) => !ALLOWED.has(u.replace(/\/$/, '')) && !ALLOWED.has(u));
check('every outbound URL is on the allowed list', unexpected.length === 0,
  unexpected.length ? unexpected.join(', ') : `${all.length} distinct, all expected`);

const beat7 = html.slice(html.indexOf('id="beat-7"'));
const contact = [...new Set([...beat7.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]))];
check('contact beat links to GitHub and X only',
  contact.length === 2 && contact.includes('https://github.com/jmbt25')
    && contact.includes('https://x.com/jmbt_dev'),
  contact.join(', '));

/* ------------------------------------------------------------ C2, fonts */

console.log('\nC2, the dead latin-ext subset\n');
check('jetbrains-mono-latin-ext.woff2 is not in dist/',
  !fs.existsSync(path.join(DIST, 'fonts', 'jetbrains-mono-latin-ext.woff2')));
check('no @font-face references it', !html.includes('latin-ext'));

// C2 is void if any copy needs a codepoint in that subset's range, so that is
// checked rather than assumed.
const EXT_RANGES = [
  [0x0100, 0x02ba], [0x02bd, 0x02c5], [0x02c7, 0x02cc], [0x02ce, 0x02d7],
  [0x02dd, 0x02ff], [0x1d00, 0x1dbf], [0x1e00, 0x1e9f], [0x1ef2, 0x1eff],
  [0x2020, 0x2020], [0x20a0, 0x20ab], [0x20ad, 0x20c0], [0x2113, 0x2113],
  [0x2c60, 0x2c7f], [0xa720, 0xa7ff],
];
const text = html.replace(/<[^>]*>/g, ' ');
const needed = [...new Set([...text].filter((ch) => {
  const c = ch.codePointAt(0);
  return EXT_RANGES.some(([lo, hi]) => c >= lo && c <= hi);
}))];
check('no page copy needs a latin-ext codepoint', needed.length === 0,
  needed.length ? needed.map((c) => `U+${c.codePointAt(0).toString(16)}`).join(' ') : '');

/* ------------------------------------------------- the guard's own state */

console.log('\nscripts/check-identity.sh\n');

const denylist = 'scripts/.identity-denylist';
const havelist = fs.existsSync(denylist);

// Fail closed with no list. Asserted by running it, not by reading the script.
const noList = sh(['scripts/check-identity.sh', DIST],
  { env: { ...process.env, IDENTITY_DENYLIST: '', IDENTITY_DENYLIST_FILE: 'scripts/.no-such-denylist' } });
check('fails closed when the denylist is missing', noList.code !== 0,
  `exit ${noList.code}`);

// And it actually detects. A term that is certainly present must be caught, or
// a green result from the real list would mean nothing.
const canary = sh(['scripts/check-identity.sh', DIST],
  { env: { ...process.env, IDENTITY_DENYLIST: 'jmbt25' } });
check('detects a term that is present', canary.code !== 0, `exit ${canary.code}`);

const clean = sh(['scripts/check-identity.sh', DIST],
  { env: { ...process.env, IDENTITY_DENYLIST: 'a-string-that-is-not-in-this-repository-0001' } });
check('passes on a term that is absent', clean.code === 0, `exit ${clean.code}`);

if (havelist) {
  const real = sh(['scripts/check-identity.sh', DIST]);
  check('the real denylist scan', real.code === 0, real.out.trim().split('\n').pop());
} else {
  console.log('  OWED  the substantive scan has not been run. scripts/.identity-denylist');
  console.log('        does not exist on this machine, and per D4 it is untracked on');
  console.log('        purpose, so it cannot be recovered from the repository. Create it');
  console.log('        with the studio terms, one per line, then run npm run check:identity.');
}

console.log(failed ? '\nIDENTITY CHECKS FAIL' : '\nIDENTITY CHECKS OK');
if (failed) process.exitCode = 1;
