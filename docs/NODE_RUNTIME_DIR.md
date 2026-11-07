# Node 下载目录：现状与「改到安装目录」的可行性

> 2026-11-07。用户问：Node 默认下载到哪个目录，能否调整为当前应用的安装目录下。
> **本轮只调研，未改动代码**（改动会连带搬走数据库，需先确认）。

## 1. 默认目录

AionCore `crates/aionui-runtime/src/cache.rs`：

```
aionui_runtime::init(&cli.data_dir)  ← main.rs:44，OnceLock 写一次
    runtime_root  = {--data-dir}/runtime
    node_root     = {--data-dir}/runtime/node/node-v24.11.0-win-x64/
```

`cache.rs` **不读任何环境变量**。`AIONUI_CACHE_DIR` 只被
`aionui-system/src/sysinfo.rs` 用来在 `/api/system/info` 里「显示」缓存目录，
不影响 Node 实际下载位置。所以改目录的**唯一开关是 `--data-dir`**。

本项目 `src-tauri/src/lib.rs:39` 传 `app.path().app_data_dir()`，因此实际是：

```
C:\Users\howay\AppData\Roaming\com.aionui.rust.desktop\
├── aionui-backend.db            ← 数据库
├── work/  logs/  builtin-skills/  aionui-process/
└── runtime/node/node-v24.11.0-win-x64/   ← Node 24.11.0，约 104 MB
```

实测该目录已存在完整 `node.exe` + npm/npx。

## 2. 能否改到「安装目录」

**能，但只能整体改 `--data-dir`**，代价是数据库/日志/工作区也一起搬过去。
不能只搬 Node：后端把 runtime 根钉死在 `data_dir/runtime`，没有单独覆盖项。

### 硬约束：安装目录多半不可写

| 安装位置 | 普通用户可写 | 后果 |
|---|---|---|
| `C:\Program Files\...`（NSIS/MSI 默认，本工程 `bundle.targets = all` 未设 installMode） | ❌ | `--data-dir` 建目录/写 DB/写日志/下载 Node 全部失败，**后端起不来** |
| `%LOCALAPPDATA%\Programs\...`（NSIS `installMode: currentUser`） | ✅ | 可用 |
| 绿色版自定义目录（如 `E:\install_dir\aionui`） | ✅ | 可用 |

本机实测：`C:\Program Files` 与 `C:\Program Files (x86)` 均不可写；
`%LOCALAPPDATA%\Programs` 与 `E:\install_dir\aionui` 可写。

### 可选方案

| 方案 | 做法 | 影响 |
|---|---|---|
| **A. 保持现状（推荐）** | 不改 | 数据在 Roaming，Node 在 `runtime/node`，跨版本升级不丢 |
| **B. 全部搬到 exe 同目录 + 改 NSIS installMode** | `lib.rs` 用 `current_exe().parent()` 作为 data_dir；`tauri.conf.json` 加 `bundle.nsis.installMode: "currentUser"`（装到 `%LOCALAPPDATA%\Programs`） | 变成「绿色版」风格，卸载/升级易残留数据；MSI 仍装 Program Files 会失败，需限制 targets |
| **C. 只改 Node、保留 DB（做不到）** | 需要 AionCore 支持独立 runtime 根 | 预编译二进制无此开关，须 fork 重编译 |
| **D. 环境变量覆盖** | 在壳层允许 `AIONUI_DATA_DIR` 覆盖 `app_data_dir()` | 灵活，但仍是整体搬 data-dir，不是单独 Node；且默认不变 |

> 另外「安装目录」在升级时通常会被安装程序清空/覆盖，把 104 MB Node 和数据库放进去，
> 每次升级都要重新下载、历史对话可能丢失。这也是上游把 data 放 Roaming 的原因。

## 3. 建议

如果用户只是嫌「Node 藏在 Roaming 里不好找」，更合适的是：
- 保持 A（现状），在关于页/设置里显示实际路径；或
- 采用 D 给一个可选覆盖，默认不变。

如果用户明确要「单目录绿色版」，再走 B，并同步调整安装包 targets/installMode。

**等待用户确认后再实现。**
