# 环境安装与自检（aionui-rust）

> 检测时间：基于当前 Windows 11 / MINGW64 环境实测。
> 检测脚本：`node scripts/check-env.mjs`（纯 Node，不依赖 Rust/npm install，装完随时复跑）。
>
> **修订（2026-11-07）**：后端改用 GitHub Release 预编译成品，
> **Rust 工具链与 MSVC 不再是 P0 阻塞项**，降级为「P3 编译 Tauri 壳时才需要」。
> 详见 [`BACKEND_BINARY.md`](BACKEND_BINARY.md)。

## 1. 当前环境实测结果

| 项 | 状态 | 实测值 / 说明 |
|---|---|---|
| OS | ✅ | Windows_NT / MINGW64_NT-10.0-26300 x86_64 |
| Node.js | ✅ | **v24.11.0**（满足 AionUi `engines: >=22 <25`） |
| npm | ✅ | 11.6.1 |
| git | ✅ | 2.27.0.windows.1 |
| **WebView2 Runtime** | ✅ | **149.0.4022.80**（Tauri Windows 必需，已装） |
| 网络 → static.rust-lang.org | ✅ | 200 |
| 网络 → win.rustup.rs | ✅ | 200 |
| 网络 → index.crates.io | ✅ | 200（cargo sparse index） |
| 网络 → static.crates.io | ✅ | 200（crate 下载） |
| 网络 → github.com / iOfficeAI/aionrs.git | ✅ | 200（AionCore 有 12 处 git 依赖） |
| 网络 → registry.npmjs.org | ✅ | PONG ~2.1s |
| D: 可用空间 | ⚠️ | **约 29 G**（`target/` + `node_modules` 可能吃掉 15–25 G，建议先清理或改 target 目录） |
| **rustc / cargo / rustup** | ⚠️ P3 才需要 | **当前缺失**（`C:\Users\howay\.cargo\bin` 不存在）。P0/P1/P2 不需要；只有编译 `src-tauri` 时才装 |
| **MSVC Build Tools** | ⚠️ P3 才需要 | 无 VS 安装目录、无 Windows SDK、无 `cl.exe`/`msbuild.exe`/`nmake.exe`。同样只用于 Tauri 壳 |
| **bun** | ❌ | 缺失（P1 用 npm 即可，非必需） |
| pnpm / yarn / just / cmake / pkg-config / protoc / nasm / clang / gcc | ❌ | 非必需（见下） |
| Python 3 | ⚠️ | `python` 指向 WindowsApps 占位符且 Permission denied；**本工程不依赖 Python**，但若装 VS 会顺带解决 |
| `link.exe` | ⚠️ | `/usr/bin/link.exe` 是 MSYS coreutils 的硬链接工具，**不是 MSVC linker** |
| `cl.exe` / Windows SDK | ❌ | 缺失 → `libgit2-sys`、`libsqlite3-sys`、ring 等无法编译 |
| WebView2 | ✅ | 已装，无需再装 |

**结论（修订后）：P0 阶段环境已经齐备，可以立即开始 P1。**
只有进入 P3（编译/打包 Tauri 壳）时才需要装 Rust 工具链 + MSVC Build Tools。
后端 `aioncore.exe` 用 GitHub Release 成品，完全不需要编译。

## 2. P0 / P1：不需要安装任何东西

后端改为预编译成品后，实测链路已验证：

| 检查 | 结果 |
|---|---|
| `https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/...zip` | HTTP 200，35 MB |
| SHA256 与官方 `aioncore-checksums.txt` 比对 | ✅ 一致（zip `d1ed8d1…` / exe `67eb0277…`） |
| 解压得到 `aioncore.exe` | 99 MB，单个文件 |
| `--local --host 127.0.0.1 --port <随机> --data-dir <临时>` | ✅ `GET /health` → `200 {"status":"ok","version":"0.2.2"}` |
| `--local` 下 CORS | `access-control-allow-origin: *` ✅ |

本项目采用 **方式 B**：`node scripts/adopt-aioncore.mjs --from <用户成品目录>`
（已实跑，见 `docs/IMPLEMENTATION.md`）。它会完成「定位 exe → SHA256 校验 →
`--version`/`--help`/`/health` 冒烟 → 按 target triple 改名 → 写 `checksums.json`」。
方式 A 的 `fetch-aioncore.mjs` 尚未实现（当前不需要联网下载）。
你只需保证能访问 GitHub Releases（已实测可达）用于校验哈希。

## 3. P3 才需要安装（先跳过，到时再装）

### ① Rust 工具链

Tauri 2 官方插件要求 ≥ 1.90，`../AionCore/rust-toolchain.toml` 固定 1.95.0，两者兼容。

用 **PowerShell（管理员普通权限均可）** 执行：

```powershell
# 方式 A：官方 rustup-init（推荐）
Invoke-WebRequest https://win.rustup.rs -OutFile "$env:TEMP\rustup-init.exe"
& "$env:TEMP\rustup-init.exe" -y --default-toolchain 1.95.0 --profile default
```

或下载 <https://rustup.rs/> 的 `rustup-init.exe`，一路默认。

装完**关掉并重开终端**（PATH 才生效），验证：

```powershell
rustc --version        # 期望 rustc 1.95.0
cargo --version
rustup show
rustc --print host-tuple   # 期望 x86_64-pc-windows-msvc
```

> 若 rustup 自动装成 `stable-x86_64-pc-windows-gnu`，用
> `rustup toolchain install 1.95.0-x86_64-pc-windows-msvc` +
> `rustup default 1.95.0-x86_64-pc-windows-msvc` 切到 MSVC。
> **本项目必须用 MSVC target**，否则 Tauri WebView2 链接会失败。

### ② Visual Studio 2022 Build Tools（P3 需要，Windows 上最容易被忽略的一步）

下载 <https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022>
（或 `winget install Microsoft.VisualStudio.2022.BuildTools`），安装时勾选：

- ✅ **使用 C++ 的桌面开发**（Desktop development with C++）
- 右侧明细至少包含：**MSVC v143 C++ x64/x86 生成工具**、**Windows 11 SDK (10.0.22621 或更新)**、C++ CMake 工具（可选）

> 这一步提供 `cl.exe`、`link.exe`(MSVC)、`lib.exe` 和 Windows SDK 头文件，
> 用于编译 **Tauri 壳本身**（`src-tauri/`），不再用于后端。
> 已确认本机 `C:\Program Files (x86)\Microsoft Visual Studio` 与
> `C:\Program Files (x86)\Windows Kits\10\Include` **均不存在**，P3 前必须装。

验证（在 **"x64 Native Tools Command Prompt for VS 2022"** 里，普通 MINGW64 里看不到）：

```cmd
cl
link /?
echo %WindowsSdkDir%
```

### ③ bun（可选，一直不需要）

AionUi 上游用 bun（`bun.lock`）；本工程 P1 起用 **npm**（已可用）即可，不用 bun。
若你想直接跑上游脚本或后续复用上游工具链：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

验证：`bun --version`

### 不需要装的（已核实）

| 项 | 为什么不需要 |
|---|---|
| WebView2 Runtime | 已装 149.0.4022.80 |
| cmake / pkg-config / protoc / nasm / clang / gcc | 本地不编译 AionCore，因此不需要其 C 依赖链；Tauri 壳也无 `cmake`/`bindgen` 脚本 |
| Python 3 | 本工程不跑 node-gyp native 依赖（已把 `better-sqlite3` / `sharp` / `electron` 从前端依赖里裁掉） |
| WiX / NSIS | Tauri CLI 打包时自行下载管理 |
| `@tauri-apps/cli` / `tauri-build` | 通过 `npm install` / cargo 自动获取，不全局装 |
| `cargo-tauri` 全局 | 本工程用 `npm run tauri` 调本地 `@tauri-apps/cli` |

## 4. 空间与网络注意事项（已缓解）

- **磁盘**：D: 剩 ~28.5 G。不再编译 27 个 crates，只需 `node_modules` +
  Tauri `src-tauri/target/`（约 3–8 G）+ 96 MB 的 sidecar 二进制，空间充裕。
  若仍想外移：`[Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', 'E:\cargo-target', 'User')`。
- **网络**：只需 GitHub Releases（已实测 200）与 npm registry（已 PONG）。
  `index.crates.io` / `static.crates.io` / `static.rust-lang.org` 在 P3 装 Rust 时才会用到，均已实测 200。
- **crates.io 主站 403** 属正常：cargo 走 sparse index，不影响。

## 5. 装完后的自检

```bash
node scripts/check-env.mjs
```

脚本会检查：Node 版本、npm、WebView2 注册表、GitHub Releases / npm registry 可达性、
磁盘空间、三份上游仓库，以及**可选的** Rust/MSVC（此时只告警不阻塞）。

P0/P1 只要 `required` 项全绿即可进入骨架搭建；Rust/MSVC 在 P3 前再装。

## 6. 已知上游不一致（记录，暂不阻塞）

| 项 | 现象 |
|---|---|
| AionCore 许可 | `LICENSE` = Apache-2.0，根 `Cargo.toml` `license = "MIT"`；`THIRD-PARTY-NOTICES.md` 会如实标注 |
| 本地 `docs/contributing/development.md` | Prerequisites 未列 Rust/Cargo（线上较新版本已列）；本工程按实测独立处理 |
