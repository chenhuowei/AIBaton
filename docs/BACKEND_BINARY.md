# 后端二进制策略：使用 GitHub Release 预编译成品

> 状态：**已验证可行，定为默认方案**（2026-11-07 实测）。
> 本文件是 `docs/PLAN.md` 的补充与修订；冲突处以本文为准。

## 1. 结论

**可以直接用 GitHub Release 的预编译 `aioncore.exe`，不需要本地编译 AionCore。**
这正是 AionUi 上游 `packages/shared-scripts/src/prepare-aioncore.js` 的官方做法，
也是本机已安装 AionUi 的 `E:\install_dir\aionui\resources\bundled-aioncore\win32-x64\manifest.json`
里记录的做法（`sourceType: download`）。

因此：

- ❌ 不再需要为了「跑起后端」而安装 Rust 工具链 / MSVC Build Tools
- ❌ 不再需要 `cargo build --release -p aionui-app`
- ✅ 只需获得二进制 → 校验 SHA256 → 按 Tauri `externalBin` 规则改名

**获取方式二选一（都支持）**：

| 方式 | 说明 | 适用 |
|---|---|---|
| **A. 脚本自动下载** | `node scripts/fetch-aioncore.mjs`（P1 可补）：从 GitHub Release 下载 zip、比对官方 `aioncore-checksums.txt`、解压、改名 | CI / 可联网环境 |
| **B. 你直接把成品文件给我（本项目采用）** | 实际路径 `D:\workspace\rea\aionui\aioncore-v0.2.2-x86_64-pc-windows-msvc`；用 `scripts/adopt-aioncore.mjs` 校验并改名到 `src-tauri/binaries/aioncore-<triple>.exe` | 离线 / 网络不稳 / 已有指定构建 |

> 方式 B 完全不需要联网。若给的是 **zip**，仍会用官方 checksums 校验；
> 若给的是**裸 exe**，则无法与官方哈希比对，脚本会记录其实际 SHA256 并在
> `binaries/checksums.json` 里标注 `sourceType: local-provided`，同时跑一次
> `--help` + `--local --port <随机> --data-dir <临时>` + `GET /health` 冒烟测试。

> 注意：**Tauri 壳本身 `src-tauri/` 仍是 Rust 代码**，最终打包时依然需要
> Rust + MSVC。区别是：这两样从「P0 阻塞项」变成了「P3 才需要」，
> 而**后端**（27 crates、git 依赖、10–30 分钟编译）被完全跳过。

## 2. 实测记录（本机）

| 项 | v0.1.10 | v0.2.2 |
|---|---|---|
| 资产 | `aioncore-v0.1.10-x86_64-pc-windows-msvc.zip` (52 MB) | `aioncore-v0.2.2-x86_64-pc-windows-msvc.zip` (35 MB) |
| SHA256（zip） | `b96a987ad2d6f7d34988ad6ecfb17dcb287103398daee4d7a024970d9c4ddf15` ✅ 匹配官方 checksums | `d1ed8d1da869230c18701747d07e8f068db5b8c9442e65261304aeb4c27eacf6` ✅ 匹配 |
| zip 内容 | 单个 `aioncore.exe` (96 MB) | 单个 `aioncore.exe` (99 MB) |
| `--local --host 127.0.0.1 --port <随机> --data-dir <临时>` | ✅ 启动，`GET /health` → `200 {"status":"ok","version":"0.1.10"}` | ✅ 启动，`GET /health` → `200 {"status":"ok","version":"0.2.2"}` |
| `--local` 下 CORS | `access-control-allow-origin: *` ✅ | 同 ✅ |
| `--parent-pid` | **不支持**（`--help` 无此参数） | ✅ 支持 |

**版本对齐（重要）**：

- `../AionUi/package.json`（`main`）→ `"version": "2.2.2"`，`"aioncoreVersion": "v0.2.2"`
- `../AionCore` 本地源码是 `v0.2.2-32-g503a8719`（workspace version 0.2.2）
- `../lom-desktop/core` 是 v0.2.2 系的 fork
- 本机安装的 AionUi 用的是 **v0.2.2**（`manifest.json` 记录）

→ **最终采用 `v0.2.2`**（用户提供的成品，哈希与官方 Release 完全一致）。
前端已同步升级到 AionUi `main`/2.2.2，因此**版本完全对齐**：
2.2.2 的 `ipcBridge.ts` 本身就调用 `GET /api/agents/management`，类型也用 `installed`，
不存在之前 2.1.1 + v0.2.2 的契约漂移。

下表保留 v0.1.10 的实测数据仅作版本对比参考，本项目不再使用它。

## 3. 交付物改动

| 文档/脚本 | 改动 |
|---|---|
| `docs/PLAN.md` | §0 后端来源改为「Release 成品」；P3 不再 `cargo build -p aionui-app`；风险表删掉「首次编译慢 / crates.io 403 / git 依赖」 |
| `docs/ENV_SETUP.md` | Rust / MSVC 从「P0 必需」降级为「P3 打包必需」；新增「预编译成品下载」章节 |
| `scripts/check-env.mjs` | `required=false` 用于 rustc/cargo/MSVC（P0 不阻塞）；新增「sidecar 二进制存在」检查 |
| `scripts/adopt-aioncore.mjs`（**已实现并采用**） | 方式 B：接纳用户提供的本地成品，校验 / 冒烟 / 改名 |

## 4. 二进制放置与命名（Tauri `externalBin`）

`tauri.conf.json`：

```json
{
  "bundle": {
    "externalBin": ["binaries/aioncore"]
  }
}
```

文件名必须带 **Rust target triple**（`rustc --print host-tuple`）：

| 本机 | 目标文件 |
|---|---|
| `x86_64-pc-windows-msvc` | `src-tauri/binaries/aioncore-x86_64-pc-windows-msvc.exe` |
| `aarch64-pc-windows-msvc` | `src-tauri/binaries/aioncore-aarch64-pc-windows-msvc.exe`（另有对应 Release 资产） |

开发态可用环境变量 `AIONUI_CORE_BIN` 指向任意绝对路径，跳过命名规则
（与 lom-desktop `LOM_CORE_BIN` 同思路，但独立实现）。

`.gitignore` 必须排除 `src-tauri/binaries/aioncore-*.exe`（二进制不入库），
只保留 `.gitkeep` + `checksums.json`（记录版本与哈希，便于复现）。

## 5. 两个版本的 CLI 差异（实现 `sidecar.rs` 时必须兼容）

`v0.1.10 --help` 实际支持：

```
--host --port --data-dir --work-dir --app-version --local --log-dir --log-level
```

**没有**：`--parent-pid`、`--identity-mode`、`--managed-resources-mode`、`-V/--version`。

`v0.2.2 --help` 额外支持：

```
--parent-pid --identity-mode --dump-prompts --recover-corrupted-database
--managed-resources-mode [bundled|download] (默认 download)
```

以及大量子命令（`capabilities` / `config` / `doctor` / `user` / `secret` …）。

### 实现约束

1. **当前锁定 v0.2.2，可以传 `--parent-pid`**（`src-tauri/src/sidecar.rs` 已传真实 `std::process::id()`）。
   若将来降到 v0.1.10，必须去掉该参数，否则会因未知参数直接退出。
2. **退出清理以「Tauri 侧 `Child::kill()` + `wait()`」为主**，`--parent-pid` 只作为 v0.2.2+ 的额外保险。
3. **决策：不引入 `managed-resources/`，保持默认 `download`**。
   v0.2.2 启动时会后台从 `nodejs.org` 拉 Node v24.11.0 到
   `{data_dir}/runtime/node`。早期一次冒烟曾出现 `connect failed` 警告，
   但后续重试成功（本机实测该目录已有完整 `node.exe` + npm/npx，约 104 MB）。
   即使下载失败也只产生 `WARN BOOTSTRAP_DEGRADED_MANAGED_RUNTIME_PREPARE`，
   **不影响 `/health` 与 HTTP 服务**；外部 CLI Agent 走 PATH 不受影响。
   因此本项目不传 `--managed-resources-mode bundled`，不增加安装包体积。
   （`src-tauri/src/sidecar.rs` 仍保留「若将来放置 `managed-resources/manifest.json`
   就自动启用 bundled」的兼容逻辑，但当前不启用。）
4. **实测坑**：在 MINGW64 里用 `--parent-pid $$` 传 shell PID，后端会判定父进程已退出并
   `Server shut down gracefully` → `/health` 连不上。真正在 Tauri 里由 Rust `std::process::id()`
   传真实 PID 没问题，但**不要**从 shell 脚本里随便传。

## 6. 脚本契约（P1 实现）

### 方式 A：`scripts/fetch-aioncore.mjs`

```
输入： --version v0.2.2 | --arch x64|arm64 | --platform win32|darwin|linux
步骤：
  1. 拼 asset name：aioncore-${tag}-${arch}-${triple}.zip|tar.gz
  2. GET https://github.com/iOfficeAI/AionCore/releases/download/${tag}/aioncore-checksums.txt
  3. GET 资产 → 计算 SHA256 → 必须与 checksums.txt 完全一致，否则删除并报错
  4. 解压，找到 aioncore[.exe]
  5. 重命名为 binaries/aioncore-${hostTriple}[.exe]
  6. 写 binaries/checksums.json（version / sha256 / 来源 URL / 时间）
退出码：0 成功；非 0 时不得留下半成品
```

### 方式 B：`scripts/adopt-aioncore.mjs`

```
输入： --from <path>            # 可为 .zip / 目录 / 裸 aioncore.exe
       --version <tag>          # 可选，仅用于记录；裸 exe 时从 /health 或 --app-version 推断
步骤：
  1. 定位 aioncore[.exe]（zip 则先解压到临时目录）
  2. 计算 SHA256；若为 zip 且与官方 checksums 匹配则记录 sourceType=release
     否则记录 sourceType=local-provided（不伪造官方哈希）
  3. 冒烟测试：--help 可读；--local --host 127.0.0.1 --port <随机> --data-dir <临时>
     → GET /health 返回 200 且 JSON 含 status=ok；随后 kill + wait，清理临时目录
  4. 重命名为 binaries/aioncore-${hostTriple}[.exe]
  5. 写 binaries/checksums.json（version / sha256 / sourceType / 来源路径 / 时间）
退出码：0 成功；冒烟失败则删除产物并报错
```

> 冒烟测试在 `adopt-aioncore.mjs` 里不传 `--parent-pid`（避免 shell PID 误判）；
> Tauri 壳里由 Rust 传真实 PID 没问题。

## 7. 许可与分发

- Release 二进制来自 `iOfficeAI/AionCore`（`LICENSE` Apache-2.0；根 `Cargo.toml` 写 MIT，不一致）。
- 分发时须在 `THIRD-PARTY-NOTICES.md` 记录：组件名、版本、下载 URL、SHA256、许可声明。
- **不要把二进制提交进 git**（与 lom-desktop `binaries/.gitkeep` 的做法一致）。

## 8. 对「环境缺失」结论的修订

| 项 | 原结论 | 新结论 |
|---|---|---|
| Rust 1.95.0 + cargo | P0 必需 | **P3（编译/打包 Tauri 壳）才需要**；P0/P1/P2 不需要 |
| VS 2022 Build Tools + Windows SDK | P0 必需 | **同上**，且只用于 Tauri 壳，不用于后端 |
| 磁盘 ~15–25 G | 风险高 | **大幅缓解**：不编译后端，只需 `node_modules` + Tauri `target/`（约 3–8 G） |
| 网络 GitHub Releases | 未列 | **P0 需要**（已实测 HTTP 200） |
| 校验工具 | 未列 | `sha256sum`（Git Bash 自带）或 Node `crypto`，无需额外安装 |
