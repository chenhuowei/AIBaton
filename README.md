# aibaton

**Aibaton** — 基于 AionUi `main`/2.2.2 前端 + AionCore v0.2.2 Rust 后端 + Tauri 2 桌面壳的自主品牌应用。
> 前端代码版权头依 Apache-2.0 保留 `Copyright 2025 AionUi (aionui.com)`；用户可见界面已全部改品牌。

> 当前状态：**P0–P5 全部完成并验证**。
> **2026-11-07 更新 6**：设计并生成 Aibaton 专属图标（AI + baton 概念，7 帧 ICO + 全套 PNG），
> 替换上游资源并重新打包，详见 [`docs/ICON_DESIGN.md`](docs/ICON_DESIGN.md)。
> **2026-11-07 更新 5**：品牌化 **Aibaton**（3A，identifier `com.aibaton.desktop`）、
> NSIS 卸载显眼提示、关于页数据目录、审计 A–F 全做。
> 详见 [`docs/BRANDING_IMPLEMENTATION.md`](docs/BRANDING_IMPLEMENTATION.md)。
> **已产出 Windows 安装包**：`Aibaton_0.2.2_x64-en-US.msi` 47.14 MiB /
> `Aibaton_0.2.2_x64-setup.exe` 34.39 MiB。
> 详见 [`docs/TAURI_CAPABILITIES.md`](docs/TAURI_CAPABILITIES.md)。
> **2026-11-07 修复**：启动误弹登录页的 bug（不是操作错误，是适配层注入时机问题），
> 已用 CDP 验证进入主界面并重新打包，详见 [`docs/LOGIN_FIX.md`](docs/LOGIN_FIX.md)。
> 用户确认 Node.js 策略「不做改动，按现状保持」。
> 完整状态见 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)。

## 版本符合性（已核对）

| 项 | 值 |
|---|---|
| `../AionUi` 分支 | `main`（`e108b6b56`） |
| `../AionUi` 版本 | **2.2.2** |
| `../AionUi` 的 `aioncoreVersion` | **v0.2.2** |
| 后端成品（你提供） | **v0.2.2**，`official-release-verified`，SHA256 `67eb0277…0892` |
| 本工程 `package.json` | `0.2.2` |

**完全匹配。** 前端升级后，之前 2.1.1 与 v0.2.2 之间的契约漂移
（`GET /api/agents` 404、`available` vs `installed`）自动消失。

## 三个上游仓库

| 目录 | 角色 | 许可 |
|---|---|---|
| `../AionCore` | Rust 后端源码（Axum + Tokio + SQLite，27 crates）；本期**不编译**，仅作 API/CLI 只读参考。运行的是其 v0.2.2 预编译成品 | `LICENSE` Apache-2.0（根 `Cargo.toml` 写 MIT，不一致） |
| `../AionUi` | `main` / 2.2.2，全量复制其 renderer、common、uno 配置与静态资源 | Apache-2.0 |
| `../lom-desktop` | **仅参考** Tauri 2 配置与构建流程 | `apps/desktop` = AGPL-3.0-only → **未复制其代码** |

## 快速开始（不需要 Rust 工具链）

```bash
cd D:\workspace\rea\aionui\aionui-rust   # 工程目录名可保留，产品品牌为 Aibaton

npm install
npm run typecheck     # exit 0
npm run build         # exit 0，产出 dist/
npm run preview       # 起 v0.2.2 sidecar + http://127.0.0.1:1420
```

`preview` 会注入后端 origin、endpoint 就绪门闩、`electronAPI` 桌面标记、
`__backendStartupBridge`（2.2.2 新增），并反代 `/api/*`、`/health`、`/login`、`/logout`。
Ctrl+C 同时停掉静态服务和 aioncore。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run sync:frontend` | 从 `../AionUi` 全量重新同步 2.2.2 前端 + 打补丁 + 覆盖 overlays |
| `npm run adopt:core` | 接纳你提供的 `aioncore.exe`（校验 + 冒烟 + 按 triple 改名） |
| `npm run check:env` | 环境自检（P0/P1 模式） |
| `npm run icons` | 重新生成 Aibaton 全套图标（PNG + ICO） |
| `AIONUI_STAGE=p3 npm run check:env` | P3 模式（把 Rust/MSVC 升级为必需） |
| `npm run preview` | 无需 Rust 的端到端联调预览 |
| `npm run tauri dev` / `build` | P3 编译 / 打包 Tauri 壳 |

## 开工前必读

1. [`docs/PLAN.md`](docs/PLAN.md) — 落地方案（架构、决策、阶段验收）
2. [`docs/BACKEND_BINARY.md`](docs/BACKEND_BINARY.md) — 后端二进制策略、版本差异、SHA256 实测
3. [`docs/ENV_SETUP.md`](docs/ENV_SETUP.md) — 环境实测与分阶段安装
4. [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — **实现状态**、2.2.2 适配差异、目录结构、已知限制
5. [`docs/LOGIN_FIX.md`](docs/LOGIN_FIX.md) — 启动误弹登录页的根因、修复与 CDP 验证
6. [`docs/TAURI_CAPABILITIES.md`](docs/TAURI_CAPABILITIES.md) — 原生能力补齐 + 默认暗黑模式
7. [`docs/BRANDING_IMPLEMENTATION.md`](docs/BRANDING_IMPLEMENTATION.md) — Aibaton 品牌化、卸载提示、关于页、审计 A–F
8. [`docs/ICON_DESIGN.md`](docs/ICON_DESIGN.md) — 品牌图标设计与生成

## 环境结论（工具链已安装）

| 项 | 实测 |
|---|---|
| Rust | `rustc 1.99.1` / `cargo 1.99.1` / `rustup 1.29.3`，host `x86_64-pc-windows-msvc` |
| VS | VS 2022 Community，MSVC 14.44.35207 |
| Windows SDK | 10.0.26100.0 |
| WebView2 | 149.0.4022.80 |
| `AIONUI_STAGE=p3 npm run check:env` | **0 required missing, exit 0** |

> rustup 装的是 stable（1.99.1），高于 AionCore 的 1.95.0 与 Tauri 插件要求的 ≥1.90，兼容。
> 若 rustc 在某些 shell 里找不到，执行 `export PATH="/c/Users/howay/.cargo/bin:$PATH"`（MINGW64）
> 或重开终端。

## 已确认的决策

① sidecar　② 前端一次性复制　③ 带 8 语言 i18n　④ 后端 **v0.2.2**
⑤ 成品来源 `D:\workspace\rea\aionui\aioncore-v0.2.2-x86_64-pc-windows-msvc`
⑥ **完全使用 AionUi `main` 新前端，移除全部旧前端**

## 打包产物

```
src-tauri/target/release/bundle/msi/Aibaton_0.2.2_x64_en-US.msi   (47.14 MiB)
src-tauri/target/release/bundle/nsis/Aibaton_0.2.2_x64-setup.exe  (34.39 MiB)
```

重新打包：`npm run tauri -- build`（Tauri CLI 会自动下载 WiX / NSIS；**改了前端后必须重编，资源是编译期嵌入的**）。
本项目 **P0–P5 已全部完成**，无待办阻塞项。

> **若你之前打开过旧版本**：`public/sw.js` 的 Service Worker 可能缓存了旧 HTML，
> 重装后若仍看到登录页，清一次 WebView2 缓存或用全新用户目录启动即可。详见 `docs/LOGIN_FIX.md` §3。
