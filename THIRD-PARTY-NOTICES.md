# Third-Party Notices — Aibaton

Aibaton is a desktop application built from the following components. The
user-visible product name is **Aibaton**; upstream copyright notices are
retained in source file headers as required by Apache-2.0 §4.

## 1. AionUi frontend (copied and adapted)

- **Source**: <https://github.com/iOfficeAI/AionUi>, `main` branch, version **2.2.2**
  (commit `e108b6b56` at the time of the one-shot copy)
- **Used here**: `src/renderer/**`, `src/common/**` (with Tauri-specific patches),
  `public/**`, `uno.config.ts`, i18n locale data (13 languages)
- **License**: Apache-2.0 (see upstream `LICENSE`)
- **Changes**: Electron-specific code removed; Tauri dialog / window / drag-drop
  adapters added; default dark theme; brand strings replaced with "Aibaton";
  PWA registration disabled; unused Electron IPC channels stubbed.
- **Not removed**: `Copyright 2025 AionUi (aionui.com)` headers in source files.

## 2. AionCore backend (binary, not compiled from source here)

- **Source**: <https://github.com/iOfficeAI/AionCore>, release **v0.2.2**
- **Used here**: prebuilt `aioncore-x86_64-pc-windows-msvc.exe` sidecar
  (placed by `scripts/adopt-aioncore.mjs`; **not committed to git**)
- **SHA-256 (exe)**: `67eb02774bab3855b759ec9756c2e540cd17b64b850407fa4b8bad07fd8a0892`
- **SHA-256 (official release zip)**: `d1ed8d1da869230c18701747d07e8f068db5b8c9442e65261304aeb4c27eacf6`
- **Download**: <https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/aioncore-v0.2.2-x86_64-pc-windows-msvc.zip>
- **License**: upstream `LICENSE` states **Apache-2.0**; the root `Cargo.toml`
  declares `license = "MIT"`. These are inconsistent upstream; both are recorded
  here. Users should confirm with upstream before redistribution.
- The source tree `../AionCore` is used **read-only** as an API/CLI reference.
  No AionCore source is copied into this repository.

## 3. lom-desktop (architecture reference only)

- **Source**: <https://github.com/rfdiosuao/lom-desktop>
- **License**: `apps/desktop` is **AGPL-3.0-only**; `core` is Apache-2.0
- **Use**: only the *build/config pattern* in `BUILDING.md` and
  `tauri.conf.json` was consulted. **No AGPL code was copied.** The Rust shell
  in `src-tauri/src/**` was written independently against the verified
  `aioncore --help` CLI surface.

## 4. Open-source dependencies

- Frontend: see `package.json` / `package-lock.json` (npm registry packages).
- Rust shell: see `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`
  (Tauri 2, tauri-plugin-dialog, tauri-plugin-opener, etc.).
- **Bundled Node.js runtime**: Node.js v24.11.0 (win-x64, `node.exe` + npm/npx),
  staged by `scripts/prepare-node-runtime.mjs` into
  `src-tauri/binaries/managed-resources/` and shipped via `bundle.resources`.
  It originates from the same Node.js distribution AionCore downloads
  (<https://nodejs.org/dist/v24.11.0/node-v24.11.0-win-x64.zip>), Node.js
  license (MIT). The ~104 MB directory is **not committed to git**; re-run
  `npm run prepare:node` before packaging. At first launch AionCore activates
  it into the app data dir with `--managed-resources-mode bundled`, so no
  network download is needed.

## 5. Brand assets

All icons in `src-tauri/icons/**`, `public/pwa/**` and
`src/renderer/assets/logos/brand/app.png` were generated for Aibaton by
`scripts/generate-icons.mjs` (no third-party artwork).

## 6. License of this project

The remote repository ships an Apache-2.0 `LICENSE`. Newly written glue code
(scripts, Tauri shell, overlays, docs) is provided under the same license unless
a file header states otherwise.

Current product version: **v1.0.0** (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`). This is the Aibaton product version; the upstream
AionUi frontend (2.2.2) and AionCore backend (v0.2.2) keep their own versions.
