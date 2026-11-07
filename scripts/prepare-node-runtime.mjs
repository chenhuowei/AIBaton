#!/usr/bin/env node
/**
 * Prepare the bundled Node.js runtime (managed-resources) for the installer.
 *
 * AionCore v0.2.2 supports `--managed-resources-mode bundled`, which reads
 * Node from `<aioncore.exe dir>/managed-resources/` instead of downloading
 * Node 24.11.0 from nodejs.org at first launch.
 *
 * The 104 MB directory is NOT committed to git. Run this script before
 * `npm run tauri -- build` to stage it into src-tauri/binaries/.
 *
 * Resolution order:
 *   1. --from <path>                     explicit managed-resources directory
 *   2. AIONUI_MANAGED_RESOURCES env      custom path
 *   3. installed AionUi's bundled copy   E:/install_dir/aionui/resources/...
 *   4. this app's already-downloaded     %APPDATA%/com.aibaton.desktop/runtime/node
 *      (re-shaped into the expected layout)
 *
 * Usage: node scripts/prepare-node-runtime.mjs [--from <dir>]
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'src-tauri', 'binaries', 'managed-resources');
const NODE_DIR_NAME = 'node-v24.11.0-win-x64';
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

const candidates = [
  arg('--from') ? resolve(arg('--from')) : null,
  process.env.AIONUI_MANAGED_RESOURCES ? resolve(process.env.AIONUI_MANAGED_RESOURCES) : null,
  'E:/install_dir/aionui/resources/bundled-aioncore/win32-x64/managed-resources',
].filter(Boolean);

let source = candidates.find((p) => existsSync(join(p, 'manifest.json')));

// Fall back to reshaping the runtime the backend already downloaded.
const downloaded = join(homedir(), 'AppData', 'Roaming', 'com.aibaton.desktop', 'runtime', 'node', NODE_DIR_NAME);
if (!source && existsSync(join(downloaded, 'node.exe'))) {
  const staged = join(ROOT, '.node-runtime-staged');
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(join(staged, 'node', NODE_DIR_NAME), { recursive: true });
  cpSync(downloaded, join(staged, 'node', NODE_DIR_NAME), { recursive: true });
  writeFileSync(
    join(staged, 'manifest.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      runtimeKey: 'win32-x64',
      node: { version: '24.11.0', root: `node/${NODE_DIR_NAME}`, executable: 'node.exe' },
      clis: [],
    }, null, 2)}\n`
  );
  source = staged;
}

if (!source) {
  console.error('[node-runtime] No managed-resources source found.');
  console.error('  Pass --from <dir>, or install Node via the app once, or set AIONUI_MANAGED_RESOURCES.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
const nodeRoot = join(source, manifest.node.root);
if (!existsSync(join(nodeRoot, manifest.node.executable))) {
  console.error(`[node-runtime] ${manifest.node.executable} missing under ${nodeRoot}`);
  process.exit(1);
}
if (manifest.runtimeKey !== 'win32-x64') {
  console.error(`[node-runtime] expected runtimeKey win32-x64, got ${manifest.runtimeKey}`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(dirname(DEST), { recursive: true });
cpSync(source, DEST, { recursive: true });
console.log(`[node-runtime] staged from ${source}`);
console.log(`[node-runtime] -> ${DEST}`);
console.log('[node-runtime] manifest:', JSON.stringify(manifest));
