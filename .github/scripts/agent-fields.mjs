// Prints the agent-AUTHORED text fields (headline, body) of each entry JSON
// passed as an argument, one field per line, as:  <file>\t<field>\t<text>
//
// content-guard.sh uses this to scan only agent-authored prose for the
// [vocabulary] denylist, never the cited source_* fields. A cited article
// titled "Prompt Injection as Role Confusion" is not the agent speaking; the
// agent writing "a natural attack surface" in a body is.
//
// Exit 2 on a parse error (fail closed).
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
for (const f of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    console.error(`agent-fields: cannot parse ${f}: ${e.message}`);
    process.exit(2);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  for (const it of items) {
    for (const field of ['headline', 'body']) {
      const v = it && it[field];
      if (typeof v === 'string' && v.length) {
        console.log(`${f}\t${field}\t${v.replace(/\s+/g, ' ')}`);
      }
    }
  }
}
