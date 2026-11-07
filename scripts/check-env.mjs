#!/usr/bin/env node
/**
 * aionui-rust environment preflight.
 *
 * Pure Node — runs before `npm install` and before any Rust build.
 * Usage: node scripts/check-env.mjs
 *
 * Exit code 0 = all required items present (warnings allowed).
 * Exit code 1 = at least one required item missing; see "MISSING" lines.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = resolve(ROOT, '..');

const results = [];
const add = (name, ok, detail, required = true) => results.push({ name, ok, detail, required });

function run(cmd, args, timeout = 8000, shell = false) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, shell, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/** Semver-ish comparison: is `actual` within >=22 <25 ? */
function nodeOk(ver) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(ver || '');
  if (!m) return false;
  const major = Number(m[1]);
  return major >= 22 && major < 25;
}

// ---------------------------------------------------------------------------
// 1. Node toolchain
// ---------------------------------------------------------------------------
const nodeVer = run(process.execPath, ['--version']);
add('Node.js >=22 <25', nodeOk(nodeVer), nodeVer ?? 'not found', true);

const npmVer = (() => {
  // On Windows `npm` resolves to a POSIX shell script that execFileSync cannot
  // spawn directly; `cmd /c` resolves it without enabling shell:true.
  const probes = process.platform === 'win32'
    ? [['cmd', ['/c', 'npm', '--version']], ['npm', ['--version']]]
    : [['npm', ['--version']]];
  for (const [cmd, args] of probes) {
    const v = run(cmd, args);
    if (v && /^\d+\.\d+\.\d+/.test(v)) return v;
  }
  return null;
})();
add('npm', !!npmVer, npmVer ? `v${npmVer}` : 'not found', true);

const gitVer = run('git', ['--version']);
add('git', !!gitVer, gitVer ?? 'not found', false);

const bunVer = run('bun', ['--version']);
add('bun (optional)', !!bunVer, bunVer ? `v${bunVer}` : 'not installed — P1 uses npm', false);

// ---------------------------------------------------------------------------
// 2. Rust toolchain — REQUIRED only from P3 onward (Tauri shell build).
//    The backend uses a prebuilt GitHub Release binary, so P0/P1/P2 do NOT
//    need Rust. See docs/BACKEND_BINARY.md.
// ---------------------------------------------------------------------------
const rustcVer = run('rustc', ['--version']);
const cargoVer = run('cargo', ['--version']);
const rustupShow = run('rustup', ['show']);
const hostTuple = run('rustc', ['--print', 'host-tuple']);

const RUST_REQUIRED = process.env.AIONUI_STAGE === 'p3';
add('rustc >= 1.90 (P3: Tauri shell only)', /rustc 1\.(9[0-9]|\d{3,})\./.test(rustcVer || ''), rustcVer ?? 'not installed — needed only from P3', RUST_REQUIRED);
add('cargo (P3: Tauri shell only)', !!cargoVer, cargoVer ?? 'not installed — needed only from P3', RUST_REQUIRED);
add('rustup (P3: Tauri shell only)', !!rustupShow, rustupShow ? rustupShow.split('\n')[0] : 'not installed — needed only from P3', RUST_REQUIRED);
add(
  'Rust host = *-windows-msvc (P3)',
  process.platform !== 'win32' || /windows-msvc/.test(hostTuple || ''),
  hostTuple ?? 'not installed — needed only from P3',
  RUST_REQUIRED && process.platform === 'win32'
);

// Read AionCore's pinned toolchain so the check stays honest if upstream bumps.
const toolchainFile = resolve(PARENT, 'AionCore', 'rust-toolchain.toml');
if (existsSync(toolchainFile)) {
  const pinned = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(toolchainFile, 'utf8'))?.[1];
  add('AionCore rust-toolchain.toml readable', !!pinned, pinned ? `channel=${pinned}` : 'unparsable', false);
} else {
  add('AionCore rust-toolchain.toml readable', false, `${toolchainFile} not found`, false);
}

// ---------------------------------------------------------------------------
// 3. MSVC C++ build tools — REQUIRED only from P3 onward (Tauri shell).
// ---------------------------------------------------------------------------
if (process.platform === 'win32') {
  // `cl.exe` is not on PATH in a normal shell; probe VS installations instead.
  const vsRoots = [
    'C:/Program Files/Microsoft Visual Studio/2022',
    'C:/Program Files (x86)/Microsoft Visual Studio/2022',
    'C:/BuildTools',
  ];
  const vsFound = vsRoots.find((p) => existsSync(p));
  const sdkDir = 'C:/Program Files (x86)/Windows Kits/10/Include';
  const sdkFound = existsSync(sdkDir);
  add(
    'VS 2022 Build Tools (P3: Tauri shell only)',
    !!vsFound,
    vsFound ?? 'not installed — needed only from P3 ("Desktop development with C++")',
    RUST_REQUIRED
  );
  add('Windows 10/11 SDK headers (P3)', sdkFound, sdkFound ? sdkDir : 'not installed — needed only from P3', RUST_REQUIRED);

  // Warn about the MSYS `link.exe` trap.
  const msysLink = run('sh', ['-c', 'command -v link.exe']);
  if (msysLink && msysLink.includes('/usr/bin')) {
    add(
      'MSYS /usr/bin/link.exe is NOT the MSVC linker',
      false,
      'This is coreutils link, not the cl.exe toolchain. Use "x64 Native Tools Command Prompt".',
      false
    );
  }
}

// ---------------------------------------------------------------------------
// 4. WebView2 Runtime (REQUIRED on Windows)
// ---------------------------------------------------------------------------
if (process.platform === 'win32') {
  let wv = null;
  try {
    const ps = `Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty pv`;
    wv = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 10000 }).trim() || null;
  } catch {
    wv = null;
  }
  add('WebView2 Runtime', !!wv, wv ? `v${wv}` : 'MISSING — install Evergreen Runtime', true);
}

// ---------------------------------------------------------------------------
// 5. Upstream repos
// ---------------------------------------------------------------------------
for (const repo of ['AionCore', 'AionUi', 'lom-desktop']) {
  const p = resolve(PARENT, repo);
  add(`../${repo} present`, existsSync(p), p, true);
}
add(
  '../AionCore/crates/aionui-app/src/cli.rs present',
  existsSync(resolve(PARENT, 'AionCore/crates/aionui-app/src/cli.rs')),
  'needed to confirm sidecar CLI flags',
  true
);
add(
  '../AionUi/packages/desktop/src/renderer/index.html present',
  existsSync(resolve(PARENT, 'AionUi/packages/desktop/src/renderer/index.html')),
  'frontend sync source',
  true
);

// ---------------------------------------------------------------------------
// 5b. Prebuilt backend binary (adopted via scripts/adopt-aioncore.mjs in P1).
//     Informational at P0; required from P3 onward.
// ---------------------------------------------------------------------------
const binariesDir = resolve(ROOT, 'src-tauri', 'binaries');
const sidecarCandidates = existsSync(binariesDir)
  ? readdirSync(binariesDir).filter((f) => /^aioncore-.*\.exe$/i.test(f))
  : [];
add(
  'prebuilt aioncore v0.2.2 sidecar (P1 adopt-aioncore.mjs)',
  sidecarCandidates.length > 0,
  sidecarCandidates.length > 0
    ? sidecarCandidates.join(', ')
    : 'not found — run `node scripts/adopt-aioncore.mjs --from <user artifact dir>`',
  RUST_REQUIRED
);

// ---------------------------------------------------------------------------
// 6. Network endpoints (informational — never block on a slow probe)
// ---------------------------------------------------------------------------
const endpoints = [
  ['https://static.rust-lang.org/dist/channel-rust-1.95.0.toml', 'rustup toolchain'],
  ['https://index.crates.io/config.json', 'cargo sparse index'],
  ['https://static.crates.io/crates/serde/serde-1.0.219.crate', 'crate download'],
  ['https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/aioncore-checksums.txt', 'AionCore v0.2.2 checksums'],
  ['https://github.com/iOfficeAI/aionrs.git/info/refs?service=git-upload-pack', 'AionCore git dep (unused with prebuilt)'],
  ['https://registry.npmjs.org/', 'npm registry'],
];
for (const [url, label] of endpoints) {
  let code = null;
  try {
    code = execFileSync('curl', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '15', '-A', 'aionui-env-check', url], {
      encoding: 'utf8',
      timeout: 12000,
      shell: false,
    }).trim();
  } catch {
    code = null;
  }
  const ok = code !== null && Number(code) < 400;
  add(`net: ${label}`, ok, code ? `HTTP ${code}` : 'unreachable (retry / check proxy)', false);
}

// ---------------------------------------------------------------------------
// 7. Disk space on the drive holding this project (warning only)
// ---------------------------------------------------------------------------
try {
  const drive = ROOT.slice(0, 2).toLowerCase(); // "d:"
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `$d=Get-PSDrive -Name '${drive[0]}' -ErrorAction SilentlyContinue; if($d){[math]::Round($d.Free/1GB,1)}`,
  ], { encoding: 'utf8', timeout: 10000 }).trim();
  const free = Number(out) || 0;
  add(
    `${drive.toUpperCase()} free space >= 20 GB`,
    free >= 20,
    free ? `${free} GB free — prebuilt backend needs only ~3-8 GB` : 'could not determine',
    false
  );
} catch {
  add('disk space probe', false, 'skipped', false);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = Math.max(...results.map((r) => r.name.length));
let missingRequired = 0;
let warnings = 0;

console.log('\n=== aionui-rust environment preflight ===\n');
for (const r of results) {
  const mark = r.ok ? '✅' : r.required ? '❌' : '⚠️ ';
  if (!r.ok && r.required) missingRequired++;
  if (!r.ok && !r.required) warnings++;
  console.log(`${mark} ${r.name.padEnd(pad)}  ${r.detail ?? ''}`);
}

console.log(`\nSummary: ${results.filter((r) => r.ok).length}/${results.length} ok, ${warnings} warning(s), ${missingRequired} required missing.`);
if (missingRequired > 0) {
  console.log(`\n→ Stage: ${RUST_REQUIRED ? 'P3' : 'P0/P1 (Rust & MSVC deferred to P3)'}.`);
  console.log('→ Follow docs/ENV_SETUP.md to install the missing items, then re-run this script.');
  process.exit(1);
}
console.log(RUST_REQUIRED
  ? '→ P3 environment ready. Proceed to build the Tauri shell.\n'
  : '→ P0/P1 environment ready. Proceed with sync-frontend.mjs + adopt-aioncore.mjs.\n');
