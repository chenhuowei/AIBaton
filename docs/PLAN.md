# aionui-rust 落地方案

> 目标：用 **Rust 后端（AionCore）+ Tauri 2 桌面壳 + AionUi 现有 React 渲染层**，
> 在 `D:\workspace\rea\aionui\aionui-rust` 建一个可运行、可打包的独立工程。
> 本文档是「开工前」的设计与验收依据；实现阶段按 P0–P5 推进。
>
> **修订 1（2026-11-07）**：后端改用 GitHub Release **预编译成品**，**不本地编译 AionCore**。
> 详见 [`BACKEND_BINARY.md`](BACKEND_BINARY.md)。
> **修订 2（2026-11-07）**：AionUi 切到 `main`，前端全量改为 **2.2.2**，后端定为 **v0.2.2**
> （与 `../AionUi/package.json` 的 `aioncoreVersion` 完全一致）。旧的 2.1.1 前端已全部删除。
> 冲突处以本文修订与 [`IMPLEMENTATION.md`](IMPLEMENTATION.md) 为准。

## 0. 一句话架构

```
┌─────────────────────────────── aionui-rust ───────────────────────────────┐
│  WebView (Tauri 2)                                                         │
│    src/  ← AionUi renderer + common 裁剪副本（684 文件 / 6.6 MB）           │
│      ├─ main.tsx  →  invoke('core_endpoint') 拿 { url }                    │
│      ├─ httpBridge.ts / configService.ts  → http://127.0.0.1:<port>/api/* │
│      └─ WebSocket → ws://127.0.0.1:<port>/ws                              │
│                              ▲ Tauri IPC (仅启动握手 + 窗口/文件能力)       │
│  src-tauri/ (Rust)                                                         │
│    ├─ sidecar.rs  → spawn src-tauri/binaries/aioncore-<triple>.exe       │
│    │     --local --host 127.0.0.1 --port <随机> --data-dir/--work-dir/…     │
│    │     --parent-pid <self>（v0.2.2 支持）                                 │
│    ├─ GET /health 200 后才放行前端                                          │
│    └─ 退出时 kill + wait                                                    │
└───────────────────────────────────────────────────────────────────────────┘
                            │ HTTP / WS（与 AionUi 现有契约完全一致）
                            ▼
              aioncore（GitHub Release 预编译成品，v0.2.2）
```

**核心判断**：AionUi 从 v2.1.0 起已经是「TS 前端 + Electron 壳 + Rust 后端二进制」。
换 Tauri 只是**重写「壳」**，后端与绝大多数渲染层代码可原样复用。
当前使用 AionUi **2.2.2**（`main`）+ AionCore **v0.2.2**，版本完全对齐。

## 1. 可复用资产与许可（先看这一节）

| 资产 | 路径 | 许可 | 用法 |
|---|---|---|---|
| **AionCore** | `../AionCore` | `LICENSE` = Apache-2.0（`Cargo.toml` 里写 `MIT`，**不一致，待核**） | **默认不编译、不复制源码**。直接下载 GitHub Release 预编译 `aioncore.exe` 作为 sidecar（见 [`BACKEND_BINARY.md`](BACKEND_BINARY.md)）。本仓库仅作为 API/CLI 行为的**只读参考**与未来 in-process 化的备选 |
| **AionUi** | `../AionUi` | Apache-2.0 | 复制 `main`（**2.2.2**）的 `renderer/`、`common/` 裁剪子集、`public/`、`uno.config.ts`、i18n locales。**一次性复制，不保留 2.1.1** |
| **lom-desktop** | `../lom-desktop` | **apps/desktop = AGPL-3.0-only**；core = Apache-2.0 | **只参考架构模式，不复制任何代码**。`sidecar.rs` 依 AionCore `cli.rs` 与 AionUi `backend-launcher.ts` 独立编写 |

> ⚠️ 合规重点：lom-desktop 的 `apps/desktop/src-tauri/**` 与 `apps/desktop/src/**` 是
> AGPL-3.0-only。若逐行改写其 `sidecar.rs`，新项目有被 AGPL 传染的风险。
> 因此实现时以其 `BUILDING.md` / `tauri.conf.json` 中的**配置与流程**为参考，
> Rust 代码按 AionCore 的真实 CLI 参数自己写，并在 `THIRD-PARTY-NOTICES.md` 注明参考来源。

### 已核对的 AionCore CLI（源码 `cli.rs` + v0.2.2 成品 `--help` 实测）

当前锁定的 **v0.2.2** 成品支持：`--host` / `--port` / `--data-dir` / `--parent-pid` /
`--work-dir` / `--app-version` / `--local` / `--log-dir` / `--log-level` /
`--identity-mode` / `--dump-prompts` / `--recover-corrupted-database` /
`--managed-resources-mode`，以及大量 agent-facing 子命令。

`--parent-pid` 在 v0.2.2 可用（v0.1.10 不支持，但本项目不用该版本）。
完整差异见 [`BACKEND_BINARY.md`](BACKEND_BINARY.md) §5。

已核对：
- `/health` 路由在 `crates/aionui-app/src/router/routes.rs:400` ✅
- `--local` 下 `CorsLayer::new().allow_origin(Any)`（`routes.rs:457`），桌面 WebView 跨域可用 ✅
- 默认端口 25808（`aionui-common/src/constants.rs:54`），但本方案用**随机空闲端口**避免多实例冲突 ✅
- `crates/aionui-app/src/lib.rs` 已导出 `create_router` / `AppServices`，**未来可平滑切到 in-process 单二进制**，见 §3 决策 1

## 2. 目录结构

```
aionui-rust/
├── README.md
├── AGENTS.md                       # 本工程约定（实现阶段补）
├── THIRD-PARTY-NOTICES.md          # Apache-2.0 组件 + lom 参考声明
├── docs/
│   ├── PLAN.md                     # 本文
│   ├── ENV_SETUP.md                # 环境安装与自检清单
│   └── ARCHITECTURE.md             # 实现阶段补
├── scripts/
│   ├── check-env.mjs               # 纯 Node 环境自检（装完即可跑，不需要 Rust）
│   ├── adopt-aioncore.mjs          # 接纳用户提供的本地成品（校验 + 冒烟 + 改名）
│   ├── sync-frontend.mjs           # 从 ../AionUi (main/2.2.2) 全量同步 + 打补丁
│   └── preview.mjs                # 无需 Rust 的端到端联调预览
├── package.json                    # 前端依赖 + @tauri-apps/cli
├── tsconfig.json / vite.config.ts / uno.config.ts / index.html / .gitignore
├── public/                         # AionUi 静态资源
├── src/                            # AionUi renderer 裁剪副本
│   ├── main.tsx                    # 改：Tauri bootstrap
│   ├── tauri/                      # 新增（endpoint / platform / window / dragdrop）
│   │   ├── endpoint.ts
│   │   ├── platform.ts
│   │   └── electronApiShim.ts     # 兼容少量 window.electronAPI 调用
│   └── …（其余 renderer / common 原样）
└── src-tauri/
    ├── Cargo.toml / build.rs / Cargo.lock
    ├── tauri.conf.json             # bundle.externalBin = ["binaries/aioncore"]
    ├── capabilities/default.json
    ├── binaries/.gitkeep           # aioncore-x86_64-pc-windows-msvc.exe 由脚本拷入
    ├── icons/                      # 从 AionUi/resources 生成
    └── src/{main.rs, lib.rs, sidecar.rs, commands.rs}
```

> 遵循「单目录直接子项 ≤ 10」的约定；根目录按职责分组（配置 / docs / scripts / src / src-tauri / public）。

## 3. 关键技术决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 后端集成 | **P0–P4 用 sidecar（externalBin）**，预留 in-process 接口 | 改动最小、与 lom-desktop 已验证路线一致、保留「后端可独立部署到服务器/NAS」；sidecar 在 iOS/Android 不支持，但本期只做 Windows 桌面。`aionui-app` 已是 lib+bin 双形态，后续链入 `src-tauri` 即可单二进制 |
| 2 | 端口 | **随机空闲端口**（`TcpListener::bind("127.0.0.1:0")`），不用固定 25808 | 避免 AionUi / lom / 多实例抢占；`core_endpoint` 把 url 交给前端 |
| 3 | 前端拿端口 | `main.tsx` 顶部 `await invoke('core_endpoint')` → `setBackendEndpoint(url)`；`httpBridge.ts` / `configService.ts` 的 `getBaseUrl()` / `getBackendPort()` 改为读模块级变量 | AionUi 现在是 **同步** 读 `window.__backendPort`（preload `sendSync` 注入），Tauri 没有等价的同步注入。改 3 个函数即可让 **几百个 HTTP/WS 调用点零改动** |
| 4 | `--local` | 启用 | 桌面单用户，跳过 JWT/CSRF，注入 `system_default_user`，与 AionUi 桌面端 `backendManager.start()` 一致 |
| 5 | 后端源码 | **不编译、不 vendoring**：用 GitHub Release 预编译成品 | 单一真源、跳过 27 crates 编译、避免 Windows C++ 工具链与磁盘压力；`../AionCore` 仅作 API/CLI 只读参考 |
| 5b | 后端版本 | **v0.2.2**（用户提供的成品，`official-release-verified`） | 与 AionUi `main`/2.2.2 的 `aioncoreVersion: v0.2.2` **完全一致**；契约漂移问题随前端升级自动消失 |
| 5c | 前端版本 | **AionUi `main` / 2.2.2 全量复制** | 用户要求「完全使用新前端，之前的前端全部移除」；旧 2.1.1 副本/备份/依赖/overlays 均删除 |
| 6 | 版本锁定 | 沿用 lom-desktop 已验证组合：tauri `=2.12.4`、tauri-build `=2.7.3`、plugin-dialog `=2.8.3`、plugin-opener `=2.7.2`、plugin-single-instance `=2.5.2`、`@tauri-apps/api` `2.12.4`、`@tauri-apps/cli` `2.12.3` | 不盲目追新；插件要求 Rust ≥ 1.90，AionCore `rust-toolchain.toml` 为 1.95.0，满足 |
| 7 | 前端依赖 | **裁剪**：移除 electron / electron-vite / electron-builder / better-sqlite3 / electron-updater / @sentry\/electron 等 main-process 依赖；只保留 renderer 需要的子集 | 避免安装 Electron（数百 MB）与 node-gyp native 编译 |
| 8 | 前端构建 | 从 `electron.vite.config.ts` 的 **`renderer` 段**移植到独立 `vite.config.ts`（保留 UnoCSS、IconPark HOC 插件、alias、manualChunks、`base:'./'`） | 去掉 main/preload 两个 target |
| 9 | 多窗口 | M1 只做 `index.html`；`pet.html` / `pet-hit.html` / `pet-confirm.html` 暂不注册 | 降低首个可运行版本的复杂度 |
| 10 | 日志/可观测 | sidecar 生命周期在 Rust 侧用 `tracing`/`log` 输出 `info`（启动、端口、/health 就绪、退出码、超时）；前端保留 `[httpBridge]` / `[WS:msg]` 现有日志 | 满足「生产可诊断」，不记录 token / prompt / 文件内容 |

### 需要适配的 Electron 残留（已定位，共 10 文件 / 14 处）

| 位置 | 处理 |
|---|---|
| `renderer/main.tsx` | `@sentry/electron/renderer` 动态 import → 去掉或换 `@sentry/browser`；插入 Tauri bootstrap |
| `renderer/utils/platform.ts` | `electronAPI` 平台判断 → `isTauri()` / `platform()` |
| `Sider/index.tsx`、`useMinimapPanel.ts` | 窗口控制 / 显隐 → `@tauri-apps/api/window` `getCurrentWindow()` |
| `useWorkspaceDragImport.ts`、`ConversationSearchPopover.tsx` | `webUtils.getPathForFile(file)` → Tauri `onDragDropEvent` 提供绝对路径（`dragDropEnabled: true` + capability） |
| `FeedbackContext.tsx`、`FeedbackReportModal.tsx`、`AuthContext.tsx`、`HTMLRenderer.tsx` | 截图/日志收集/预览 IPC → 首版返回安全降级值或省略（stub），P4 再补 |
| `common/electronSafe.ts`、`common/adapter/browser.ts`、`ipcBridge.ts` | 复核在纯 WebView 下不会因缺 `electron` 模块而抛错；必要时加 `electronApiShim` |

## 4. 分阶段实施与验收

| 阶段 | 交付物 | 验收标准 |
|---|---|---|
| **P0 环境** | `docs/ENV_SETUP.md`、[`docs/BACKEND_BINARY.md`](BACKEND_BINARY.md)、`scripts/check-env.mjs` | `node scripts/check-env.mjs` 全绿（Rust/MSVC 此时仅告警，不阻塞） |
| **P1 骨架** | 目录、package.json、vite/ts/uno 配置、`scripts/adopt-aioncore.mjs`、README、NOTICES | `npm install` 成功；`npm run typecheck` 通过；`node scripts/adopt-aioncore.mjs --from <用户成品目录>` 产出 `aioncore-x86_64-pc-windows-msvc.exe` 且 `/health` 冒烟通过 |
| **P2 前端** | `scripts/sync-frontend.mjs` 全量复制 AionUi `main`/2.2.2（1080 文件）+ 14 处补丁 + `overlays/**` | `npm run typecheck` exit 0；`npm run build` exit 0 |
| **P3 Tauri 壳** | `src-tauri/**`（Rust + MSVC 在此阶段才需要） | `cargo`/`rustc` 可用；`npm run tauri dev` 能起窗口并拉起 sidecar |
| **P4 联调** | `core_endpoint` + `getBaseUrl` 改造 + `externalBin` 打包 | 窗口内 `GET /health` 200、设置页可读 `configService`、WS 连接成功、发一条消息能收到流式事件；退出后无残留 `aioncore.exe` 进程 |
| **P5 分发** | `tauri.conf.json` bundle 配置、图标、CI 脚本 | `npm run tauri build` 产出可安装 exe；NSIS/WiX 由 Tauri CLI 自动获取，无需单独安装 |

每阶段结束跑一次 `scripts/check-env.mjs` + 对应的 build/typecheck，失败不进入下一阶段。

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **磁盘 D: 仅剩 ~29 G** | 曾担心 `target/` + `node_modules` 吃掉 15–25 G | **已大幅缓解**：不编译后端，只需 Tauri `target/` + `node_modules`（约 3–8 G）；仍建议清理或设 `CARGO_TARGET_DIR` |
| ~~AionCore 首次编译极慢~~ | ~~27 crates + `aionrs` git 依赖~~ | **已消除**：改用 Release 预编译成品 |
| ~~crates.io 主站 403 / git 依赖~~ | ~~误判为无法构建~~ | **已消除**：无需 cargo 拉依赖 |
| Windows 缺 MSVC linker | `src-tauri` 编译链接会失败 | **P3 才需要**；装 VS 2022 Build Tools（VCTools + Windows SDK + C++ CMake）。⚠️ 当前 `/usr/bin/link.exe` 是 GNU coreutils 工具，不是 MSVC linker |
| Release 二进制版本与前端不匹配 | API 契约漂移 | **已解决**：AionUi 2.2.2 与 AionCore v0.2.2 版本对齐；`checksums.json` 记录哈希与来源 |
| v0.2.2 移除 `POST /api/agents/refresh` | 前端调用报 404 | `sync-frontend.mjs` 把它改成 no-op（AionCore 自带测试断言 404） |
| `httpBridge` 同步端口假设 | 所有 API 请求打到默认 13400 → ECONNREFUSED | P4 按决策 3 改造；`ensureWs()` 本身是 lazy，天然适配异步 endpoint |
| lom-desktop AGPL 传染 | 分发合规风险 | 只抄配置/流程，不抄代码；Rust 侧独立编写 |
| AionCore `LICENSE`(Apache-2.0) 与 `Cargo.toml`(MIT) 不一致 | 合规标注困难 | `THIRD-PARTY-NOTICES.md` 如实记录两处声明，标注待上游确认 |
| `--managed-resources-mode Download` 默认 | 首次启动可能联网下载托管 Node 运行时 | **决策：不引入 `managed-resources/`，保持默认 `download`**（用户明确不加）。本机实测下载成功；离线下仅 warn，不阻塞 HTTP；安装包不增加约 104 MB |

## 6. 明确不做（本期范围外）

- 移动端（Tauri sidecar 在 iOS/Android 不可用；若要做需切 in-process 架构）
- WebUI / 远程访问 / 独立服务器部署模式
- Electron 侧全部功能（托盘、自动更新、pet 多窗口、Sentry Electron 集成）
- 修改 AionCore 或 AionUi 上游源码
- 重写 AionUi 的 UI（直接复用）

## 7. 决策已确认（无待办选择）

1. **sidecar** ✅（in-process 会要求本地编译 Rust，未选）
2. **前端一次性复制 + 全量使用 AionUi `main`/2.2.2** ✅（旧 2.1.1 已全部删除）
3. **带 8 语言 i18n** ✅
4. **后端 v0.2.2** ✅
5. **成品由用户提供**：`D:\workspace\rea\aionui\aioncore-v0.2.2-x86_64-pc-windows-msvc` ✅

当前进度：P0–P2 + 端到端冒烟已完成并验证；**仅剩 P3**（安装 Rust + MSVC 后编译 `src-tauri/`）。
