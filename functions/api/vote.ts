// Cloudflare Pages Function: POST /api/vote
//
// Body:  { "entry_id": "YYYY-MM-DD-a", "signal": "up" | "down" }
// Reply: 200 { ok: true, duplicate: boolean } | 400 | 502
//
// Persists each vote as a file in the GitHub repo at
// `agent/feedback/{entry_id}__{ip_hash_short}.json`. The filename is
// deterministic: a second click from the same IP on the same UTC day for
// the same entry resolves to the same path, so GitHub's GET returns 200
// and we short-circuit without a second commit.
//
// Env (set in Cloudflare Pages → Settings → Environment variables):
//   GITHUB_TOKEN  — fine-grained PAT, contents: write on the target repo
//   GITHUB_REPO   — "owner/name", e.g. "jmbt25/portfolio"
//   VOTE_SALT     — random string, server-side secret for the IP hash
//
// IP hashing: sha256(ip + UTC_date + VOTE_SALT). UTC date rotates daily,
// so the same visitor on the next day produces a different hash.

type Env = {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  VOTE_SALT: string;
};

type Body = { entry_id?: unknown; signal?: unknown };

const ENTRY_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z]$/;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function ghGet(env: Env, path: string) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'user-agent': 'portfolio-vote-fn',
      accept: 'application/vnd.github+json',
    },
  });
}

async function ghPut(env: Env, path: string, contentB64: string, message: string) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'user-agent': 'portfolio-vote-fn',
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message, content: contentB64 }),
  });
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.VOTE_SALT) {
    return json(500, { ok: false, error: 'server-not-configured' });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  const entry_id = String(body.entry_id || '');
  const signal = String(body.signal || '');

  if (!ENTRY_ID_RE.test(entry_id)) return json(400, { ok: false, error: 'bad-entry-id' });
  if (signal !== 'up' && signal !== 'down') return json(400, { ok: false, error: 'bad-signal' });

  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const today = utcDate();
  const ip_hash = await sha256Hex(`${ip}|${today}|${env.VOTE_SALT}`);
  const ip_short = ip_hash.slice(0, 12);

  const path = `agent/feedback/${entry_id}__${ip_short}.json`;

  const existing = await ghGet(env, path);
  if (existing.status === 200) {
    return json(200, { ok: true, duplicate: true });
  }
  if (existing.status !== 404) {
    return json(502, { ok: false, error: 'github-get-failed', status: existing.status });
  }

  const payload = {
    entry_id,
    signal,
    voted_at: new Date().toISOString(),
    ip_hash,
  };
  const contentB64 = btoa(JSON.stringify(payload, null, 2) + '\n');
  const put = await ghPut(env, path, contentB64, `vote: ${signal} on ${entry_id}`);

  if (put.status === 201 || put.status === 200) {
    return json(200, { ok: true, duplicate: false });
  }
  return json(502, { ok: false, error: 'github-put-failed', status: put.status });
};
