# Aibaton

Aibaton 是一款桌面 AI 工作台：把多个 AI Agent（Claude Code、Codex、Aion CLI、Copilot 等）
组织到同一个界面里，提供对话、助手、定时任务、团队协作、文件预览与设置能力。

应用由三层组成：

| 层 | 技术 | 职责 |
|---|---|---|
| 界面 | React 19 + TypeScript + Arco Design + UnoCSS（AionUi `main`/2.2.2 前端） | 全部用户可见 UI、i18n（13 语言）、主题、预览器 |
| 桌面壳 | Tauri 2（Rust） | 窗口、系统对话框、拖入文件、安装/卸载，以及启动/停止后端进程 |
| 后端 | AionCore v0.2.2（预编译 Rust 二进制 `aioncore`） | REST API、WebSocket、SQLite 数据、Agent 编排、MCP/ACP、定时任务 |

界面通过 `http://127.0.0.1:<随机端口>` 与后端通信；桌面壳只负责把后端拉起来并把端口交给界面。

## 项目结构

```
AIBaton/
├── src/                     应用前端源码（AionUi 2.2.2 一次性复制 + Tauri 适配补丁）
│   ├── renderer/            React 界面：页面、组件、hooks、服务、样式、i18n、静态资源
│   └── common/              界面与后端之间的共享层：HTTP/WS 桥、配置、类型、主题、工具
│
├── overlays/                Tauri 专有适配文件（每次同步前端时覆盖写回 src/）
│   ├── common/              endpoint 就绪门闩、Electron IPC 兜底、平台服务 stub
│   └── renderer/            Tauri 启动引导、原生能力、关于页数据目录、类型声明
│
├── src-tauri/               Tauri 2 桌面壳（Rust）
│   ├── src/                 main / lib / sidecar 生命周期管理
│   ├── capabilities/        窗口、对话框、拖拽等 Tauri 权限声明
│   ├── icons/               Aibaton 品牌图标（ICO + PNG）
│   ├── nsis/                Windows 卸载程序的文案与确认钩子
│   ├── binaries/            后端成品的校验记录（二进制本身不入库）
│   ├── tauri.conf.json      产品名、包名、窗口、打包配置
│   └── Cargo.toml / Cargo.lock / build.rs
│
├── public/                  静态资源：PWA 图标、Web App Manifest、桌宠动画
├── scripts/                 工程脚本：前端同步、品牌替换、图标生成、后端成品接纳、环境自检、本地预览
├── docs/                    设计与实现记录文档
│
├── package.json / package-lock.json      前端依赖与命令
├── tsconfig.json            TypeScript 配置
├── vite.config.ts           前端构建配置（别名、UnoCSS、编译期常量）
├── uno.config.ts            语义化设计 Token 与 UnoCSS 规则
├── .gitignore               排除依赖、构建产物、后端二进制与本地运行数据
├── LICENSE                  Apache-2.0
└── THIRD-PARTY-NOTICES.md   上游组件、许可与 SHA256 记录
```

## 各部分作用

### `src/renderer/` — 界面

| 目录 | 作用 |
|---|---|
| `pages/` | 会话、设置、助手、定时任务、团队、预览、工作台等业务页面 |
| `components/` | 布局、消息渲染、Markdown、对话框、Agent 选择器等通用组件 |
| `hooks/` | 会话、主题、字体、Agent、MCP、文件等状态逻辑 |
| `services/` | i18n（13 语言）、文件服务、反馈、语音等运行时服务 |
| `styles/` | 全局样式、Arco 覆盖、主题 CSS、设计 Token |
| `assets/` | 品牌 Logo、Agent / 渠道图标 |
| `utils/` | 格式化、模型能力、文件类型、导航等纯函数 |
| `theme/` | 内置浅色/深色主题定义 |
| `api/` | 少量前端侧 API 客户端封装 |
| `tauri/` | Tauri 启动引导与原生能力（由 `overlays/` 注入） |
| `pet/` | 桌宠相关渲染入口（当前桌面构建未启用） |
| `index.html` / `main.tsx` | 应用入口 |

### `src/common/` — 共享层

| 目录 | 作用 |
|---|---|
| `adapter/` | `httpBridge` / `ipcBridge`：把界面调用映射到后端 REST 与 WebSocket |
| `config/` | 客户端配置、存储键、i18n 配置、常量 |
| `types/` | Agent、会话、团队、平台、Provider 等共享类型 |
| `api/` | Provider 客户端与协议转换（部分仅后端参考用） |
| `chat/` | 消息、工具调用、斜杠命令、文档转换等会话数据模型 |
| `theme/` | 主题解析与 Token 契约 |
| `platform/` | 平台服务抽象与 bridge 实现 |
| `update/` `utils/` | 更新类型、通用工具 |

### `src-tauri/` — 桌面壳

| 文件/目录 | 作用 |
|---|---|
| `src/main.rs` | 进程入口 |
| `src/lib.rs` | Tauri 应用构建、`core_endpoint` / `get_data_dir` 命令、单实例、退出清理 |
| `src/sidecar.rs` | 定位 `aioncore`、分配随机端口、传参启动、等待 `/health`、停止子进程 |
| `capabilities/default.json` | 允许窗口控制、原生对话框、拖拽、事件监听等权限 |
| `tauri.conf.json` | `productName = Aibaton`、`identifier = com.aibaton.desktop`、外部二进制、NSIS 配置、图标 |
| `icons/` | 窗口/任务栏/安装包/页面 favicon 使用的品牌图标 |
| `nsis/` | 卸载时「删除应用数据」的显眼文案与二次确认 |
| `binaries/checksums.json` | 记录所接纳后端成品的版本、SHA256、来源，便于复现 |

### `overlays/` — 为什么单独存在

`src/` 是从上游 AionUi 一次性复制的，重新同步时会被整体覆盖。`overlays/` 保存
本工程独有的 Tauri 适配代码，同步脚本最后再把它拷回 `src/`，保证补丁幂等。

| 文件 | 作用 |
|---|---|
| `common/adapter/endpointGate.ts` | 后端端口就绪前拦住所有 HTTP/WS 请求，避免竞态 |
| `common/adapter/ipcStub.ts` | 给已无 Electron 提供者的 IPC 通道返回安全默认值 |
| `common/platform/index.ts` | 浏览器/Tauri 版平台服务实现 |
| `renderer/tauri/bootstrap.ts` | 注入桌面标记、等待 `core_endpoint`、再挂载 React |
| `renderer/tauri/capabilities.ts` | 原生文件对话框、窗口控制、拖入文件路径桥 |
| `renderer/components/settings/.../DataDirRow.tsx` | 关于页显示数据目录并提供复制/打开 |
| `renderer/types.d.ts` | Electron 类型与编译期常量的环境声明 |

### `scripts/` — 工程脚本

| 脚本 | 作用 |
|---|---|
| `sync-frontend.mjs` | 从 `../AionUi` 全量同步前端并应用 Tauri 补丁 |
| `rebrand.mjs` | 把用户可见文案/品牌替换为 Aibaton（保留上游版权头） |
| `generate-icons.mjs` | 生成全套品牌图标（PNG + 7 帧 ICO，零外部依赖） |
| `adopt-aioncore.mjs` | 接纳本地提供的 `aioncore.exe`：校验哈希、冒烟、按平台改名 |
| `check-env.mjs` | 检查 Node / Rust / MSVC / WebView2 / 网络 / 磁盘环境 |
| `preview.mjs` | 不依赖 Rust 工具链的本地联调预览（起后端 + 静态服务 + 反代） |

### `docs/` — 文档

按主题记录：落地方案、环境、实现状态、二进制策略、品牌化、图标、登录修复、
原生能力、Node 运行时目录、审计清单、待决策记录。

### 启动画面

`public/boot-splash.css` 由 `index.html` 在首帧引用，在 8 MB 前端 bundle 解析前显示深蓝科技感加载动画（透视网格、脉冲环、轨道节点、扫描线、进度条）；React 挂载后由 `src/renderer/tauri/bootstrap.ts` 淡出移除。

### `public/` — 静态资源

`pwa/` 为页面图标，`pet-states/` 为桌宠动画素材，`manifest.webmanifest` 与 `sw.js`
为上游保留的 PWA 文件（桌面构建已不注册 Service Worker）。

## 运行时数据位置

后端把数据库、日志、工作区以及按需下载的 Node.js 运行时放在
`%APPDATA%\com.aibaton.desktop\`。关于页会显示该路径并提供一键打开。

## 许可与来源

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

