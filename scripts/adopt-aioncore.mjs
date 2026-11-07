#!/usr/bin/env node
/**
 * Adopt a locally provided aioncore release artifact.
 *
 * Decision (user): sidecar backend, v0.2.2, one-shot copy of the frontend,
 * artifact supplied at:
 *   D:\workspace\rea\aionui\aioncore-v0.2.2-x86_64-pc-windows-msvc
 *
 * This script does NOT compile anything. It:
 *   1. locates aioncore.exe in --from (directory, .zip, or bare .exe)
 *   2. computes SHA-256 and compares to the official v0.2.2 release hash
 *   3. smoke-tests: --version, --help, then --local + GET /health
 *   4. copies to src-tauri/binaries/aioncore-<host-triple>.exe
 *   5. writes src-tauri/binaries/checksums.json
 *
 * Usage:
 *   node scripts/adopt-aioncore.mjs --from <path> [--version v0.2.2] [--no-smoke]
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FROM = resolve(arg('--from', join(ROOT, '..', 'aioncore-v0.2.2-x86_64-pc-windows-msvc')));
const VERSION = arg('--version', 'v0.2.2');
const NO_SMOKE = process.argv.includes('--no-smoke');
const BINARIES = join(ROOT, 'src-tauri', 'binaries');

// Official release values, verified 2026-11-07 against
// https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/aioncore-checksums.txt
const OFFICIAL = {
  'v0.2.2': {
    zip: 'd1ed8d1da869230c18701747d07e8f068db5b8c9442e65261304aeb4c27eacf6',
    exe: '67eb02774bab3855b759ec9756c2e540cd17b64b850407fa4b8bad07fd8a0892',
  },
};

function hostTriple() {
  // No Rust toolchain is required at P0/P1. Derive the triple from the OS/arch.
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function findExe(dir) {
  const direct = join(dir, 'aioncore.exe');
  if (existsSync(direct)) return direct;
  const unix = join(dir, 'aioncore');
  if (existsSync(unix)) return unix;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const found = findExe(join(dir, e.name));
    if (found) return found;
  }
  return null;
}

function unzip(zipPath, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'inherit', timeout: 120000 });
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', dest], { stdio: 'inherit', timeout: 120000 });
  }
}

async function smokeTest(exe) {
  const version = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  const help = execFileSync(exe, ['--help'], { encoding: 'utf8', timeout: 10000 });
  if (!help.includes('--local')) throw new Error('aioncore --help missing --local');

  // Ephemeral data dir; do NOT pass --parent-pid from a shell (it makes the
  // backend think its parent died and shut down gracefully).
  const dataDir = join(tmpdir(), `aionui-rust-smoke-${process.pid}`);
  const port = 30000 + (process.pid % 20000);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  const child = spawn(exe, [
    '--local', '--host', '127.0.0.1', '--port', String(port),
    '--data-dir', dataDir, '--log-level', 'warn',
    '--managed-resources-mode', 'download',
  ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });

  const cleanup = () => {
    try { child.kill(); } catch { /* already gone */ }
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + 30000;
    let body = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`aioncore exited early (code ${child.exitCode})`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) { body = await res.json(); break; }
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!body) throw new Error('GET /health did not return 200 within 30s');
    if (body.status !== 'ok') throw new Error(`unexpected /health body: ${JSON.stringify(body)}`);
    console.log(`[adopt] smoke OK — ${version} /health=${JSON.stringify(body)}`);
    return body.version ?? null;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(FROM)) throw new Error(`--from not found: ${FROM}`);
  const isZip = FROM.toLowerCase().endsWith('.zip');
  const isExe = statSync(FROM).isFile() && /^aioncore(\.exe)?$/i.test(basename(FROM));

  let tempDir = null;
  let sourceExe = null;
  let zipSha = null;

  if (isZip) {
    tempDir = join(tmpdir(), `aionui-rust-adopt-${process.pid}`);
    rmSync(tempDir, { recursive: true, force: true });
    unzip(FROM, tempDir);
    zipSha = sha256(FROM);
    sourceExe = findExe(tempDir);
  } else if (isExe) {
    sourceExe = FROM;
  } else if (statSync(FROM).isDirectory()) {
    sourceExe = findExe(FROM);
  }
  if (!sourceExe || !existsSync(sourceExe)) throw new Error(`aioncore executable not found under ${FROM}`);

  const exeSha = sha256(sourceExe);
  const official = OFFICIAL[VERSION];
  const zipMatch = official && zipSha === official.zip;
  const exeMatch = official && exeSha === official.exe;
  const sourceType = zipMatch || exeMatch ? 'official-release-verified' : 'local-provided';
  console.log(`[adopt] source      : ${FROM}`);
  console.log(`[adopt] exe sha256  : ${exeSha}`);
  console.log(`[adopt] zip sha256  : ${zipSha ?? '(n/a)'}`);
  console.log(`[adopt] sourceType  : ${sourceType}`);
  if (official && !zipMatch && !exeMatch) {
    console.warn(`[adopt] WARNING: hash does not match official ${VERSION} release. Recording as local-provided.`);
  }

  let detectedVersion = VERSION;
  if (!NO_SMOKE) {
    const v = await smokeTest(sourceExe);
    if (v) detectedVersion = v.startsWith('v') ? v : `v${v}`;
  }

  const triple = hostTriple();
  const target = join(BINARIES, `aioncore-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
  mkdirSync(BINARIES, { recursive: true });
  copyFileSync(sourceExe, target);
  console.log(`[adopt] installed   : ${target}`);

  writeFileSync(
    join(BINARIES, 'checksums.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      version: detectedVersion,
      sourceType,
      suppliedFrom: FROM,
      hostTriple: triple,
      exeSha256: exeSha,
      zipSha256: zipSha,
      officialRelease: official ?? null,
      smokeTested: !NO_SMOKE,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`
  );

  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  console.log('[adopt] done.');
}

main().catch((e) => {
  console.error(`[adopt] FAILED: ${e.message}`);
  process.exit(1);
});
