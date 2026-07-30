/**
 * Phase 4 step 5b: load the shipped GLB in three.js, headless, and screenshot it.
 *
 *   node scripts/verify/render.mjs
 *
 * Drives the Chrome already installed on this machine through the DevTools
 * protocol over a raw WebSocket. That avoids adding puppeteer, and the protocol
 * surface needed here is small: navigate, poll for a completion flag, capture a
 * screenshot.
 *
 * Chrome's own --screenshot flag was the simpler option and is not used, because
 * it fires on a timer rather than on the page saying it has finished loading and
 * rendering. A GLB with Draco geometry and four transcoded KTX2 textures is not
 * reliably ready inside any fixed budget, and a screenshot of a half loaded scene
 * that looks plausible is worse than no screenshot.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SHOTS = path.join(REPO, 'docs', 'baseline', 'phase4-evidence');
const POSTER = path.join(REPO, 'assets-src', 'poster');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const SHOTS_SPEC = [
  { name: 'slab-1440x900.png', w: 1440, h: 900, dir: SHOTS },
  { name: 'slab-poster-2x-2880x1800.png', w: 2880, h: 1800, dir: POSTER },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let rel = url === '/' ? '/scripts/verify/render.html' : url;
    // public/ is the web root for asset paths, mirroring how Astro serves them.
    let file = rel.startsWith('/assets/')
      ? path.join(REPO, 'public', rel)
      : path.join(REPO, rel);
    file = path.normalize(file);
    if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('no Chrome or Edge found in the standard install locations');
}

/** Minimal CDP client over the browser WebSocket endpoint. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connect(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const ws = new WebSocket(url);
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', rej, { once: true });
      });
      return ws;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`could not connect to ${url}`);
}

async function browserWsUrl(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

async function shoot(cdp, sessionId, url, w, h, out) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);

  let status = null;
  let log = [];
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({s: window.__renderStatus ?? null, l: window.__renderLog ?? []})',
      returnByValue: true,
    }, sessionId).catch(() => null);
    if (r && r.result && typeof r.result.value === 'string') {
      const parsed = JSON.parse(r.result.value);
      if (parsed.s) { status = parsed.s; log = parsed.l; break; }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (status !== 'ok') {
    const detail = log.map(([k, v]) => `${k}=${v}`).join('; ');
    throw new Error(`render did not report ok (status=${status}). ${detail}`);
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  return log;
}

async function main() {
  const glb = path.join(REPO, 'public', 'assets', 'models', 'slab.glb');
  if (!fs.existsSync(glb)) throw new Error(`${glb} missing. Run the pack step first.`);

  const { server, port } = await serve();
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'ph4-chrome-'));
  const dbgPort = 9500 + (process.pid % 400);

  const proc = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${dbgPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    // WebGL in headless needs a software rasteriser; recent Chrome gates
    // SwiftShader behind this flag.
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ], { stdio: 'ignore' });

  let failed = null;
  try {
    const wsUrl = await browserWsUrl(dbgPort);
    const ws = await connect(wsUrl);
    const cdp = new CDP(ws);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    for (const s of SHOTS_SPEC) {
      const url = `http://127.0.0.1:${port}/?w=${s.w}&h=${s.h}`;
      const out = path.join(s.dir, s.name);
      console.log(`rendering ${s.w}x${s.h} -> ${path.relative(REPO, out)}`);
      const log = await shoot(cdp, sessionId, url, s.w, s.h, out);
      for (const [k, v] of log) console.log(`    ${k}: ${v}`);
      const st = fs.statSync(out);
      console.log(`    wrote ${st.size} B\n`);
    }
    ws.close();
  } catch (e) {
    failed = e;
  } finally {
    proc.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (failed) { console.error(failed.message); process.exit(1); }
  console.log('RENDER OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
