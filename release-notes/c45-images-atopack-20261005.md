# 图片盘点与清理、混合媒体素材进分发链路、增量重打资料包（2026-10-05）

本文记录三件事：故事书图片的使用情况盘点与清理、把「新增但没进任何分发链路」的混合媒体素材接入三条链路、以及用底包做一次增量重打 `.atopack`。

## 一、盘点：哪些图还在用

方法（脚本与日志都在 `tmp/image-audit/`）：

- 枚举 `story/` 下全部图片文件，并把仓库里所有文本（代码、数据、样式、HTML、脚本、测试）当语料，按「仓库相对路径 / `./` 相对路径 / story 相对路径 / 文件名」四种形式统计引用。
- 文本引用只能说明「有没有人提到」，说明不了「页面会不会显示」，所以又用真实浏览器抓了每个代表性条目最终发出的图片请求与渲染完成后的 DOM（`capture-requests.cjs`、`dom-check.cjs`）。
- 关键发现：**请求数 ≠ 显示数**。`mapping.js` 是 `async` 加载的，映射到达前的第一遍渲染会先挂出底部版图并触发请求，映射到达后去重逻辑再把它移除。所以判定「还用不用」以最终 DOM 为准。
- 另用 CDP 屏蔽 `mapping.js` 模拟"发布包"（打包规则会把 `mapping.js` 与 `mixed-media/images` 排除在程序包外，见 `tools/packaging/package_common.py` 的 `is_mixed_media_material`），验证发布包模式下底部版图会不会重新出现（`simulate-release.cjs`）。

结论：

- 本地开发树（有私有映射）最终 DOM 里来自 `story/images/` 的图：**0 张**；显示的都是 `story/assets/mixed-media/images/**`（行内混排）、`story/data/ato-storybook-key-scans/**`（官方扫描）、`story/assets/cryptic/glyphs/**`（密语字形）。
- 发布包模式（无映射）下底部版图**会**回来：`c4-13-0` 2 张、`c3-15-13` 1 张、`c1-15-0` 2 张 —— 因此 `story/images/battles/c1|c3|c4`（21 张）必须保留，它们是发布包里唯一的版图来源。
- `story/images/OO/DY1P5.png`、`DY2P5.png` 仍在用：c1.5 / c2.5 的「导言」条目配图（`entry.image`），用 `?book=c1.5&key=c1.5-setup-0` 实测显示。
- 两种模式下都不再显示：`story/images/battles/c5/`（8 张 C5 战斗版图，C5 翻译条目改成普通排版后整篇不挂图库）与 `story/images/c5/supplement-pages/`（21 张 C5 补充页扫描）。`story/images/battles/c2/` 已被另一会话清空（改由映射行内图提供）。
- 后续确认：`story/images/battles/c1|c3|c4`（21 张）同样没用了 —— 映射表与这些版图是**同一个 .atopack** 一起下发的，有映射就必然走行内混排、底部那份被去重；而且混排裁图与这批版图本来就是同一批版图的不同裁切（C4 六张曾逐像素核对相等）。所以整个 `story/images/battles/` 也一并退场（见第二节）。
- `story/assets/OO/DY1P5.png`、`DY2P5.png` 仍在用：c1.5 / c2.5 的「导言」条目配图（`entry.image`）。它们**已从 `story/images/OO/` 搬到 `story/assets/OO/`**（见第六节），`story/images/` 目录因此整棵消失。

## 二、清理：删掉两种模式都不用的 29 张图

- 删除 `story/images/battles/c5/`（8 张，3.5MB）与 `story/images/c5/`（21 张，14MB，整个目录删除）。**删除前先整份备份**到 `tmp/image-audit/removed-20261005/`（`battles-c5/` 8 个、`c5-supplement-pages/` 21 个，数量核对一致后才删）。
- `story/assets/app.js`：`localBattleImages` 里 6 条 C5 条目删除，原注释替换为"这些文件与登记已一并清理、C5 版图改由映射行内图提供"；并新增断言性测试保证名单里不再出现 `images/battles/c5/`。
- `story/data/storybook-data.js`（本地生成物，**混合格式**：顶层两空格缩进 + 条目紧凑单行，不能用 JSON.stringify 重写）：逐行外科式删掉 97 个条目的 `imageList` 字段、共 113 条指向已删文件的引用；脚本先验证「往返写出是否逐字节一致」，不一致就拒绝覆盖（`tmp/mixed-media-pack/clean-storybook-imagelist.cjs`，备份 `tmp/mixed-media-pack/backup-storybook-data.js`）。C1/C3/C4 的 `imageList` 未受影响（只有 97 个 C5 条目命中）。
- `story/tests/c5-battle-boards.test.cjs` 整体改写为新契约（11 项）：名单里没有 C5 条目且列出的文件都存在、C5 版图/补充页目录已移除、六场 C5 战斗解析不出任何版图、数据里的 `imageList` 不再指向不存在的文件、后备回落契约与 C1 行为不变。
- `asset-studio/app/fixed_catalog.py`：删掉 52 条「有登记、文件已不存在」的条目（C2 版图 23、C5 版图 8、C5 补充页 21）及相关辅助结构与过时注释；`catalog_version` 追加退场后缀。盘点脚本 `tmp/mixed-media-pack/catalog-missing.py` 现在报「存在的面 4746，缺失 0」。
- 保留但有说明：`tools/packaging/package_common.py` 里 `C5_SUPPLEMENT_PAGES_DIR` / `is_c5_supplement_page` 排除规则留着（防御性规则，用合成路径验证仍生效）。

副作用（按需求产生）：`魔鬼本人之战`、`水比血浓之战` 两场在本地树与发布包里都不再有版图；另外四场 C5 战斗的版图仍以映射行内图形式显示（那部分素材不随程序包分发）。

## 三、混合媒体素材进三条链路

之前 `story/assets/mixed-media/mapping.js` 与 `images/c1..c5/` 都是 `.gitignore` 的私有素材，却**没有任何分发通道**：素材库固定清单没登记、APK 名单没有、Docker 也没挂载，等于跨机器交接就丢。

素材实测规模：**435 个文件 / 134.6MB** = 1 份 `mapping.js`（12.7MB）+ 434 张书籍裁图（159 个 `.png` 117MB + 275 个 `.svg` 5.4MB）。`mapping.js` 里 `.svg` 被引用 8186 处、`.png` 600 处，所以 SVG 必须一起走这条通道。

### 1. `.atopack` 资料包：新段 `mixedMediaFiles`

- 新建 `asset-studio/app/mixed_media_resources.py`（照 `cryptic_resources.py` 的写法）：`MIXED_MEDIA_DIR` / `MAPPING_TARGET` / `IMAGES_DIR` / `IMAGE_SUFFIXES`（后缀白名单唯一来源）/ `allowed_target` / `mime_for` / `collect` / `collect_library` / `add_to_archive` / `checked_bytes` / `import_resources`。
- 路径白名单与渲染器 `renderer.js` 的 `pathOK` **逐字一致**：`story/assets/mixed-media/images/c[1-5]/[a-z0-9][a-z0-9_-]*\.(?:png|svg)`，外加唯一允许的 `mapping.js`（实测 434 个文件名全部合规）。上限：`mapping.js` ≤ 32MB、单图 ≤ 8MB、裁图 ≤ 2048 张。
- 接线：`build_fan_pack.py`（`--no-mixed-media`、段与 `build.mixedMediaIncluded`、`load_incremental_index` 与 `verify_partial` 的段列表、统计输出「混合媒体 : N 个文件」）、`installer.py`（导入时落回 `story/assets/mixed-media/`）、`packages.py`（导出/清点/导入统计键 `mixed_media_*`）。
- 一处容易踩的坑：裁图里有 `.svg`，而 installer/packer 的「界面图标」分支是裸后缀判断，所以混合媒体分支必须**排在图标分支之前**，否则 SVG 会被判成 `assets/icons/` 图标而拒收（两处都已前置并注释）。
- 新增测试 `asset-studio/tests/test_mixed_media_resources.py`（16 项：白名单合法/非法、后缀白名单单点收敛、收集排序、上限、四个回退来源、篡改检测、导入落回、往返与增量复用）。

### 2. APK 导入名单（`atopack-catalog.json`）

- `asset-studio/app/fixed_catalog.py` 新增 435 条「故事书混排素材」登记（1 条映射表 + 434 条裁图，`capture_required=False`，登记时逐条 `assert allowed_target(...)`，`sort_order` 用事先核实空闲的 60000 段）；清单 2841 → **3224** 条，登记面 4363 → **4746**。
- 为什么写死 434 个文件名而不是遍历磁盘：CI（`resource-import-regressions.yml`、`android-release.yml`）在**干净检出**上跑 `tools/test_android_resource_catalog.py`，而 mixed-media 是 `.gitignore` 的私有目录，扫盘会让 CI 里条目变 0 而报错；仓库既有先例是 19 首 BGM 同样写死。为防名单掉队，测试里加了**磁盘同步断言**（目录存在时用 `allowed_target` 过滤磁盘文件与名单比对，干净检出自动跳过）。
- `tools/test_android_resource_catalog.py`：删掉「C5 版图 8 张 / C5 补充页 21 页」断言，改为断言这些路径**不在**名单里，并新增混排素材断言（435 条 = 1 + 434、逐条白名单、不得含 `renderer.js` / `styles.css`）。

### 3. Docker 挂载

- `tools/test_docker_mounts.py` 本来就从固定清单反推「每个素材面都必须被某个挂载点覆盖」，加了登记之后它立刻报 `资料包素材没有挂载点覆盖：/app/story/assets/mixed-media/images/c5/icon-hull.svg` —— 缺口被测试抓了个正着。
- 修复：`tools/packaging/docker/compose.yaml` 增加 `./app/story/assets/mixed-media/images:/app/story/assets/mixed-media/images:ro` 与 `mapping.js` 单文件挂载（`bind.create_host_path: false`，避免文件缺失时 Docker 建同名目录顶掉挂载点）；`compose.legacy.yaml` 同步同两个目标（v1 用短语法，注释说明 mapping.js 必须先是文件）；`tools/install-docker.sh` 建裁图目录并写 mapping.js 占位文件；`tools/export_portable.py` 的 Docker 包同样建目录与占位文件。
- 只挂素材那一层，不整目录挂 `mixed-media/`：同目录的 `renderer.js` / `styles.css` 是程序代码，整挂会让宿主机目录遮住镜像里的新版本（仓库里 `ss/`、`assets/bgm/` 都有同样的教训）。
- `tools/test_docker_mounts.py`、`tools/test_docker_installer.py`、`tools/test_docker_package_license.py`、`tools/test_packaging_exclusions.py`、`tools/test_android_atopack_import.py` 全部通过。`tools/test_docker_runtime.py` 需要本机 Docker，本机没装（`FileNotFoundError`），未执行。

### 4. 校验工具增强

`asset-studio/tools/check_pack.py` 增加「混合媒体 : N 个文件（私有映射表 + M 张书籍裁图）」统计行，并让 `--hash` 顺带核对密语字形段与混合媒体段每个成员的 SHA-256（之前只核对清单图片）。

## 四、增量重打资料包

命令（仓库根目录）：

```
asset-studio/.venv/Scripts/python.exe asset-studio/tools/build_fan_pack.py \
  --ato-root . \
  --output export/ATOassets-民间版-3.5.4-q85-2026-10-05.atopack \
  --incremental-from export/ATOassets-民间版-3.5.2-q85-2026-10-04.atopack \
  --image-quality 85 --image-quality-keep-file asset-studio/pack-shrink-keep.txt \
  --verify full
```

先在同样的参数下跑了一次 `--dry-run`（1 秒）确认计划：条目/图片 3241/4309、混合媒体 435、成员 4883。

第一次结果（耗时 8 分钟，日志 `tmp/mixed-media-pack/build.log`）：1544.9 MB、成员 4883、增量复用 4443、与底包差异 **+435 / −52**、`--verify full` 比对 4309 个哈希通过；独立校验 `check_pack.py --crc --hash` 报「包是完整的」（4309 张图 + 密语字形 84 + 混合媒体 435 的 SHA-256 全部一致、CRC 全对）。

**最终结果**（战斗版图整棵退场后重打，日志 `tmp/mixed-media-pack/build2.log`，耗时 14 分钟）：

- 产物：`export/ATOassets-民间版-3.5.4-q85-2026-10-05.atopack`，**1535.7 MB**（22:24:45 写完，无 `.partial` 残留）。
- 成员 **4862**，增量复用 **4422** 个成员，`--verify full` 比对 **4288** 个哈希通过；条目/图片 3220/4288。
- 与底包差异：**新增 435 个成员**（混合媒体）、**移除 73 个成员**（52 + 21 张战斗版图）；底包没有 `mixedMediaFiles` 段。
- 独立只读复核（`tmp/mixed-media-pack/verify-pack.py`，日志 `verify-pack-final.log`）：段计数 resourceFiles 1 / bgmFiles 19 / iconFiles 30 / crypticFiles 84 / mixedMediaFiles 435 / storyFiles 1；裁图 1 份映射表 + 434 张（159 png + 275 svg）；抽查成员 sha256 与字节数一致；**任何 `story/images/battles/` 与 `story/images/c5/supplement-pages/` 的成员或段登记都已不在包里**；包内 `story/data/*.js` 四个成员与磁盘逐字节一致、正文里 `supplement-pages` 出现 0 次。
- 仍未做（可选）：最终这一版还没有跑一次完整的 `check_pack.py --crc --hash`（上一版跑过、结论完整；这一版只过了构建器自带的全量校验与我这份只读复核）。

命名用了当前应用版本 `3.5.4`（`assets/update/app-version.js`）与当天日期；旧的民间版包（3.5.2 / 2026-10-04）可以保留作回退，也可以删掉腾出 1.4GB。

## 五、OO 章节配图搬到 story/assets（本次只移动、未重打包）

- 移动：`story/images/OO/DY1P5.png`、`DY2P5.png`（157.86KB / 131.52KB）→ `story/assets/OO/`；`story/images/` 随之变空并删除（移动时先多套了一层 `assets/OO/OO/`，已拉平）。
- 同步改掉的引用（8 个文件）：
  - `story/data/storybook-data.js`：c1.5 / c2.5「导言」条目的 `image` → `./assets/OO/DY1P5.png`、`./assets/OO/DY2P5.png`（脚本 `tmp/mixed-media-pack/move-oo-in-data.cjs`，备份 `backup-storybook-data-before-oo-move.js`；改完解析校验通过）。
  - `tools/import-storybook-pdf.py`：两处 `preface_image`（否则重新导入会把旧路径写回去）。
  - `asset-studio/app/fixed_catalog.py`：两条「章节配图」登记的 faces 路径 + 相关注释。
  - `asset-studio/app/installer.py`、`asset-studio/tools/build_fan_pack.py`：注释里把 `story/images/OO/*.png` 的例子换成新路径。
  - 测试：`story/tests/c5-battle-boards.test.cjs`（改成断言 `story/images/` 不存在、`story/assets/OO/` 恰好两张、两个导言条目的 `image` 指向新路径且文件存在）、`asset-studio/tests/test_mixed_media_resources.py`、`asset-studio/tests/test_cryptic_resources.py`（安装目标样例换新路径）。
  - 文档：`tools/packaging/docker/README.txt`。
- Docker 链路（这是移动带来的真实缺口，`tools/test_docker_mounts.py` 立刻报 `资料包素材没有挂载点覆盖：/app/story/assets/OO/DY1P5.png`）：`tools/packaging/docker/compose.yaml` 与 `compose.legacy.yaml` 各加一条 `./app/story/assets/OO:/app/story/assets/OO:ro`；`tools/install-docker.sh` 建目录；`tools/export_portable.py` 的 Docker 包预处理目录加上 `story/assets/OO`。
- 验证：`tools/test_docker_mounts.py`（转绿）、`test_docker_installer.py`、`test_docker_package_license.py`、`test_packaging_exclusions.py`、`test_android_resource_catalog.py`（4826 条映射）、`test_android_resource_catalog_coverage.py` 全部通过；asset-studio 全量 **177 项 OK（1 skipped）**；story 套件 **84/84**；清单面盘点 **3203 条 / 4725 面 / 缺失 0**，分桶变成 `story/assets/OO 2/0`；浏览器实测 c1.5 / c2.5 导言图从 `./assets/OO/` 解码成功、旧路径 0 次请求、0 报错。
- **注意**：按用户要求这次**没有重打包**。当前磁盘上的 `.atopack`（22:24:45）仍是移动前的口径：里面有 2 个 `story/images/OO/*.png` 成员、没有 `story/assets/OO/*`。下次重打时（同第四节命令，增量即可）会自然变成「移除 2、新增 2」。

### 三条链路的目录口径核对（2026-10-05 收尾）

用 `tmp/mixed-media-pack/check-story-channels.py`（只查故事书素材，Docker 覆盖沿用仓库 `tools/test_docker_mounts.py` 的解析器）核对五处：磁盘、atopack 成员、Docker 挂载覆盖、`install-docker.sh` 建的宿主目录、APK 名单。

- `story/assets/OO`（2 个面）：磁盘 2/2 ✓、Docker 覆盖 2/2 ✓（`./app/story/assets/OO:/app/story/assets/OO:ro`，宿主目录由安装脚本建出 ✓）、APK 名单 2/2 ✓（实测导出的 `atopack-catalog.json` 里有 `story/assets/OO/DY1P5.png`）；**atopack 成员 0/2 ✗ —— 包比树旧，需重打才会同步**。
- `story/assets/mixed-media`（435 个面）：磁盘 435/435 ✓、Docker 覆盖 435/435 ✓、APK 名单 435/435 ✓、atopack 段 `mixedMediaFiles` 435/435 ✓。
- `story/assets/cryptic`（84 个面）：磁盘 84/84 ✓、Docker 覆盖 84/84 ✓、APK 名单 84/84 ✓、atopack 段 `crypticFiles` 84/84 ✓。
- 已退场路径：APK 名单里 `story/images/**` **0 条** ✓（实测导出），`story/images/battles/` 与 `story/images/c5/supplement-pages/` 在包内成员与段登记里也都 0 条 ✓。

结论：**Docker 与 APK 的目录口径是对的；atopack 的配置口径（清单/成员路径规则）也是对的，只有已经打好的那个包因为移动发生在打包之后而落后一步**（装上那个包会把 OO 路径连同正文一起还原成旧布局）。

## 六、未完成与已知缺口

- 正式发布包（便携版 / APK / Docker 镜像）未构建：本轮只重打了资料包，且 OO 移动后的重打被明确推迟。
- OO 移动后的资料包重打（见第五节末尾的说明）：等需要时按第四节命令跑一次增量即可。
- C1/C2 原页重栅格化未做（本机缺 `c1-original.pdf` / `c2-original.pdf`）。
- `tools/test_docker_runtime.py`（真实容器运行）需要 Docker，本机没有装。
- Android 真机/模拟器与实体第二屏仍未验证（本机无 AVD）。
- 素材库网页导出的「混合媒体」勾选框默认勾上，每次网页导出会多带约 134MB（不想要就手动取消）。
- 测试里的一条合成样例注释已名不副实：`asset-studio/tests/test_cryptic_resources.py` 用 `story/images/battles/c1/001.jpg`（不落盘的纯字符串样例）验证「story/ 下的图片目标可通过」，保留未改。
