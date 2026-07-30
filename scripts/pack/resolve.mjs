/**
 * Locate the glTF-Transform SDK and its Draco codec.
 *
 * The CLI is installed globally, per the phase brief, and it vendors
 * @gltf-transform/core, /extensions, /functions and draco3dgltf inside its own
 * node_modules. Those are the copies used here, so the SDK version can never
 * drift from the CLI version driving the same pipeline.
 *
 * ESM ignores NODE_PATH, so the packages are reached through createRequire
 * rooted inside the CLI's package directory. A local install, if one is ever
 * added to the repo, is preferred and tried first.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PACKAGES = ['@gltf-transform/core', '@gltf-transform/extensions', 'draco3dgltf'];

function works(req) {
  try {
    for (const p of PACKAGES) req.resolve(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate global node_modules directories, derived from the running
 * interpreter rather than by shelling out.
 *
 * `npm root -g` would answer this directly, but npm is a .cmd shim on Windows
 * and Node 24 refuses to spawn one without shell: true, which it then warns
 * about. Deriving the path is both quieter and faster, and npm is kept only as
 * a last resort.
 */
function globalRoots() {
  const bin = path.dirname(process.execPath);
  return [
    path.join(bin, 'node_modules'),                       // Windows layout
    path.join(path.dirname(bin), 'lib', 'node_modules'),  // POSIX prefix layout
  ];
}

function cliRequire(globalRoot) {
  const cliDir = path.join(globalRoot, '@gltf-transform', 'cli');
  if (!fs.existsSync(cliDir)) return null;
  // Rooting the require at a file inside the CLI package makes Node walk up into
  // <cli>/node_modules, which is where the vendored SDK lives.
  const req = createRequire(path.join(cliDir, 'noop.js'));
  return works(req) ? req : null;
}

export function gltfTransformRequire() {
  // 1. A local install in the repo, if one is ever added.
  const local = createRequire(path.join(HERE, 'noop.js'));
  if (works(local)) return local;

  // 2. The globally installed CLI's vendored copies.
  const tried = [];
  for (const root of globalRoots()) {
    tried.push(root);
    const req = cliRequire(root);
    if (req) return req;
  }

  // 3. Ask npm, in case of a non-default prefix.
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npm, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    tried.push(root);
    const req = cliRequire(root);
    if (req) return req;
  } catch {
    /* fall through to the error below */
  }

  throw new Error(
    `could not resolve ${PACKAGES.join(', ')}.\n` +
      `Looked in: ${tried.join(', ')}\n` +
      'Install the CLI with: npm i -g @gltf-transform/cli',
  );
}
