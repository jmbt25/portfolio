// Strict schema validator and unicode normalizer for /thinking entries.
// Single source of truth, three consumers: the content guard (CLI), the site
// build (imports validateEntry), and its own fixtures test.
//
// Design intent it defends against:
//   - working-tree-encoding tricks: the CLI reads the EXACT staged blob
//     (git cat-file blob :path), not the working-tree file.
//   - value-shape tricks (headline as an array): strict typeof checks.
//   - escape/zero-width tricks: JSON.parse resolves \uXXXX, then the scan value
//     folds NFKC and strips format/zero-width/control characters before the
//     guard pattern-matches, so a zero-width-split token scans joined.
//   - javascript:/off-host source URLs: URL parse, https only, host allowlist.
//
// On any validation failure it exits nonzero with the field path and the rule,
// and NEVER echoes the offending value.
//
// Uses only Node built-ins (no npm deps), because CI runs it without an install.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// ---- one normalization implementation ----
// \p{Cf} (Unicode "Format") strips the whole default-ignorable set the spec
// names and more: ZWSP/ZWNJ/ZWJ (U+200B-200D), LRM/RLM and bidi controls,
// word joiner and U+2060-2064, BOM/ZWNBSP (U+FEFF), soft hyphen (U+00AD), and
// tag characters (U+E0000-E007F). Applied after NFKC folds compatibility forms.
const STRIP_FORMAT = /\p{Cf}/gu;

// A control character other than newline: C0 except U+000A, plus DEL and C1.
// Includes carriage return (U+000D) and tab (U+0009). Checked by code point so
// this source file stays pure ASCII (no literal control bytes).
function isBadControlCode(c) {
  return (c <= 0x1f && c !== 0x0a) || (c >= 0x7f && c <= 0x9f);
}

export function normalize(s) {
  return String(s).normalize('NFKC').replace(STRIP_FORMAT, '');
}
export function hasBadControl(s) {
  s = String(s);
  for (let i = 0; i < s.length; i++) if (isBadControlCode(s.charCodeAt(i))) return true;
  return false;
}
// For non-entry scan text (SKILLS.md, PR body, stdout log): fold and neutralize
// splitters, but do not reject (these are files, not typed entry values).
export function normalizeForScan(s) {
  let out = '';
  for (const ch of normalize(s)) {
    if (!isBadControlCode(ch.codePointAt(0))) out += ch;
  }
  return out;
}
// For an entry value about to be pattern-scanned: collapse whitespace to a
// single space so a multi-line body scans as one line.
function scanValue(s) {
  return normalize(s).replace(/\s+/g, ' ').trim();
}

class ValidationError extends Error {
  constructor(path, rule) {
    super(`${path}: ${rule}`);
    this.path = path;
    this.rule = rule;
  }
}

export function loadContext(repoRoot = REPO_ROOT) {
  const yaml = readFileSync(resolve(repoRoot, 'agent/sources.yaml'), 'utf8');
  const hosts = new Set();
  for (const m of yaml.matchAll(/^\s*url:\s*(\S+)/gm)) {
    try { hosts.add(new URL(m[1]).hostname); } catch { /* ignore */ }
  }
  const ts = readFileSync(resolve(repoRoot, 'src/data/projects.ts'), 'utf8');
  const projects = new Set();
  for (const m of ts.matchAll(/name:\s*'([^']+)'[\s\S]*?agentReferenceable:\s*(true|false)/g)) {
    if (m[2] === 'true') projects.add(m[1]);
  }
  if (hosts.size === 0) throw new Error('loadContext: no source hosts found');
  if (projects.size === 0) throw new Error('loadContext: no agentReferenceable projects found');
  return { hosts, projects };
}

const ITEM_REQUIRED = ['id', 'kind', 'headline', 'body', 'related_project', 'confidence'];
const ITEM_OPTIONAL = ['source_title', 'source_url', 'source_name'];
const ITEM_ALLOWED = new Set([...ITEM_REQUIRED, ...ITEM_OPTIONAL]);
const KINDS = new Set(['improvement', 'new-project', 'quiet-day']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function str(v, path) {
  if (typeof v !== 'string') throw new ValidationError(path, 'must be a string');
  if (hasBadControl(v)) throw new ValidationError(path, 'contains a control character');
  return v;
}

// Returns { values: [{field, value}] } with values normalized for scanning, or throws.
export function validateEntry(obj, { hosts, projects, expectedDate }) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new ValidationError('$', 'must be an object');
  const top = Object.keys(obj).sort();
  if (top.length !== 3 || top[0] !== 'date' || top[1] !== 'items' || top[2] !== 'meta')
    throw new ValidationError('$', 'top level must be exactly {date, items, meta}');

  const values = [];
  const date = str(obj.date, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('date', 'must be YYYY-MM-DD');
  if (expectedDate && date !== expectedDate) throw new ValidationError('date', `must equal filename date ${expectedDate}`);
  values.push({ field: 'date', value: scanValue(date) });

  if (!Array.isArray(obj.items)) throw new ValidationError('items', 'must be an array');
  if (obj.items.length < 1 || obj.items.length > 2) throw new ValidationError('items', 'must have 1 or 2 items');

  obj.items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (it === null || typeof it !== 'object' || Array.isArray(it)) throw new ValidationError(p, 'must be an object');
    for (const k of Object.keys(it)) if (!ITEM_ALLOWED.has(k)) throw new ValidationError(`${p}.${k}`, 'unknown key');
    for (const k of ITEM_REQUIRED) if (!(k in it)) throw new ValidationError(`${p}.${k}`, 'missing required key');

    const kind = str(it.kind, `${p}.kind`);
    if (!KINDS.has(kind)) throw new ValidationError(`${p}.kind`, 'invalid kind');
    const id = str(it.id, `${p}.id`);
    if (!/^\d{4}-\d{2}-\d{2}-[a-z]$/.test(id)) throw new ValidationError(`${p}.id`, 'must be YYYY-MM-DD-x');
    if (id.slice(0, 10) !== date) throw new ValidationError(`${p}.id`, 'id date prefix must equal entry date');
    const headline = str(it.headline, `${p}.headline`);
    const body = str(it.body, `${p}.body`);

    if (it.related_project !== null) {
      const rp = str(it.related_project, `${p}.related_project`);
      if (!projects.has(rp)) throw new ValidationError(`${p}.related_project`, 'not an agentReferenceable project');
      values.push({ field: 'related_project', value: scanValue(rp) });
    }
    if (typeof it.confidence !== 'number' || !Number.isFinite(it.confidence)) throw new ValidationError(`${p}.confidence`, 'must be a finite number');
    if (it.confidence < 0 || it.confidence > 1) throw new ValidationError(`${p}.confidence`, 'must be within [0,1]');

    const hasSource = ITEM_OPTIONAL.some((k) => k in it);
    if (kind === 'quiet-day' && hasSource) throw new ValidationError(p, 'quiet-day must omit all source_* fields');
    if ('source_url' in it) {
      const su = str(it.source_url, `${p}.source_url`);
      let u;
      try { u = new URL(su); } catch { throw new ValidationError(`${p}.source_url`, 'is not a valid URL'); }
      if (u.protocol !== 'https:') throw new ValidationError(`${p}.source_url`, 'protocol must be https');
      if (!hosts.has(u.hostname)) throw new ValidationError(`${p}.source_url`, 'host is not on the source allowlist');
      values.push({ field: 'source_url', value: scanValue(su) });
    }
    if ('source_title' in it) values.push({ field: 'source_title', value: scanValue(str(it.source_title, `${p}.source_title`)) });
    if ('source_name' in it) values.push({ field: 'source_name', value: scanValue(str(it.source_name, `${p}.source_name`)) });

    values.push({ field: 'kind', value: scanValue(kind) });
    values.push({ field: 'id', value: scanValue(id) });
    values.push({ field: 'headline', value: scanValue(headline) });
    values.push({ field: 'body', value: scanValue(body) });
  });

  const meta = obj.meta;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new ValidationError('meta', 'must be an object');
  const mk = Object.keys(meta).sort();
  if (mk.length !== 3 || mk[0] !== 'generated_at' || mk[1] !== 'sources_checked' || mk[2] !== 'sources_failed')
    throw new ValidationError('meta', 'must be exactly {sources_checked, sources_failed, generated_at}');
  for (const k of ['sources_checked', 'sources_failed'])
    if (!Number.isInteger(meta[k]) || meta[k] < 0) throw new ValidationError(`meta.${k}`, 'must be a non-negative integer');
  const ga = str(meta.generated_at, 'meta.generated_at');
  if (!ISO.test(ga) || Number.isNaN(Date.parse(ga))) throw new ValidationError('meta.generated_at', 'must be ISO-8601');
  values.push({ field: 'generated_at', value: scanValue(ga) });

  return { values };
}

// ---- CLI ----
function readBlobStaged(path) {
  return execFileSync('git', ['cat-file', 'blob', `:${path}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function fail(msg, code) { process.stderr.write(msg + '\n'); process.exit(code); }

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--normalize')) {
    const source = (args.find((a) => a.startsWith('--source=')) || '--source=worktree').split('=')[1];
    const f = args.filter((a) => !a.startsWith('--'))[0];
    if (!f) fail('entry-validate: --normalize needs a file', 2);
    let raw;
    try { raw = source === 'staged' ? readBlobStaged(f) : readFileSync(f, 'utf8'); }
    catch (e) { fail(`entry-validate: cannot read ${source} for ${f}`, 2); }
    process.stdout.write(normalizeForScan(raw));
    return;
  }
  const emit = args.includes('--emit-values');
  const source = (args.find((a) => a.startsWith('--source=')) || '--source=staged').split('=')[1];
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) fail('entry-validate: no files given', 2);
  let ctx;
  try { ctx = loadContext(); } catch (e) { fail(`entry-validate: ${e.message}`, 2); }

  for (const f of files) {
    let raw;
    try {
      raw = source === 'worktree' ? readFileSync(f, 'utf8') : readBlobStaged(f);
    } catch (e) {
      fail(`entry-validate: cannot read ${source} blob for ${f}`, 2); // enumeration error, never an empty pass
    }
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { fail(`${f}: not valid JSON`, 1); }
    const expectedDate = basename(f).replace(/\.json$/, '');
    let result;
    try {
      result = validateEntry(obj, { hosts: ctx.hosts, projects: ctx.projects, expectedDate });
    } catch (e) {
      fail(`${f}: ${e.path || '$'}: ${e.rule || e.message}`, 1); // never echoes the value
    }
    if (emit) for (const { field, value } of result.values) process.stdout.write(`${field}\t${value}\n`);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main(process.argv);
