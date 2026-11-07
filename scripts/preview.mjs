#!/usr/bin/env node
/**
 * P4-lite integration preview — no Rust toolchain required.
 *
 * Starts the prebuilt aioncore sidecar and a tiny static server for `dist/`.
 * Since a plain browser has no Tauri `invoke()`, this server injects the
 * backend origin into `dist/index.html` via a bootstrap script that resolves
 * the endpoint gate before the app bundle runs.
 *
 * This validates the exact same HTTP/WS contract the Tauri shell will use:
 *   - GET /health
 *   - /api/settings/client (configService.initialize)
 *   - /api/agents (startup prefetch)
 *   - WebSocket /ws
 *
 * Usage: node scripts/preview.mjs [--port 1420] [--no-sidecar]
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync, mkdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BIN = join(ROOT, 'src-tauri', 'binaries', 'aioncore-x86_64-pc-windows-msvc.exe');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const PORT = Number(arg('--port', '1420'));
const NO_SIDECAR = process.argv.includes('--no-sidecar');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[preview] dist/index.html missing — run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

let child = null;
let dataDir = null;
let backendPort = 0;

async function startSidecar() {
  if (!existsSync(BIN)) throw new Error(`sidecar not found: ${BIN}`);
  backendPort = 30000 + (process.pid % 20000);
  dataDir = join(tmpdir(), `aionui-rust-preview-${process.pid}`);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const args = [
    '--local', '--host', '127.0.0.1', '--port', String(backendPort),
    '--data-dir', dataDir, '--log-level', 'warn',
  ];
  child = spawn(BIN, args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${backendPort}/health`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) {
        console.log(`[preview] aioncore ready on ${backendPort}`);
        return `http://127.0.0.1:${backendPort}`;
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('aioncore did not become healthy within 30s');
}

function inject(html, base) {
  // Resolve the endpoint gate before the app bundle executes. The gate is
  // installed by endpointGate.ts (bundled inside the app), but this inline
  // stub handles the window between HTML parse and module evaluation.
  const script = `<script>
(function(){
  var base = ${JSON.stringify(base)};
  window.__aionuiBackendBaseUrl = base;
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: undefined, configurable: true });
  var key = '__aionuiBackendGate';
  var g = globalThis[key];
  if (!g) {
    var resolve;
    var p = new Promise(function(r){ resolve = r; });
    g = globalThis[key] = { promise: p, resolve: resolve, ready: false, baseUrl: '' };
  }
  g.baseUrl = base; g.ready = true; g.resolve();
  // Upstream desktop marker (AuthContext / Sider / shortcuts).
  if (!window.electronAPI) window.electronAPI = { emit: function(){}, on: function(){} };
  // AionUi 2.2.2 BackendStartupGate: null state means READY → renderApp().
  if (!window.__backendStartupBridge) {
    window.__backendStartupBridge = {
      getState: function(){ return null; },
      subscribe: function(){ return function(){}; },
    };
  }
  if (window.__backendStartupFailure === undefined) window.__backendStartupFailure = null;
})();
<\/script>`;
  return html.replace('<head>', `<head>${script}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  // Same-origin reverse proxy for the backend API + WS-less REST calls.
  if (path.startsWith('/api/') || path === '/health' || path === '/login' || path === '/logout') {
    if (!backendPort) { res.writeHead(502).end('no backend'); return; }
    try {
      const upstream = await fetch(`http://127.0.0.1:${backendPort}${path}${url.search}`, {
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : await streamBody(req),
        signal: AbortSignal.timeout(30000),
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      if (upstream.body) {
        for await (const chunk of upstream.body) res.write(chunk);
      }
      res.end();
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
    return;
  }

  let file = join(DIST, normalize(path).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(DIST, 'index.html'); // SPA fallback
  const body = readFileSync(file);
  const isHtml = extname(file) === '.html';
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(isHtml ? inject(body.toString('utf8'), `http://127.0.0.1:${backendPort}`) : body);
});

function streamBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function main() {
  let base = '';
  if (!NO_SIDECAR) base = await startSidecar();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[preview] http://127.0.0.1:${PORT}`);
    console.log(`[preview] backend: ${base || '(none)'}`);
    console.log('[preview] Ctrl+C to stop.');
  });
}

function shutdown() {
  if (child) { try { child.kill(); } catch { /* noop */ } }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => { console.error('[preview]', e.message); shutdown(); });
