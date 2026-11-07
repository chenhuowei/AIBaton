# 待确认：登录可选化 与 Node 运行时策略

> 状态：**调研完成，等待用户确认选项后再改代码**。本轮未改动任何运行代码，
> 已验证的 0.2.2 安装包保持不变。

## 1. 登录「非必要 → 可选」

### 现状（已核实）

`src-tauri/src/sidecar.rs` 始终传 `--local`。
AionCore `crates/aionui-app/src/bootstrap/environment.rs:69-85`：
`--local` 会把 `identity_mode` 强制设为 `IdentityMode::Local`，`auth = disabled`，
注入 `system_default_user`，并跳过 JWT/CSRF。

前端 `src/renderer/hooks/context/AuthContext.tsx:50`：
`isDesktopRuntime = Boolean(window.electronAPI)`；我们的
`overlays/renderer/tauri/bootstrap.ts:35-37` 无条件注入了 `window.electronAPI`，
因此 `refresh()` 直接 `setStatus('authenticated')`，**登录页从不显示**，登出入口也被隐藏。

→ 换句话说：**当前已经是「登录非必要 / 默认关闭」**。「改为可选」的落地方式待定。

### 可选项

| 选项 | 做法 | 代价 |
|---|---|---|
| **1A 仅明确** | 保持现状；在关于页/设置里标注「登录：可选，当前关闭（本地模式）」 | 零风险，无行为变化 |
| **1B 加开关（推荐）** | 加配置项 `AIONUI_REQUIRE_LOGIN=1`（或设置页开关）：壳层不传 `--local`、不注入 `electronAPI` 标记 → 后端启用鉴权、前端显示登录页 | 需重启 sidecar 才生效；首次启用要先用 `aioncore user set-password` 设管理员密码（`cli.rs` 有该子命令）；中等工作量 |
| 1C 默认需要登录 | 反转默认值 | 与「非必要」语义冲突，不推荐 |

## 2. Node.js 运行时：download vs 提示用户自装

### 关键约束（必须先看）

AionCore 是**预编译 v0.2.2 二进制**，本项目不编译它，因此只能靠 CLI 参数 /
环境变量改变行为。而 Node 运行时只有两条路：

`crates/aionui-app/src/cli.rs:64-66`：
`--managed-resources-mode` 是 `ValueEnum`，**只有 `bundled` 和 `download` 两个值**，
默认 `download`。**没有 `system` / `disabled` / `none` 选项。**

`crates/aionui-runtime/src/node_runtime/mod.rs:26-47`：
命令字符串 `node` / `npm` / `npx` 被**硬编码**解析为 `RuntimeCommandProbe::NodeTool`，
随后必然走 `ensure_node_runtime()` → `install_and_validate_with_reporter()`。

`crates/aionui-runtime/src/node_runtime/managed.rs:105-159`：
- `download` 模式：`node_sources()` 返回空 → `activate_local_runtime_source()` 返回 None
  → 直接 `install_archive_with_retry()` 从 `https://nodejs.org/dist/v24.11.0/...` 下载；
- `bundled` 模式：要求 `<exe同目录>/managed-resources/node/node-v24.11.0-win-x64/`
  且校验 `node.exe` + `npm` + `npx`。

`crates/aionui-app/src/commands/cmd_server.rs:288-300`：
启动时**后台** `ensure_node_runtime()`，失败只 `WARN BOOTSTRAP_DEGRADED_MANAGED_RUNTIME_PREPARE`，
不阻塞 HTTP。前端已有 `runtime.statusChanged` WS 事件与
`InstallationIntegrityDialog` 可展示状态。

**结论**：
- 「让用户自己装 Node，然后 AionCore 直接用系统 PATH 的 Node」——
  **在不改 AionCore 源码重新编译的前提下做不到**。`node` 命令永远走托管 runtime，
  不会回退到系统 PATH。
- 「禁用自动下载」—— 没有 CLI 开关。传 `--managed-resources-mode bundled` 但不给目录
  只会让 runtime **硬失败**（`bundled Node runtime missing`），比 warn 更糟。
- 唯一能"不下载"的正路是 `bundled`，但那正是你上一轮明确「不加」的 104 MB 资源包。

### 可选项

| 选项 | 做法 | 代价 |
|---|---|---|
| **2A 保持 download + 加提示（推荐，零风险）** | 后端行为不变；Tauri 壳启动时检测 `node --version`，未检测到时在窗口显示非阻塞提示「未检测到 Node.js；内置 Agent 首次启动会自动下载，如需离线使用可自行安装 Node.js 22+」；同时把已有 `runtime.statusChanged` 的 failed 事件翻译成更明确的「请自行安装 Node」文案 | 不改变后端，不破坏已验证产物 |
| **2B 真正禁用下载、改用系统 Node** | 需 fork AionCore 源码，改 `probe_runtime_command` 让 `node` 回退 PATH，并新增 `ManagedResourcesMode::System`；**重新编译后端** | 违背「用成品、不编译」决策；要维护 fork；工作量大 |
| **2C 用系统 Node 伪装 bundled** | 壳层把系统 Node 复制/软链成 `managed-resources/node/node-v24.11.0-win-x64/`，传 `bundled` + `AIONUI_BUNDLED_MANAGED_RESOURCES` | 目录名/版本固定为 24.11.0，用户自装版本未必匹配；等于变相实现 bundled，脆弱 |

### 需求文字歧义

原话「nodejs 我想走默认 download，而是提示用户自己安装」中「而是」是转折，
但前半句没有否定词。两种可能：
- 「**不想**走默认 download，而是提示用户自己安装」→ 对应 2B/2C，但受上述硬约束限制
- 「想走默认 download，**另外**提示用户自己安装」→ 对应 2A

需要用户明确。
