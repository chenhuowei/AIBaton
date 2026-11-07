# Aibaton 品牌图标

> 2026-11-07。为 Aibaton 设计并生成一整套图标，替换掉沿用上游 AionUi 的资源。
> **零外部依赖**：`scripts/generate-icons.mjs` 用 Node 内置 `zlib` 直接写 PNG / ICO。

## 设计理念

贴合 **Aibaton = AI + baton（指挥棒 / 接力棒）** 与「多 Agent 协作」定位，
也呼应应用的**默认暗黑模式**：

| 元素 | 含义 | 视觉 |
|---|---|---|
| 深色圆角底 | 桌面深色主题、稳重的产品感 | `#101C2E → #16283E` 对角渐变 + 内缘高光 |
| 对角指挥棒 | baton：指挥 / 调度多个 Agent | 左下→右上胶囊，`#3AE0C4 → #5B8CFF` 青蓝渐变 + 中心线高光 |
| 右上发光节点 | AI 核心 / 智能落点 | 亮核 + 外环 + 大面积柔光晕 |
| 两道轨道弧 | 接力 / 协作 / 循环 | 半透明浅蓝弧线，不抢主体 |
| 两端金属帽 | 真实指挥棒的质感 | 尾端青白、尖端融进 AI 节点 |

全部用解析式 SDF（rounded box / capsule / ring）绘制，每个尺寸独立渲染并做
1px smoothstep 抗锯齿，因此 16×16 到 1024×1024 都清晰，不依赖缩放。

## 生成的文件

| 路径 | 尺寸 / 格式 | 用途 |
|---|---|---|
| `src-tauri/icons/icon.png` | 1024×1024 PNG | Tauri 主图标 |
| `src-tauri/icons/32x32.png` | 32×32 PNG | 小尺寸 |
| `src-tauri/icons/icon.ico` | ICO，16/24/32/48/64/128/256 七帧 32bpp | Windows 窗口 / 任务栏 / 安装包 |
| `public/pwa/icon-180.png` | 180×180 PNG | Apple touch icon |
| `public/pwa/icon-192.png` | 192×192 PNG | 页面 favicon / PWA |
| `public/pwa/icon-512.png` | 512×512 PNG | PWA 大图 |
| `src/renderer/assets/logos/brand/app.png` | 1024×1024 PNG | 关于页 / 登录页品牌图 |

> ico 采用经典 32 位 BMP/DIB 条目（bottom-up BGRA + AND mask），
> 兼容性优于 PNG 压缩条目；已校验 7 帧的宽高、bpp、size、offset 全部合法。

## 使用方式

```bash
npm run icons           # 重新生成全部图标
npm run sync:frontend   # 同步上游 + rebrand（会覆盖 src/，但不覆盖图标）
npm run tauri -- build  # 图标是编译期资源，改图后必须重新打包
```

> 注意：`sync:frontend` 会从 `../AionUi/public/` 复制 PWA 资源，
> **会覆盖 `public/pwa/*`**。所以同步完要再跑一次 `npm run icons`。
> 若希望自动化，可把 `icons` 接到 `sync:frontend` 末尾。

## 验证

- PNG 解码校验：IHDR 1024×1024 / 8bit / RGBA，IDAT inflate 后字节数精确匹配，
  采样点：角 `(0,0)` 透明、中心 `[129,203,235]`、AI 节点 `[192,242,238]`
- 32×32 ASCII 亮度预览确认对角棒 + 右上光晕 + 圆角底形状正确
- ICO 7 帧结构校验通过
- `dist/assets/app-*.png` 与源 `brand/app.png` 字节完全一致（95726 B）
- release 重新打包成功，`Aibaton_0.2.2_x64-setup.exe` 34.47 MiB /
  `Aibaton_0.2.2_x64_en-US.msi` 47.55 MiB
- CDP 实测：页面 `title=Aibaton`、favicon `./pwa/icon-192.png`、`theme=dark`、无登录页

## 已知陷阱（2026-11-07 修复）

`tauri.conf.json` 的 `bundle.icon` **只能列 `icons/icon.ico`**，不要同时列
`icons/icon.png`。同时列两项时，Tauri 在 Windows 上会走 PNG 那一路，把窗口资源
编成 PNG-compressed ICO；`ExtractAssociatedIcon` / 任务栏 / 资源管理器无法正确解析，
会回退显示 Tauri 内置默认（黑灰）图标。

验证方法（PowerShell 从 exe 提取真实图标）：

```powershell
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path 'src-tauri/target/release/aibaton.exe').Path)
$bmp = $ico.ToBitmap(); $bmp.Save('icon-check.png', [System.Drawing.Imaging.ImageFormat]::Png)
```

修复后采样点：中心 `[114,198,232]`、AI 节点 `[192,242,238]`、棒尾 `[139,235,222]`，
与 PNG 源一致。修复前是 `[0,0,0]` / `[165,165,165]`（旧默认图标）。

另外：改了图标后**必须** `cargo clean -p aibaton` 再 `tauri build`——
`tauri-build` 的 `rerun-if-changed` 只监听 `tauri.conf.json` / `capabilities` /
`externalBin`，不监听 ico 文件，增量编译不会重嵌资源。

## v2 — 参考用户提供的设计图重做（2026-11-07）

用户给出 `AI多CLI集成应用图标设计.png`（1536×1536）。当前模型不支持读图，
改用程序解析像素：主导色深蓝（`~32,32,64 → 32,48,96`）、上半部青白 `>` 与 `/`
CLI 尖角、中央终端面板、一条从左上到右下的亮斜线、底部暖橙/青色点缀。

`scripts/generate-icons.mjs` 已重写为 v2，解析式重绘：

- 深蓝圆角底 + 透视网格感渐变
- 终端卡片（标题栏 + 三色圆点）
- 卡片内 `>` 与 `/` CLI 符号 + 光标块
- 贯穿全图的青蓝渐变指挥棒（baton）+ 左上 AI 光点 + 右下暖橙端点
- 外围协作轨道弧

仍为零依赖 Node 生成 PNG + 7 帧 ICO。CDP 与 `ExtractAssociatedIcon` 均验证生效。
