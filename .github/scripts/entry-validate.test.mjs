// Unit tests for entry-validate.mjs: strict schema rejects the attack vectors,
// and unicode normalization joins split/escaped denylist tokens. Run: node this.
import { validateEntry } from './entry-validate.mjs';

const ctx = { hosts: new Set(['simonwillison.net']), projects: new Set(['dota-deals']), expectedDate: '2099-01-01' };
let failures = 0;
const base = () => ({
  date: '2099-01-01',
  items: [{
    id: '2099-01-01-a', kind: 'improvement',
    source_title: 't', source_url: 'https://simonwillison.net/x', source_name: 's',
    headline: 'h', body: 'b', related_project: 'dota-deals', confidence: 0.5,
  }],
  meta: { sources_checked: 1, sources_failed: 0, generated_at: '2099-01-01T00:00:00Z' },
});

function reject(name, mutate, ruleIncludes) {
  const e = base(); mutate(e);
  try {
    validateEntry(e, ctx);
    console.log(`  FAIL (no throw)  ${name}`); failures++;
  } catch (err) {
    if (ruleIncludes && !String(err.message).includes(ruleIncludes)) {
      console.log(`  FAIL (rule)      ${name}: got "${err.message}"`); failures++;
    } else {
      console.log(`  ok reject        ${name}`);
    }
  }
}
function accept(name, mutate) {
  const e = base(); if (mutate) mutate(e);
  try { return validateEntry(e, ctx); }
  catch (err) { console.log(`  FAIL (threw)     ${name}: ${err.message}`); failures++; return null; }
}

accept('valid base');
reject('headline as array', (e) => { e.items[0].headline = ['a', 'b']; }, 'must be a string');
reject('confidence as string', (e) => { e.items[0].confidence = '0.5'; }, 'finite number');
reject('javascript: source_url', (e) => { e.items[0].source_url = 'javascript:alert(1)'; }, 'https');
reject('off-host https url', (e) => { e.items[0].source_url = 'https://evil.example.com/x'; }, 'allowlist');
reject('unknown top-level key', (e) => { e.extra = 1; }, 'top level must be exactly');
reject('unknown item key', (e) => { e.items[0].xtra = 1; }, 'unknown key');
reject('quiet-day with source', (e) => { e.items = [{ id: '2099-01-01-a', kind: 'quiet-day', source_url: 'https://simonwillison.net/x', headline: 'h', body: 'b', related_project: null, confidence: 0 }]; }, 'quiet-day must omit');
reject('non-referenceable project', (e) => { e.items[0].related_project = 'ADO MCP Server'; }, 'agentReferenceable');
reject('confidence out of range', (e) => { e.items[0].confidence = 2; }, 'within [0,1]');
reject('control char in body', (e) => { e.items[0].body = 'line1\rline2'; }, 'control');
reject('date not equal filename', (e) => { e.date = '2099-01-02'; e.items[0].id = '2099-01-02-a'; }, 'filename');
reject('meta unknown key', (e) => { e.meta.extra = 1; }, 'must be exactly');
accept('related_project null is valid', (e) => { e.items[0].related_project = null; });

// normalization: a zero-width split token must scan joined
{
  const r = accept('zero-width body', (e) => { e.items[0].body = 'a vulner​ability note'; });
  const body = r && r.values.find((v) => v.field === 'body').value;
  if (body && body.includes('vulnerability')) console.log('  ok normalize     zero-width joined');
  else { console.log(`  FAIL normalize   zero-width: ${JSON.stringify(body)}`); failures++; }
}
// normalization: JSON escape resolves, and NFKC folds fullwidth
{
  const r = accept('escaped body', (e) => { e.items[0].body = 'a private repo and ＡＤＯ'; });
  const body = r && r.values.find((v) => v.field === 'body').value;
  if (body && body.includes('private repo') && body.includes('ADO')) console.log('  ok normalize     escape + fullwidth folded');
  else { console.log(`  FAIL normalize   escape/fullwidth: ${JSON.stringify(body)}`); failures++; }
}

if (failures) { console.log(`entry-validate.test: ${failures} FAILURE(S)`); process.exit(1); }
console.log('entry-validate.test: all passed');
