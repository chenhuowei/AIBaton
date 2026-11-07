# 待审核清单：品牌化 + 卸载清理 + 代码审计

> 2026-11-07。用户提出 4 项需求。**本轮只调研，未改动任何代码/产物**；
> 第 4 项按用户要求先出清单供审核，不擅自实施。
> 当前 0.2.2 安装包与源码保持不变。

## 总览

| # | 需求 | 可行性 | 风险 |
|---|---|---|---|
| 1 | NSIS 卸载默认勾选「Delete the application data」 | ✅ 可用 `installerHooks` 实现 | 低（只影响卸载确认页默认值） |
| 2 | 关于页显示 data 路径 + 一键打开 | ✅ 可用 `@tauri-apps/plugin-opener` 或 `/api/shell/open-folder-with` | 低 |
| 3 | 改名 `aibaton`，去掉所有 AionUi 标识 | ⚠️ 可行但**改 identifier 会让现有用户的数据库"消失"** | **高** |
| 4 | 检查多余/缺失功能 | 已出清单，见 §4 | 待用户挑选 |

---

## 1. NSIS 默认勾选删除数据

### 现状（读的是已生成的 `installer.nsi`）

```
English.nsh:27   LangString deleteAppData "Delete the application data"
installer.nsi:433 un.ConfirmShow  创建复选框（CreateWindowEx，无 BST_CHECKED）
installer.nsi:464 un.ConfirmLeave BM_GETCHECK → $DeleteAppDataCheckboxState
installer.nsi:838 ${If} $DeleteAppDataCheckboxState = 1
                    RmDir /r "$APPDATA\${BUNDLEID}"
                    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
```

- 复选框**默认未勾选**；升级时（`UpdateMode=1`）一律不删
- MSI 卸载**完全没有**这段逻辑，删不了 AppData

### 实现方案

Tauri CLI 2.12.3 的 `config.schema.json` 支持 `bundle.nsis.installerHooks`
（指向 `.nsi` hook 文件）和 `customLanguageFiles`。

写一个 `src-tauri/nsis/uninstall-hook.nsi`：

```nsis
!macro NSIS_HOOK_PREUNINSTALL
  ; 无操作（钩子在 confirm 页之前，复选框还没创建）
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
```

但**复选框是在 `un.ConfirmShow` 里创建的，钩子无法直接拿到 HWND**。
更稳的做法是用 `customLanguageFiles` 也做不到（只能改文案）。

**推荐做法**：不用 hook，改用 Tauri 的 NSIS template 覆盖，或
在 `tauri.conf.json` 里通过 `installerHooks` 注入一段：
在 `un.ConfirmShow` 之后用 `BM_SETCHECK` 勾选。需要验证 hook 宏的注入点。

> 更简单且零风险的替代：**在卸载确认页把文案改明确**（`customLanguageFiles`
> 把 "Delete the application data" 改成 "⚠ 删除应用数据（含对话记录与 104MB Node，默认建议勾选）"），
> 但不改变默认行为，由用户自己勾。

**待确认**：要「真的默认勾选」还是「只把文案写清楚」？

---

## 2. 关于页显示 data 路径 + 一键打开

### 现状

- `/api/system/info` 已返回 `{ cache_dir, work_dir, log_dir }`（`ipcBridge.application.systemInfo`）
  但这些是后端环境变量推导值，**不等于** Tauri 的 `app_data_dir()`（后者才是 Node/DB 实际所在）
- `AboutModalContent.tsx` 当前只有版本号 + 官网/GitHub/Wiki 链接，全带 AionUi 品牌
- Tauri 侧可加一个 `#[tauri::command] get_data_dir()` 返回 `app.path().app_data_dir()`
- 一键打开可用 `@tauri-apps/plugin-opener` 的 `revealItemInDir`，或后端
  `/api/shell/open-folder-with`（`ipcBridge.shell.openFolderWith`，已存在 HTTP 路由）

### 实现

1. Rust：`get_data_dir` command
2. 前端：关于页新增一行「数据目录: `<path>`」+ 复制按钮 + 「打开文件夹」按钮
3. i18n：新增 key（8+ 语言，按项目约定）
4. 注意：`openFolderWith` 的 `tool` 参数在 Windows 用 `'explorer'`

---

## 3. 重命名为 `aibaton`（自主品牌）⚠️ 高风险

### 3.1 需要改的位置（全量）

| 类别 | 位置 | 数量 |
|---|---|---|
| npm 包名 / 描述 | `package.json` `name` / `description` | 2 |
| Rust crate / lib 名 | `src-tauri/Cargo.toml` `name` / `[lib].name` | 2 |
| 主程序名 | `tauri.conf.json` `mainBinaryName` / `productName` / 窗口 `title` / `shortDescription` | 4 |
| **identifier（包名）** | `tauri.conf.json` `identifier`: `com.aionui.rust.desktop` → 如 `com.aibaton.desktop` | 1 |
| 窗口标题 / HTML | `src/renderer/index.html` `<title>`、`application-name`、`apple-mobile-web-app-title` | 3 |
| PWA manifest | `public/manifest.webmanifest` `name` / `short_name` / `description` | 3 |
| Service Worker | `public/sw.js` `CACHE_NAME = 'aionui-webui-v2'` | 1 |
| 关于页 | `AboutModalContent.tsx`：标题 `AionUi`、官网 `aionui.com`、GitHub `iOfficeAI/AionUi`、Wiki、Releases、Twitter `@WailiVery` | ~8 |
| **i18n 文案** | `src/renderer/services/i18n/locales/**`：**91 个 JSON 文件、1063 处 "AionUi"** | 1063 |
| 图标 | `src-tauri/icons/*`、`public/pwa/*`、`src/renderer/assets/logos/brand/app.png` | 需新品牌图 |
| 内部 CSS/存储 key | `__aionui_theme`、`__aionui_colorScheme`、`aionui:*`、`process.env.AIONUI_*` | 若干 |
| 文档 | `README.md` / `docs/*.md`（本工程的说明文档） | 多个 |
| 目录名 | `D:\workspace\rea\aionui\aionui-rust`（工程目录，可保留也可改） | 1 |

### 3.2 ⚠️ 改 identifier 的严重后果

`app.path().app_data_dir()` 由 identifier 决定。当前：

```
C:\Users\howay\AppData\Roaming\com.aionui.rust.desktop\
  ├── aionui-backend.db        ← 所有历史对话
  ├── runtime/node/...          ← 104 MB Node
  └── logs/ work/ builtin-skills/
```

改成 `com.aibaton.desktop` 后，新程序会去读**另一个空目录**：

- ✅ 不会出现崩溃
- ❌ **现有用户的历史对话、设置、已下载的 Node 全部"消失"**（其实还在旧目录）
- ❌ 旧版与新版的 NSIS 卸载项/注册表键不同，可能被识别为两个独立应用，卸载清理也只对各自生效
- ❌ 需要重新下载 104 MB Node

**可选处理**：

| 方案 | 说明 |
|---|---|
| **3A 直接改** | 接受"全新应用、旧数据不迁移"，最干净；建议同时提供一次性迁移脚本/提示 |
| **3B 改品牌但保留 identifier** | 产品名/图标/文案全改 `aibaton`，但 identifier 仍是 `com.aionui.rust.desktop`。**数据不丢**，但注册表/数据目录里仍有 `aionui` 字符串（用户要求"不能有 aionui 标识"就不完全满足） |
| **3C 改 identifier + 自动迁移** | Rust 启动时检测旧目录存在且新目录为空 → 复制/移动过去；最稳妥但要多写迁移逻辑 + 处理失败回滚 |

### 3.3 上游许可注意

前端来自 AionUi（Apache-2.0），改品牌允许，但**需保留版权声明与 LICENSE/NOTICE**，
不能删除 `Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0` 这类头部注释。
"不能有 aionui 标识"若连 LICENSE/版权头都要去掉，会**违反 Apache-2.0 §4**。
建议：用户可见 UI 全改，代码版权头与 THIRD-PARTY-NOTICES 保留。

**待确认**：选 3A / 3B / 3C？以及版权头是否保留？

---

## 4. 代码审计：多余 / 缺失功能清单（供审核）

### 4.1 文件级对比（上游 AionUi main 1080 文件 vs 本工程 1077 文件）

**缺失（6 个，全部是 Electron 主进程专属，属"有意移除"）**：

```
common/adapter/main.ts                       ← Electron ipcMain provider 注册
common/electronSafe.ts                       ← Electron 模块 null-safe shim
common/platform/ElectronPlatformServices.ts  ← electron.app / utilityProcess 实现
common/platform/IPlatformServices.ts         ← 平台服务接口（渲染层不引用）
common/platform/NodePlatformServices.ts      ← Node 版平台服务
common/platform/register-electron.ts         ← 注册 Electron 平台服务
```

> 另：`overlays/common/platform/index.ts` 提供了浏览器版 stub 顶替 `index.ts`。
> **结论：没有丢失任何渲染层/业务功能文件。**

**额外（3 个，本工程新增）**：

```
common/adapter/endpointGate.ts       ← endpoint 就绪门闩
renderer/tauri/bootstrap.ts          ← Tauri bootstrap
renderer/tauri/capabilities.ts       ← dialog/window/drag-drop 原生适配
```

### 4.2 仍残留在 `ipcBridge.ts` 的 Electron IPC 通道（35 个，Tauri 里调用会挂起）

| 分组 | 通道 | 影响 | 建议 |
|---|---|---|---|
| **窗口/应用** | `restart-app`、`app.get-path`、`app.get-zoom-factor`、`app.set-zoom-factor`、`open-dev-tools`、`is-dev-tools-opened`、`app.devtools-state-changed`、`app.write-renderer-log` | 字体缩放设置会挂起；devtools/重启不可用 | **优先级高**：`setZoomFactor` 被 `useFontScale.ts` 调用，应改 Tauri webview zoom |
| **主题** | `theme:changed`、`theme:set-active`、`theme:request-current` | 已用 applyTheme 本地处理，不挂起 | 可 stub 掉避免误用 |
| **弹窗/选择器** | `show-open`、`skills.files.list` | `show-open` 已被 dialog 替换；`skills.files.list` 需确认调用点 | 低 |
| **通知** | `notification.show`、`notification.clicked` | 1 处 UI 调用（WebUI 通知） | 可接 Tauri notification 插件 |
| **系统设置** | `system-settings:get/set-close-to-tray`、8 个 `*-pet-*` | 托盘/桌宠多窗口，本期明确不做 | **可整块删除或返回安全默认值** |
| **自动更新** | `update.open`、6 个 `update.download.*`、`auto-update.*` | 更新检查页会挂起 | **优先级中**：Tauri updater 或明确禁用/隐藏入口 |
| **WebUI 远程** | `webui.get-status`、`webui.start`、`webui.stop`、`webui.statusChanged` | 设置页「远程连接」显示"启动中…"（实测 DOM 里就卡在这） | **优先级中**：本期不做 WebUI，建议隐藏该入口 |

### 4.3 明确「多余」的代码/资源

| 项 | 说明 |
|---|---|
| `src/renderer/services/registerPwa.ts` + `public/sw.js` + `public/manifest.webmanifest` + `public/pwa/*` | 桌面 Tauri 用不到 PWA/Service Worker；而且上一轮已证实 **SW 缓存旧 HTML 导致误弹登录页**。建议移除注册与资源 |
| `src/renderer/pages/login/**` + `login.json` × 13 语言 | `--local` 模式永远不显示登录页；但删了会影响未来「可选登录」，建议保留代码、仅隐藏 |
| `registerWebFsPicker.ts` / `webFsPicker.tsx` | 已改用 Tauri 原生 dialog，这两个纯属冗余（但 preview 纯浏览器模式还需要） |
| `WebviewHost.tsx` 的 `<webview>` 路径 | Electron `<webview>` 在 Tauri/WebView2 不存在，走 iframe 降级；可简化 |
| 反馈上报 / Sentry stub | 已 no-op，属死代码 |
| 91 个 i18n 文件里 1063 处 `AionUi` | 品牌化时统一处理 |
| `docs/` 里 6 个 md | 属工程文档，可保留 |

### 4.4 建议的处理顺序（待用户勾选）

```
[ ] A. 移除 Service Worker / PWA 注册（解决缓存旧页面问题，降低误弹登录复发风险）
[ ] B. 把 35 个 IPC 通道按分组处理：字体缩放→Tauri webview zoom；其余→stub 或隐藏 UI 入口
[ ] C. 隐藏/禁用「远程连接 WebUI」设置入口（本期不做）
[ ] D. 隐藏/禁用自动更新入口（或接 tauri-plugin-updater）
[ ] E. 删除 pet / 托盘相关死代码
[ ] F. 品牌化 i18n 全量替换（随 #3 一起做）
```

---

## 5. 请用户确认

1. **第 1 项**：默认勾选删除数据（需 NSIS hook/template）？还是只把文案写清楚？
2. **第 2 项**：路径显示 + 一键打开，用 Tauri opener 还是后端 `/api/shell/open-folder-with`？（推荐前者）
3. **第 3 项**：3A 直接改 / 3B 保留 identifier / 3C 自动迁移？版权头是否保留？
   另请给出：`aibaton` 的大小写（`Aibaton`? `aiBaton`? `AIBaton`?）、新官网/仓库地址（替换 aionui.com / GitHub 链接）、是否提供新图标。
4. **第 4 项**：从 §4.4 的 A–F 里勾选要做的，我再实施。

> 在确认前不动代码，已验证的 0.2.2 安装包保持原样。
