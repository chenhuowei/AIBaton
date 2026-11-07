# 实现状态与运行指南

> 决策：① sidecar ② 前端一次性复制 ③ 带 8 语言 i18n ④ 后端 **v0.2.2**
> ⑤ 成品目录 `D:\workspace\rea\aionui\aioncore-v0.2.2-x86_64-pc-windows-msvc`。
>
> **2026-11-07 更新 1**：AionUi 切到 `main`，全量改用 **AionUi 2.2.2** 前端；
> 旧的 2.1.1 副本、备份、旧依赖、旧 overlays 已**全部删除**，无残留。
> **2026-11-07 更新 2**：工具链已安装，**P0–P5 全部完成并验证**，产出 Windows 安装包。

## 1. 版本符合性

| 项 | 值 |
|---|---|
| `../AionUi` 分支 / commit | `main` / `e108b6b56` |
| `../AionUi` 版本 | **2.2.2** |
| `../AionUi.aioncoreVersion` | **v0.2.2** |
| 用户提供的后端成品 | **v0.2.2**，`official-release-verified`，SHA256 `67eb0277…0892` |
| `aionui-rust/package.json` | **0.2.2** |
| `src-tauri/Cargo.toml` / `tauri.conf.json` | **0.2.2**（已统一） |

**完全匹配。** 前端升级到 2.2.2 后，之前「2.1.1 前端 + v0.2.2 后端」的契约漂移
（`GET /api/agents` 404、`available` vs `installed`）自动消失：2.2.2 的
`ipcBridge.ts` 本身就调用 `GET /api/agents/management`，类型也用 `installed`。

唯一保留的兼容处理：v0.2.2 **移除了** `POST /api/agents/refresh`
（AionCore 自带测试 `legacy_refresh_agents_endpoint_is_not_found` 断言 404），
而 2.2.2 前端仍在调用 → 同步脚本把它改成 no-op。

## 2. 工具链（已安装并实测）

| 项 | 实测值 |
|---|---|
| Rust | `rustc 1.99.1` / `cargo 1.99.1` / `rustup 1.29.3` |
| host triple | `x86_64-pc-windows-msvc` ✅ |
| VS | VS 2022 Community，MSVC `14.44.35207` |
| Windows SDK | `10.0.26100.0` |
| WebView2 | `149.0.4022.80` |
| Node / npm | v24.11.0 / 11.6.1 |

> 装的是 stable 1.99.1，高于 AionCore 的 1.95.0 与 Tauri 插件要求的 ≥1.90，兼容。
> 在 MINGW64 里若 `rustc` 不在 PATH：`export PATH="/c/Users/howay/.cargo/bin:$PATH"`。

## 3. 全阶段验证结果

| 阶段 | 结果 |
|---|---|
| `AIONUI_STAGE=p3 node scripts/check-env.mjs` | **0 required missing, exit 0** |
| `npm install` | 666 包 |
| `npm run sync:frontend` | AionUi 2.2.2 **1080 文件** + 14 处补丁全命中 |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0**（`dist/`，主 chunk 8.2 MB） |
| `npm run preview` | `/`、`/health`、`/api/settings/client`、`/api/agents/management`、`/api/conversations`、`/api/assistants` 全部 200 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | **exit 0** |
| `npm run tauri -- build --debug --no-bundle` | **exit 0**，产出 `target/debug/aionui-rust.exe` |
| 运行 debug 窗口 | 窗口 `AionUi Rust` / `Responding=True`；sidecar 拉起、`ready on port 60967`；`/health` 200 |
| 退出清理 | `kill + wait` 生效，无孤儿 `aioncore.exe`、端口释放 |
| `npm run tauri -- build` | **exit 0**，产出 MSI + NSIS 安装包 |
| 运行 release 可执行文件 | `--app-version 0.2.2`、`ready on port 58238`、`/health` 200、`/api/settings/client` 200 |
| **CDP 实测页面 DOM（修复后）** | `electronAPI=true`、endpoint gate ready、`#/guid` 主界面、**无登录页 / 无密码框**、`#root` 有内容。详见 [`LOGIN_FIX.md`](LOGIN_FIX.md) |

## 4. 交付产物

```
src-tauri/target/release/bundle/msi/AionUi Rust_0.2.2_x64_en-US.msi   (47.11 MiB)
src-tauri/target/release/bundle/nsis/AionUi Rust_0.2.2_x64-setup.exe  (34.36 MiB)
src-tauri/target/release/aionui-rust.exe                              (主程序)
src-tauri/target/release/aioncore.exe                                 (sidecar，随包分发)
```

Tauri CLI 打包时自动下载并校验 WiX 3.14 / NSIS 3.13，无需单独安装。

## 5. 目录结构（当前）

```
aionui-rust/
├── README.md, package.json(0.2.2), package-lock.json
├── tsconfig.json, vite.config.ts, uno.config.ts, .gitignore
├── docs/            PLAN / ENV_SETUP / BACKEND_BINARY / IMPLEMENTATION
├── scripts/
│   ├── check-env.mjs / adopt-aioncore.mjs
│   ├── sync-frontend.mjs   (2.2.2 版)
│   └── preview.mjs         (含 2.2.2 __backendStartupBridge 注入)
├── overlays/               (完全重建，无 2.1.1 内容)
│   ├── common/adapter/endpointGate.ts
│   ├── common/platform/index.ts     (Tauri/浏览器版 platform services)
│   ├── renderer/tauri/bootstrap.ts  (bootstrapTauri(mount))
│   └── renderer/types.d.ts
├── public/                 (2.2.2 静态资源)
├── src/                    (1080 文件，全部来自 AionUi main 2.2.2)
├── src-tauri/
│   ├── Cargo.toml / Cargo.lock / build.rs / tauri.conf.json
│   ├── capabilities/default.json, icons/, target/
│   ├── binaries/aioncore-x86_64-pc-windows-msvc.exe + checksums.json
│   └── src/{main.rs, lib.rs, sidecar.rs}
└── dist/                   (前端构建产物)
```

## 6. 关键实现点

### 6.1 端口注入（Tauri 没有 preload）

上游 `main.tsx` 顶层会 `configService.initialize()` 发 HTTP、`browser.ts` 建 WebSocket。
直接 `await invoke('core_endpoint')` 会有竞态。方案：

- `overlays/common/adapter/endpointGate.ts` 在 `globalThis` 上放 Promise 门闩；
- `httpRequest()` / `fetchJson()` / `browser.ts connect()` / `ensureWs()` 全部先 `await waitForBackend()`；
- `bootstrap.ts` 拿到 `core_endpoint` 后 `markBackendReady(base)` 放行，再执行 `root.render(...)`
  （2.2.2 用 `BackendStartupGate` render-prop，故包装整个 render 调用）；
- 注入 `window.electronAPI` 桌面标记 + `__backendStartupBridge = { getState: () => null }`，
  让 2.2.2 的启动门闩直接渲染 App。

### 6.2 Rust 壳

- `sidecar.rs`：解析 `AIONUI_CORE_BIN` → bundled `aioncore-<triple>.exe` → `src-tauri/binaries/`；
  随机端口；`--local --host 127.0.0.1 --port --data-dir --work-dir --log-dir
  --app-version --log-level --parent-pid`；裸 TCP 探 `GET /health` 200（30s 超时）；
  退出 `kill + wait`；`CREATE_NO_WINDOW` 隐藏控制台。
- `lib.rs`：`core_endpoint` 命令用 `Condvar` 阻塞直到 sidecar 就绪；
  `CoreCleanup` 作为 Tauri Resource 在 Drop 时停子进程；Windows 注册 `single-instance`。
- 打包后 Tauri 自动把 `aioncore-<triple>.exe` 放到主程序同目录，Rust 侧按 `current_exe()` 解析。
- 实测 `--app-version 0.2.2` 正确传给后端。

### 6.3 2.2.2 结构差异适配

| 变化 | 处理 |
|---|---|
| `renderer/main.tsx` 改用 `BackendStartupGate` | `bootstrapTauri(() => root.render(...))` + 注入 startup bridge |
| `@office-ai/platform` → 内部 `common/platform/bridge.ts` | 移除旧依赖；补 `overlays/common/platform/index.ts` 浏览器版 services |
| Sentry 引用 1→3 处 | 顶部 import 删除、完整性诊断 no-op、feedback 本地 stub（含 `getClient().flush()`） |
| `httpBridge` 改走 `sendHttpRequest()` + 401 刷新 | 门闩插在 `httpRequest` 入口 |
| 新增依赖（`@iconify/react` / `wavedrom` / `json5` / `rehype-sanitize` / `@codemirror/*` / `postcss` / `buffer` / `process` 等） | package.json 按 2.2.2 重建 |
| `__APP_VERSION__` / `__IS_DISCONTINUED_BUILD__` | vite define + ambient 声明 |
| `WebviewHost` 用 `canGoBack` / `getWebContentsId` 等 | ambient 类型补全 |
| 上游 `normalizeToolCall.test.ts`（vitest） | tsconfig exclude 测试文件 |

## 7. 运行方式

```bash
# 开发（不需要 Rust 工具链）
npm run preview                     # 起 sidecar + http://127.0.0.1:1420

# Tauri 开发 / 打包
npm run tauri dev
npm run tauri -- build              # 产出 MSI + NSIS
```

## 8. 已知限制

- 主 chunk 8.2 MB（2.2.2 依赖更重），未做 `manualChunks` 拆分
- `preview.mjs` 不反代 WebSocket `/ws`；Tauri 里前端直连 sidecar，不受影响
- Sentry / 反馈上报为 no-op；托盘、自动更新、pet 多窗口、WebUI 远程未实现
- **决策：不引入 `managed-resources/`**。用户成品目录只有 `aioncore.exe`；
  `tauri.conf.json` 未声明 `bundle.resources`，`src-tauri/binaries/` 只有 exe + `checksums.json`。
  Rust 壳检测不到 `managed-resources/manifest.json`，因此不传
  `--managed-resources-mode bundled`，后端走默认 `download`（首次启动按需从
  nodejs.org 拉 Node 24.11.0 到 `{data_dir}/runtime/node`，本机已实测成功 104 MB）。
  该行为可接受：离线时只产生 `WARN BOOTSTRAP_DEGRADED_MANAGED_RUNTIME_PREPARE`，
  `/health` 与全部 HTTP 仍 200；外部 CLI Agent 走 PATH，不受影响。
  安装包保持 34/47 MiB，不增加约 104 MB 体积。
- 未做移动端（Tauri sidecar 在 iOS/Android 不支持）
- 后端日志里可见 `managed node runtime validation failed before install` 警告，
  属 `download` 模式首次启动的预期行为（本机后续已下载成功），非故障

## 9. 结论

**P0–P5 全部完成，无待办阻塞项。** 工程可运行、可打包、版本三方对齐
（AionUi 2.2.2 → aioncore v0.2.2 → app 0.2.2），并已实测窗口、sidecar 生命周期、
HTTP 契约与退出清理。

**已确认不做**：不引入 `managed-resources/`（保持默认 `download` 模式，安装包维持 34/47 MiB）。
登录保持默认免登录（未加开关），Node.js 策略「按现状保持」，均按用户决定未改动。
