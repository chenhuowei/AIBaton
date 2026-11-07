# Tauri 原生能力补齐 + 默认暗黑模式

> 2026-11-07。用户要求：接 Tauri 的 dialog / drag-drop / 窗口控制补齐上游残留的
> Electron 能力；默认暗黑模式。**Aion CLI 开关需求在后续消息中被移除，未实现。**
> 已完成并重新打包（0.2.2）。

## 1. 补齐的三类能力

上游 `ipcBridge.ts` 里有一批 `bridge.buildProvider(...)` 通道是 **Electron main 进程
专属**，在 Tauri 里没有 provider。之前 `browser.ts` 被强制走 WebSocket adapter 后，
这些 `invoke()` 会**永久挂起**（`bridge.invoke` 等一个永不回来的 callback）。

| 能力 | 原来 | 现在 |
|---|---|---|
| **dialog.showOpen** | Electron `show-open` IPC；之前退化为后端 `WebFsPicker` | `@tauri-apps/plugin-dialog` 的 `open()`，返回本机绝对路径 |
| **windowControls** | 6 个 `bridge.buildProvider/Emitter`，全部挂起 | `@tauri-apps/api/window` 的 `getCurrentWindow()`：minimize / maximize / unmaximize / close / isMaximized；`onResized` → `maximizedChanged` 监听 |
| **drag-drop 路径** | `window.electronAPI.getPathForFile`（Electron `webUtils`）未实现，拖入文件拿不到绝对路径 | `getCurrentWebview().onDragDropEvent()` 缓存 `paths`，按文件名匹配暴露 `getPathForFile(file)`；`FileService.ts` / `ExplorerPanel.tsx` 无需改动 |

实现文件：`overlays/renderer/tauri/capabilities.ts`（新增），由
`overlays/renderer/tauri/bootstrap.ts` 在启动时调用 `installDragDropPathBridge()` +
`installWindowStateBridge()`。

`sync-frontend.mjs` 的补丁 `2d3` 把 `ipcBridge.dialog` 和 `ipcBridge.windowControls`
整块替换为上述实现，并注入 import。

### capabilities 权限

`src-tauri/capabilities/default.json` 新增：
`core:window:allow-maximize` / `allow-unmaximize` / `allow-show` /
`allow-toggle-maximize` / `allow-is-maximized` / `allow-minimize` / `allow-close` /
`core:event:allow-listen` / `dialog:allow-open` / `opener:default` 等（共 14 项，已去重）。

> 期间踩过一个坑：`core:window:allow-on-resized` 不是合法权限名，Tauri build 直接报错。
> 事件监听走 `core:event:allow-listen`，已修正。

## 2. 默认暗黑模式

| 位置 | 改动 |
|---|---|
| `renderer/hooks/system/useTheme.ts` | `getPersistedActiveId()` 无配置时返回 `DARK_THEME_ID`（原 `LIGHT_THEME_ID`）；异常 fallback 也用 dark |
| `renderer/index.html` | `<html data-theme="dark">`；两段 inline script 在首屏把 `data-theme` / `arco-theme` 设为 `localStorage.__aionui_theme || 'dark'`，避免白闪 |

**用户仍可在「设置 → 外观」切换到浅色 / 跟随系统**，选择会通过 `configService`
持久化到 `theme.activeId`，之后以用户选择为准（不会每次启动强制回暗黑）。

## 3. 验证（CDP 实测，干净 WebView2 profile）

```
url                     http://tauri.localhost/#/guid
htmlTheme               dark
bodyTheme               dark
localStorageTheme       dark
electronAPI             true
getPathForFile          function          ← drag-drop 桥已装
gateReady               true
hasLoginPage            false
rootChildren            1
windowControlsPresent   true              ← 窗口控制按钮已渲染（之前会隐藏）
isMaximized             false             ← Tauri window API 可用
minimize                ok
show                    ok
```

`dialog:allow-open` 已配置；实测调用 `plugin:dialog|open` 会弹出原生模态窗
（若被 ACL 拒绝会立即返回 permission error，所以超时挂起反而证明权限通过）。

## 4. 未做（范围外 / 用户撤回）

- **Aion CLI 开关**：用户在后续消息中移除了该需求，未实现。后端
  `PATCH /api/agents/{id}/enabled` 与设置页 `LocalAgents.tsx` 的开关本来就能用。
- 自动更新、托盘、pet 多窗口、反馈截图、CDP/GPU 设置、开机自启等其它 Electron-only
  通道仍走 `bridge.buildProvider`，在 Tauri 里会挂起；但常规聊天/设置流程不触发它们。
- 窗口最大化状态用 `onResized` 粗粒度通知（每次 resize 查一次 `isMaximized`），
  未做去抖。

## 5. 重新打包

前端与 capabilities 均变更，已 `cargo clean -p aionui-rust` 后重新
`npm run tauri -- build`（资源是编译期嵌入的，只跑 vite build 不够）：

```
AionUi Rust_0.2.2_x64_en-US.msi    47.13 MiB
AionUi Rust_0.2.2_x64-setup.exe   34.42 MiB
```
