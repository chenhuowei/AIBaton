# 修复记录：启动误弹登录页

> 2026-11-07。用户反馈「打开直接弹出登录提示，没进主界面」。
> **结论：不是用户操作错误，是本工程适配层的 bug，已修复并重新打包。**
> 第 2 项需求（Node.js 策略）用户已明确「不做改动，按现状保持」，未改动。

## 1. 根因

AionUi 2.2.2 有多个模块在**模块顶层**读取 `window.electronAPI` 作为「桌面本地模式」标记：

| 位置 | 用途 |
|---|---|
| `renderer/hooks/context/AuthContext.tsx:52` | `const isDesktopRuntime = Boolean(window.electronAPI)` → `refresh()` 直接 `setStatus('authenticated')`，否则走登录流程 |
| `common/adapter/browser.ts:55` | 选择 Electron IPC adapter 还是 WebSocket adapter |
| `renderer/components/workspace/registerWebFsPicker.ts:16` | 是否注册后端文件选择器 |
| `renderer/services/i18n/index.ts:82` | 语言提示 |
| `renderer/utils/theme/applyTheme.ts:32` | 是否发布主题到 Electron |
| `renderer/components/layout/Sider/index.tsx`、`ipcBridge.ts:790` | 登出入口 / dialog 分支 |

原来的 `overlays/renderer/tauri/bootstrap.ts` 在 `bootstrapTauri()` 里调用
`installDesktopMarker()` 注入 `window.electronAPI`。但 ESM 会**先求值所有 import 的模块，
再执行 main.tsx 的模块体**，所以注入永远晚于上述顶层读取。
结果前端判定为 Web 模式 → `AuthContext` 调 `/api/auth/user` → 显示登录页。

> 之所以之前没发现：P3 验证只检查了「窗口存在 + Responding=True + `/health` 200」，
> **没有检查页面实际渲染的 DOM**。这是验证盲点，已用 CDP 补上。

## 2. 修复（19 处补丁，全部命中）

### 2.1 把标记注入提前到 HTML 同步脚本

`scripts/sync-frontend.mjs` 的新补丁 `2a0` 在 `renderer/index.html` 的 `<head>` 最前面插入
**同步 inline script**（早于 `<script type="module">`）：

```js
if (!window.electronAPI) window.electronAPI = { emit(){}, on(){} };
if (!window.__backendStartupBridge) {
  window.__backendStartupBridge = {
    getState: () => null,                 // BackendStartupGate: null = 就绪
    subscribe: () => () => undefined,
  };
}
if (window.__backendStartupFailure === undefined) window.__backendStartupFailure = null;
```

`overlays/renderer/tauri/bootstrap.ts` 里的 `ensureDesktopMarkers()` 保留为防御性兜底，
但真正生效的是 inline script。

### 2.2 配套修 4 处会因标记而走错分支的代码

提前注入 `electronAPI` 会让部分模块误以为「有 Electron preload」，而 Tauri 没有，所以：

| 补丁 | 文件 | 改动 |
|---|---|---|
| `2d2` | `common/adapter/browser.ts` | `if (win.electronAPI)` → `if (false && win.electronAPI)`，强制走 WebView WebSocket adapter（否则 platform bridge 收不到事件） |
| `2d3` | `common/adapter/ipcBridge.ts` | `isElectronRenderer()` 恒为 `false`，`dialog.showOpen` 始终用后端文件选择器（Electron 的 `show-open` IPC 通道在 Tauri 无 provider，会挂起） |
| `2d4` | `renderer/components/workspace/registerWebFsPicker.ts` | 无条件注册 `showWebFsPicker` |
| `2d5` | `renderer/utils/theme/applyTheme.ts` | `isElectronRenderer()` 恒为 `false`，跳过 `theme:set-active`（该 IPC 通道在 Tauri 无 provider）；本地 CSS 主题照常生效 |

`utils/platform.ts` 的 `openExternalUrl` 走 `ipcBridge.shell.openExternal` →
`/api/shell/open-external`（HTTP，v0.2.2 后端有该路由），**无需修改**，仍可用。

## 3. 验证（这次检查了真实 DOM）

用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` 连 CDP，
执行 `Runtime.evaluate` 读 DOM：

| 检查项 | 修复前 | 修复后（debug + release） |
|---|---|---|
| `window.electronAPI` | `false` | **`true`** |
| `__backendStartupBridge` | `false` | **`true`** |
| endpoint gate ready | `false` | **`true`** |
| `location.href` | `/` | **`http://tauri.localhost/#/guid`** |
| `.login-page` | 用户报告出现 | **`false`** |
| `input[type=password]` | — | **`false`** |
| `#root` 子节点数 | `0` | **`1`** |
| 页面文本 | 空 | 「新会话 / 助手 / 定时任务 / 团队 … Hi，今天有什么安排？」 |

**release 版用干净 WebView2 profile 全新启动同样直接进入主界面**，确认修复进了正式产物。

### 过程中的一个小插曲

第一次 CDP 检查仍显示 `electronAPI:false` / root 空，是因为 `public/sw.js` 注册的
Service Worker 缓存了旧 HTML。清 caches + unregister + 硬重载后即恢复；
**用全新 `WEBVIEW2_USER_DATA_FOLDER` 启动则一次就正确**，证实是缓存而非代码问题。
> 你之前如果已经打开过旧版本，重新安装后可能需要清一次 WebView2 缓存（或直接用全新用户目录）才能看到新页面。

## 4. 重新打包

前端资源变了，必须重新编译 Rust（Tauri 把 `dist/` 在编译期嵌入二进制），
已 `cargo clean -p aionui-rust` 后重新执行：

```
npm run tauri -- build   → exit 0
AionUi Rust_0.2.2_x64_en-US.msi   (47.11 MiB)
AionUi Rust_0.2.2_x64-setup.exe  (34.36 MiB)
```

## 5. 第 2 项需求：按现状保持

用户明确「**2 不做改动了，按现状保持**」。因此：

- `sidecar.rs` 仍不传 `--managed-resources-mode bundled`
- 后端仍走默认 `download`（首次启动按需从 nodejs.org 拉 Node 24.11.0）
- 不引入 `managed-resources/`，安装包体积不变
- 不做任何「提示用户自行安装 Node」的新 UI

`docs/PENDING_DECISIONS.md` 保留为当时的调研记录（含源码依据），但不再有待办。
登录仍为默认免登录（未加开关），与用户「按现状保持」一致。
