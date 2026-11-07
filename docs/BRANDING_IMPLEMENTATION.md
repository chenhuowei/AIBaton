# Aibaton 品牌化与代码清理（2026-11-07）

> 用户确认：① NSIS 默认**不勾选**，但要有显眼的勾选与提示；② 关于页显示路径 +
> 一键打开（用 Tauri opener）；③ 品牌改为 **Aibaton**，方案 **3A**（直接改，含
> identifier，数据不迁移）；④ 审计项 **A–F 全做**。
> 已完成、验证并重新打包。

## 1. NSIS 卸载数据清理（默认不勾 + 显眼提示）

| 位置 | 改动 |
|---|---|
| `src-tauri/nsis/English.nsh` | `deleteAppData` 文案改为 `DELETE ALL APP DATA — chat history, settings and the downloaded Node.js runtime (~104 MB). This cannot be undone!` |
| `src-tauri/nsis/hooks.nsh` | `NSIS_HOOK_PREUNINSTALL`：勾选时弹 **MB_ICONEXCLAMATION + YES/NO（默认 NO）** 二次警告，选 NO 则把状态改回 0 不删；未勾选时弹信息框说明数据保留位置 |
| `tauri.conf.json` → `bundle.windows.nsis` | `languages: ["English"]` + `customLanguageFiles` + `installerHooks` |

- 复选框本身**仍默认不勾**（Tauri 生成的 `un.ConfirmShow` 无 `BST_CHECKED`），符合用户要求
- 生成的 `installer.nsi` 已确认 include 了 hooks，宏在编译期展开
- 踩坑：从生成的 `English.nsh` 复制时带 UTF-8 BOM，makensis 报 `Invalid command: "\ufeffLangString"`，已去 BOM
- 踩坑：`nsis` 配置必须放 `bundle.windows.nsis`，放 `bundle.nsis` 会报 unknown field
- MSI 卸载无此逻辑（Tauri 原生行为，未改）

## 2. 关于页：数据目录 + 一键打开

- Rust `src-tauri/src/lib.rs` 新增 `#[tauri::command] get_data_dir()` 返回 `app.path().app_data_dir()`
- `overlays/renderer/components/settings/SettingsModal/contents/DataDirRow.tsx`：
  显示路径、复制按钮、`openPath(dir)`（`@tauri-apps/plugin-opener`）打开文件夹
- `scripts/rebrand.mjs` 把 `<DataDirRow />` 注入 `AboutModalContent.tsx`

CDP 实测关于页：`Data directory` / `com.aibaton.desktop` / `Open` 全部出现。

## 3. 品牌化 Aibaton（3A）

### 改动范围

| 类别 | 内容 |
|---|---|
| `package.json` | `name: aibaton`，描述改为 Aibaton |
| `src-tauri/Cargo.toml` | crate `aibaton`，lib `aibaton_lib` |
| `src-tauri/src/main.rs` | `aibaton_lib::run()` |
| `tauri.conf.json` | `productName/mainBinaryName/window.title = Aibaton`，`identifier = com.aibaton.desktop`，`shortDescription` |
| exe / 安装包 | `aibaton.exe`、`Aibaton_0.2.2_x64-setup.exe`、`Aibaton_0.2.2_x64_en-US.msi` |
| `index.html` / `manifest.webmanifest` / `sw.js` | 标题、应用名、缓存名 |
| 前端硬编码 | `DocumentTitle`、`Layout` 侧栏 wordmark、`Titlebar`、`ClientFactory` 的 `X-Title`、通知标题、channels 描述、`TestShowcase` 等 |
| **i18n** | 13 语言 / 91 文件 / **1063 处** `AionUi` → `Aibaton`（`scripts/rebrand.mjs` 全量处理） |
| `AboutModalContent` | 标题 `Aibaton` |

### 保留（合规与数据格式）

- **Apache-2.0 §4**：所有 `Copyright 2025 AionUi (aionui.com)` 版权头原样保留
  （实测 **559 处**未被误改；第一次 rebrand 曾误改，已通过全量重同步修正）
- 上游 GitHub/wiki/releases URL 与 `aionui.com` 域名保留为归属链接
- 内部标识不改：`__aionui_theme`、`AIONUI_*` env、`aionui:` 存储键、`aioncore`、`AionCore`、
  `Aion CLI`、`AionUi Image Generation`（历史数据匹配常量）
- 图标暂沿用上游资源（用户未提供新图）

### 3A 的已知后果

`identifier` 从 `com.aionui.rust.desktop` 改为 `com.aibaton.desktop`，
数据目录变为 `%APPDATA%\com.aibaton.desktop`。**旧目录里的对话/Node 不自动迁移**，
新装相当于全新应用，Node 会重新下载（约 104 MB）。用户已确认接受。

## 4. 审计 A–F 全做

| 项 | 实现 |
|---|---|
| **A 移除 PWA/SW** | `main.tsx` 不再 `void registerPwa()`；CDP 实测 `serviceWorker.controller = false`，从根上避免旧 HTML 缓存导致误弹登录 |
| **B IPC 通道 stub** | 新增 `overlays/common/adapter/ipcStub.ts`：对 35 个 Electron-only 通道逐一 `bridge.buildProvider(name).provider()` 返回安全默认值，消除永久挂起；`app.set-zoom-factor` 接到 Tauri `getCurrentWebview().setZoom()` |
| **C 隐藏 WebUI 远程** | `SettingsModal` 的 webui tab、独立设置页 `SettingsSider` / `SettingsPageWrapper` 的 webui 项全部过滤 |
| **D 隐藏自动更新** | `AboutModalContent` 更新块改 `false && isElectron`；相关 IPC 由 B 兜底 |
| **E 隐藏桌宠** | `SettingsSider` / `SettingsPageWrapper` 过滤 `pet`；pet 相关 IPC 由 B 兜底 |
| **F i18n 品牌替换** | 随 §3 rebrand 完成 |

页面组件保留在 bundle 里（不删除文件），这样 `sync-frontend.mjs` 的上游补丁能持续命中。

## 5. 最终 CDP 验证（release，干净 WebView2 profile）

```
title            Aibaton
theme            dark (html + body)
login            false
gate ready       true
serviceWorker    false
dataDir 显示      true / Open 按钮 true
WebUI tab        false
pet tab          false
自动更新按钮      false
get_data_dir     C:\Users\howay\AppData\Roaming\com.aibaton.desktop
```

`typecheck` exit 0、`vite build` exit 0、`tauri build` exit 0。

## 6. 产物

```
src-tauri/target/release/aibaton.exe
src-tauri/target/release/bundle/msi/Aibaton_0.2.2_x64_en-US.msi    47.14 MiB
src-tauri/target/release/bundle/nsis/Aibaton_0.2.2_x64-setup.exe   34.39 MiB
```

旧的 `AionUi Rust_*` 安装包已删除。

## 7. 补丁统计

`scripts/sync-frontend.mjs` 现在共 **26 处补丁**，`scripts/rebrand.mjs` 处理 138 文件；
`npm run sync:frontend` 会串起两者，可重复执行。
