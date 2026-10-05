# 合并 ATO-Split-20261005-r6：APK 矢量图标 + 渲染器加固 + C5 战斗标题

日期：2026年10月5日。工作目录：`D:\desktop\ATO_assistant`。

用户要求：不跑对方的安装器（本地改动太多），把 `ATO-脚本兼容补丁-20261005-R6-APK来源.zip` 里的改进**手工合并**进现有项目。

## 做了什么

| # | 改动 | 范围 |
| --- | --- | --- |
| 1 | **95 个行内图标换成 APK 矢量母版** | `story/assets/mixed-media/images/c1..c5/icon-*.svg` 中的 95 个；44 个母版多对一（跨册同语义共用一张） |
| 2 | **渲染器加固** | `story/assets/mixed-media/renderer.js` 换成 r6 版 + 保留本项目对 `.svg` 的路径放宽 |
| 3 | **C5 战斗标题高亮** | renderer 内新增 `ATO_C5_BATTLE_HEADINGS` 模块；`story/assets/app.js`、`ss/app.js` 各接一处 |
| 4 | **样式与缓存参数** | `styles.css` 追加 5 条规则；两个 `index.html` 缓存串提到 `20261005-apk-icons1` |
| 5 | **映射哈希同步** | `mapping.js` 里 95 个路径的 `assetSha256` 共 7898 行重算，版本串追加 `-apk-icons1` |

### 1. 图标

- 母版来源：r6 包内 `docs/r6/apk/` 的重建工具链（`rebuild_from_catalog.py` + `build_apk_svgs.py` + 44 张导出像素快照）。本地实际跑通，**44/44 与发布记录的 SHA-256 逐字节一致**。
- 提取链：APK → `assets/bin/Data/data.unity3d` → Unity `Texture2D`/`Sprite` → 静态导出 PNG → alpha 等值线描摹成纯路径 SVG。
- 落地方式：按语义把母版写成项目现有的 95 个 `icon-*.svg` **文件名不变**，因此 `mapping.js` 的行、路径、锚点一行都不用改。
- 根标签属性顺序改成项目约定（`xmlns` → `viewBox` → `width` → `height`），以满足 `story/tests/inline-icon-svg.test.cjs` 的前缀断言；图形内容与母版一致。
- **4 个含义保持项目现有版本**（按用户选择）：`icon-distraction`、`icon-argonaut-flame-badge`、`icon-exit`、`icon-argonaut-flame`。

### 2. 渲染器

从 r6 版取回的可靠性改造：

- 每次加载尝试独立持有 `Image` 与闭包：过期回调不会误判下一张图（`state.image !== image` 即放弃）。
- `decode()` 成功后才显示，失败/超时（2000 ms）→ 原 PNG → 精确定位原文，不再出现破图或空占位。
- 图片就绪前 `hidden`，不预占布局，第二屏不会因为坏图跳版。
- 模态框关闭时执行 cleanup、卸载重挂时恢复原始节点。
- 新增 `vectorAssets` 认证路径（本项目 mapping 没有该字段，恒为空，不影响现有行为）。

保留的本项目改动：`pathOK` 允许 `.media/.../icon-*.svg`（本项目行内图标本来就是 SVG）。

### 3. C5 战斗标题

- renderer 末尾的内嵌模块 + `window.ATO_C5_BATTLE_HEADINGS`，纯显示层：只给审计过的标题区间加 `<strong class="ato-c5-battle-heading">`，正文文本、锚点、存档字节不变。
- 用本项目当前 C5 正文复算：**6 个条目、147 个标题区间命中**，文本逐字保留，不匹配的条目原样透传。

## 判断与取舍

1. **原生战斗版图复用（r4）没有启用**：项目里 `story/images/battles` 不随仓库分发（`.gitignore` 第 97 行），而 r6 注册表里 35 条别名会把 `terrain-diagram`/`battle-map` 行改指原生 jpg 并要求像素尺寸完全一致——在本项目里那会让书内裁图被判定"尺寸不符"而整张丢掉（实测：某条目 13 张图掉到 11 张）。因此把注册表用 `NATIVE_BATTLE_REUSE = false` 关掉，`nativeFor()` 恒为 null，地形图照旧走 mapping 里的书内裁图。将来若随包分发原生版图，改成 `true` 即可。
2. **`inline-icon-svg.test.cjs` 增加了白名单**：10 个新图标自带白色"墨层"（山羊/笨重/火焰/作战行动用 preserve 调色板、反应/移动行动用 invert、借机时段用 color），白是图案本体（山羊白脸、拳头白高光、菱形里的白感叹号），不是纸白底板，底色仍是透明。白名单在测试里逐条列出并注明理由；其余 265 个行内 SVG 的"不得出现纯白填充"守卫保持原样。
3. **没有接入 `entry.originalText`（英文 OCR）的标题钩子**：C5 标题记录的指纹取自中文民间正文，英文原文永远不匹配（等于空转），而该项目 `battle-aibp-links.test.cjs` 的隔离沙箱也没有 `mixedMediaContext`，接进去只会破坏既有测试。故只保留正文侧钩子。

## 验证

- `node --test --test-isolation=none story/tests/*.test.cjs` → **84 项通过、0 失败**（合并前基线同样是 84 项）。
- 真实浏览器（headless Chrome + CDP，`tmp/c13-fan/browser-svg-check.cjs`，本地静态服务 127.0.0.1:18901）：
  - `c1-15-0` 13 张图（11 SVG + 2 PNG）、`c1-0-0` 1 张、`c1-0-160` 2 张、`c3-15-13` 8 张；
  - 所有 SVG `naturalWidth/Height` 非 0；**22 个图片请求全部成功，0 失败**；
  - 随字号缩放实测：17px → 32px 时同一枚图标 21.98×19.55px → 41.39×36.8px（比例 1.88 = 32/17）。
- C5 标题：6 条目 / 147 区间命中，文本保真，未命中条目原样返回。
- 变量/工件校验：`node --check` 通过（renderer.js、story/assets/app.js、ss/app.js）；`mapping.js` 修改为等长哈希替换 + 版本串加长，文件仅增长 11 字节。

## 未做 / 限制

- r6 的 **vectorAssets + PNG 回退 + 哈希认证架构**没搬（本轮范围为 A）：本项目仍是"行内行直接指 `.svg`"。收益是可回退性；代价是要重建 mapping 的图标行结构。
- r4 原生地图复用未启用（见上）。
- 未做逐条人工目视校对 99 个图标；44 个母版已由 r6 包做过独立语义 + 16/24/32/64 px 复核，本项目只做了抽样渲染比对（`tmp/patch-compare/preview/white-fill-check.png`）。
- 图标目录与 `mapping.js` 都在 `.gitignore` 内，因此这些改动**不进版本库**，也无法用 git 回退——请用下面的备份目录。

## 相关文件哈希（SHA-256）

- `story/assets/mixed-media/renderer.js`：`fceeafa22ed987a8b732b7d125e669d27255b214d281e508279fa2dfe2603a35`
- `story/assets/mixed-media/styles.css`：`b9f77fb14a18939752effee9a29c17e6000664d4a10f3f692b043d2998ae4ee7`
- `story/assets/mixed-media/mapping.js`：`f909759debc47eed09d41cc0997e9cc9ecac3e2633066d7494a0a07f1cfe94b8`
- `story/assets/app.js`：`cc089ae9e2b1423b282977cd1c7873e056cdca937bc87dd2456db4fe9c6727ea`
- `ss/app.js`：`c33609b33d22eb4101b2a2fcc9d92a6e0f85d0e5970db8fe4dab80fb20650bcd`
- `story/index.html`：`3d251e19601aa30daba0997a184241050e25a3cd96d715a29bd13cb3867f2038`
- `ss/index.html`：`c26360b0fb0a352b780c8ab0aae5400ffed3b5dbd94b80037ae32ed06b76bef8`
- `story/tests/inline-icon-svg.test.cjs`：`e9cbca4d3b0012f91a44132fe78067ea85fca52452be1772e7c855cd40294ee0`
- 图标集合：99 个 `icon-*.svg`，共 2,122,974 字节（其中 95 个本轮被替换）

## 回滚

合并前的原件（95 个图标 + 7 个运行文件）保存在 `tmp/merge-r6-backup/original/`，目录结构与项目一致：

```powershell
Copy-Item -Recurse -Force "tmp\merge-r6-backup\original\*" "D:\desktop\ATO_assistant\"
```

工具与中间产物（不参与发布）：`tmp/patch-compare/` 下的 `merge_step1_backup.cjs`、`merge_step2_icons.cjs`、`merge_step3_mapping.cjs`、`merge_step5_native_gate.cjs`、`verify_c5_headings.cjs`、`r6-svg-masters/`（44 个母版原件）、`icon-hash-update.json`。

## 三条分发链路（.atopack / APK 导入 / Docker）

结论：**接线一处都不用改**（三条链路都按路径/文件名工作，而本次只换字节），需要的是重打产物。

### .atopack：两个包都已重打并复核通过

| 产物 | 大小 | 成员 | 口径 | 复核 |
| --- | --- | --- | --- | --- |
| `export/ATOassets-民间版-3.5.4-q85-2026-10-05.atopack` | 1.50 GiB（1,611,306,905 B） | 4,862 | fan | ✓ |
| `export/ATOassets-官方版-3.5.4-q85-2026-10-05.atopack` | 2.64 GiB（2,836,458,722 B） | 7,057 | official | ✓ |

- 命令：`asset-studio/.venv/Scripts/python.exe asset-studio/tools/build_fan_pack.py --ato-root . --output export/… --incremental-from export/ATOassets-民间版-3.5.2-q85-2026-10-04.atopack --image-quality 85 --image-quality-keep-file asset-studio/pack-shrink-keep.txt --verify full`（官方版换 `build_official_pack.py` + 官方版底包）。
- 增量：民间版复用 4,420 个成员（13 秒）、官方版复用 6,615 个（32 秒）；两个包构建器自带的 `--verify full` 各比对 **4,288 个哈希**通过。
- 独立复核 `check_pack.py --crc --hash`：**4,288 张图 + 84 密语字形 + 435 混合媒体成员的 SHA-256 与全部 CRC 一致 → "包是完整的"**。日志 `tmp/r6-pack/verify-1.log`、`verify-2.log`。
- 交叉核对（`tmp/r6-pack/check-pack-icons.py`）：从两个包里各抽出 4 个新图标 + `mapping.js`，与磁盘逐字节一致；`mapping.js` 版本串尾部为 `-apk-icons1`；混排段 275 个 SVG 齐全。
- 过期的那份民间版 3.5.4（22:24 打的，图标与 OO 路径都是旧的）已移到 `export/superseded/`，未删除。

### APK 导入：名单口径不用改，APK 必须重出

- `assets/atopack-catalog.json` 的 4,826 条路径（含 435 条混排素材）是**按文件名写死**的（`asset-studio/app/fixed_catalog.py:190 MIXED_MEDIA_BOOK_CROPS`），本次只换字节不改名 → 名单、`catalog_version`、`versionCode`、`AndroidManifest` 都不用动。
- APK 本体里的 `renderer.js` / `styles.css` / 两个 `app.js` / 两个 `index.html` 是**构建时从工作区拷进去**的（`tools/export_android.py:209-216`，实测这几个文件是 KEEP、`mapping.js` 与 `images/**` 是 EXCLUDE，构建后还有"产物里不得有任何素材"的断言）→ **必须重出 APK** 才会带上本次的渲染器改动。
- 本机没有 Android SDK/Gradle，未构建；`python tools/export_android.py --version 3.5.4` 会自动下载 SDK（数 GB），或走 CI 的 `.github/workflows/android-release.yml`。
- 导入侧回归全绿：`tools/test_android_resource_catalog.py`（4,826 条映射）、`..._coverage.py`、`test_android_atopack_import.py`（105 项，含 sha256/bytes 不符用例）、`test_android_campaign_import.py`（102 项）。

### Docker：包已导出并核对，镜像需在有 Docker 的机器/CI 上重建

- 新导出 `export/ATO-Assistant-Docker-3.5.4.zip`（3.04 GB）。核对结果（`tmp/r6-pack/check-docker-package.py`）：`renderer.js`、`styles.css`、`story/assets/app.js`、`ss/app.js`、两个 `index.html` **与磁盘逐字节一致**；私有裁图成员 **0 个**、`mapping.js` 为 **0 字节占位**（设计如此：运行时由宿主 bind mount 提供）、LICENSE 2 份。
- 挂载与排除口径都不用改：`tools/test_docker_mounts.py`（按 catalog 每个面核对挂载覆盖）、`test_docker_package_license.py`、`test_packaging_exclusions.py` 全部通过。
- 镜像构建需要 Docker，本机未安装 → 走 CI 的 `.github/workflows/docker-package.yml`。

### 发布阻断项：故事书代码从未进 git（已暂存 19 个文件，待你提交）

**口径**：`story/` 下的**代码**走 git 发布，**素材**（裁图、`mapping.js`、私有正文、音频包、密语字形）走 `.atopack`。

审计结果：`story/assets/mixed-media/renderer.js`、`story/assets/mixed-media/styles.css`、`story/assets/story-tables.js` 三个**被页面引用的代码文件**从来没有进过 git——`git ls-files` 为空、`HEAD` 里不存在、`git log --all` 0 次提交，而 `.gitignore` 并没有拦它们（只忽略 `mapping.js` 与 `images/`），`api/app-update-policy.php` 也明确允许它们发布。后果：从干净检出构建的 **APK、Docker 镜像、便携包都会缺这些文件**——故事页 404，行内图文混排、C5 战斗标题高亮与 C2 战斗表格整体退化成纯文本，在线更新也永远送不到。同类漏提交的还有 `asset-studio/app/mixed_media_resources.py`（`.atopack` 混排段模块）与一批测试文件。

已 `git add`（**只暂存、未提交**）以下 19 个文件：

| 类别 | 文件 |
| --- | --- |
| 页面引用的运行代码 | `story/assets/mixed-media/renderer.js`、`story/assets/mixed-media/styles.css`、`story/assets/story-tables.js` |
| .atopack 模块 | `asset-studio/app/mixed_media_resources.py`、`asset-studio/tests/test_mixed_media_resources.py` |
| 故事书测试 | `story/tests/{c13-fan-media,c4-story-revision,inline-icon-svg,mixed-media,second-screen-story-columns,story-pipe-tables}.test.cjs`、`story/tests/helpers/mixed-media-dom.cjs` |
| 根级测试 | `tests/{aibp-default-trait-cancel,aibp-labyrinth-track,aibp-second-screen-status,map-last-visited-city,ss-second-screen-theme}.test.cjs` |
| 新守卫 + CI | `tools/test_story_code_in_git.py`、`.github/workflows/resource-import-regressions.yml` |

新增守卫 `tools/test_story_code_in_git.py`：扫描 10 个应用页面的本地 `.js`/`.css` 引用（85 个代码引用 + 5 个私有素材引用），断言「引用的代码必须已跟踪/已提交」且「被 `.gitignore` 命中的私有素材不得进 git」。已接进 `resource-import-regressions.yml`。反向验证过两种失效场景：把 `story-tables.js` 撤出暂存 → 报「存在于工作区但没有进 git」；把它连文件一起移走（模拟干净检出）→ 报「在仓库里不存在」。注意它自身也修过一个假阴性：早期版本先判断后缀再去查询参数，导致所有带 `?v=` 的引用被跳过、实际只检查了 10 个引用。

恢复：`git restore --staged <路径>`（或用 `git reset` 全部取消暂存）。

未纳入本次提交、需要你决定的：

- `release-notes/*-20261005.md` 共 11 份工作笔记（含本文件）仍未跟踪；它们的文件名不符合 `v<版本>.md`，`tools/test_release_assets.py` 因此报错（该失败在本次合并前就存在，且不在任何 workflow 里）。要清就把工作笔记挪到别处、只留发行公告。
- `acl-recovery-20261005/acl-report-*.jsonl` 是沙箱 ACL 修复留下的诊断文件，不属于项目内容，建议删除或加进 `.gitignore`。

### 已知既有失败（与本次合并无关）

`tools/test_release_assets.py` 报 11 个工作笔记文件名不符合 `v<版本>.md`（含本文件 `r6-apk-icons-merge-20261005.md`）以及 `v3.5.4.md` 缺 `## 下载`/`## 验证`——这些在本次合并前就已存在（`c1-labyrinth-track-marker-20261005.md` 等 10 个旧笔记同样命中），该测试不在任何 workflow 里。
