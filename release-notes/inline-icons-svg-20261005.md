# 行内图标改成 SVG：白底去掉、随文字大小缩放

日期：2026年10月5日。工作目录：`D:\desktop\ATO_assistant`。

用户要求：「图标的白颜色转换成透明，整体变成svg格式，可以随着文本大小变化尺寸」。此前行内图标是原书裁图 PNG，纸白背景留在图里，在页面纸色底上是一个个白方块；尺寸虽然已经是 em（随正文大小变），但位图放大会糊。本次把**所有行内图标**转成 SVG：纸白→透明，能矢量的矢量，尺寸继续用 em，因此在任何字号下都清晰。

## 做了什么

| 项 | 结果 |
| --- | --- |
| 转成 SVG 的行内图标 | **275** 个（C1–C5 全部 `layout: inline` 的图） |
| 其中矢量描摹（真 SVG 路径） | **133** 个：资源图标（命运/末日/进度…）+ 叙事雕文条 |
| 其中 SVG 内嵌位图 | **142** 个：地形板块图、部件图、用户 token（原书彩图，矢量化会失真） |
| 映射行改指 `.svg` | **8143** 行（官方 + 民间行都改，图片本身是同一张；C2 战斗行重生成后为 **8186** 行） |
| 保持 PNG 的块状图 | 159 个（雕文位置图、地图、大幅照片、横幅） |
| 映射里引用的图片路径总数 | 仍为 **434**（275 svg + 159 png），条目/行数完全不变 |

## 做法

1. **去白底**：以四边中位色为纸色，按通道差做软化过渡（<45 全透明、>130 全不透明），纸白——包括被墨迹包围的纸白——全部变成 alpha；图标本身画的白点/白环落在纸色按钮上仍读作白。
2. **矢量化**：只对墨迹字形（`resource-icon`、叙事行内雕文）做描摹——中位切分调色板取 2–5 色，2 倍上采样后 marching squares 取轮廓 + Douglas–Peucker 简化，每种颜色一个 `fill-rule="evenodd"` 路径（内孔自然保留）。分辨率提高后比原始扫描更干净。
3. **内嵌位图**：地形板块、部件图、用户 token 是原书彩绘，调色板化会糊成色块（已逐一目视对比），所以保留像素，只是装进 `<svg><image>` 并去掉白底。文件仍是 SVG、仍按 em 缩放，只是放得极大时会有位图感。
4. **每张图都带 `viewBox` + `width`/`height`**：渲染器在图片加载后会检查 `naturalWidth/naturalHeight`，没有内在尺寸会被当成坏图丢弃；尺寸用 CSS 的 em 覆盖（现有规则 `height:1.15em/1.35em/2.4em`），所以图标始终跟着正文大小走。
5. **渲染器只放开扩展名**：`pathOK` 由 `\.png$` 改为 `\.(?:png|svg)$`，其它校验（路径白名单、来源指纹、锚点、上下文）一个字没动。

## 程序改动

- `story/assets/mixed-media/renderer.js`：行内/块状图都允许 `.svg`（其它扩展名仍拒绝）。
- `story/index.html`、`ss/index.html`：`renderer.js`、`mapping.js` 缓存参数提到 `?v=20261005-svg-icons1`。
- `story/assets/mixed-media/mapping.js`（本地私有）：8143 行改指 `.svg`，`assetSha256`/`assetBytes` 按新文件重算，版本串追加 `-svg-icons1`，新增 `svgIconRevision` 元数据；顺带把上一轮追加民间行时不一致的缩进统一成文件原有的两空格规范。
- `story/tests/inline-icon-svg.test.cjs`（新增 4 项）：行内行必须是存在的、带 `viewBox` 的 SVG 且不含纯白填充、块状行仍是 PNG、SVG 数量冻结在 275、声明尺寸与 `viewBox` 一致、渲染器接受 `.svg/.png` 而拒绝 `.jpg`/`../` 之类、**行内图标按钮不带任何背景色**。
- 私有素材仍在 `.gitignore` 内；`tools/packaging/package_common.py` 与 `api/app-update-policy.php` 是按目录排除的，`.svg` 与 `.png` 一样不进发布包、在线更新也不会覆盖。

## 验证

- `node --test --test-isolation=none story/tests/*.test.cjs` → **79 项通过、0 失败**（新增 3 项；既有 76 项含「每条映射主屏 + 第二屏真实分支」把 8341 行逐行挂载、逐行比对失败回退）。
- 读盘后的映射用真实渲染器复算：民间 **1405 条目 / 2907 行**、官方 **1424 条目 / 3008 行**，均 0 issues、0 重叠——换 SVG 没有改变任何一行的解析结果。
- 真实浏览器（headless Chrome + CDP，`tmp/c13-fan/browser-svg-check.cjs`）：4 个条目 13/1/2/8 张图，其中 SVG 11/1/1/7 张，全部 `naturalWidth/Height` 非 0，**图片请求 22 个全部 200**，无 404。
- **随文字缩放实测**：把正文容器字号从 17px 改到 32px，同一枚图标从 21.6×19.6px 变成 40.7×36.8px（比例 1.88 = 32/17），证明尺寸完全由 em 驱动。
- 截图：`tmp/c13-fan/svg-icons-c1-15-0.png`（地形板块图标已无白方块，直接压在纸色底上）、`tmp/c13-fan/svg-icons-c1-0-0.png`（阿尔戈号命运图标随正文排在同一基线上）。
- 转换前后的对照页：`tmp/c13-fan/compare.html` / `compare.png` / `compare-terrain.png` / `compare-icons.png`（原图 vs SVG k=2..5）。

## 补充：行内图标不再自带纸色底（同日晚些时候）

用户看到民间版里 `命运之潮 (Tides of Fate)：阿尔戈号命运 -3` 那枚图标外面仍有一块**黄色方框**。排查：图片本身的白底确实已经去掉（截图取样：图标四周像素 = 页面底色 `#eef3f7`），黄框来自 **CSS**——`story/assets/mixed-media/styles.css` 里 `.ato-mm-button { background: #f8f2e6 }` 一直给每张混排图垫一层纸色（原意是"黑字在任何主题下都看得清"）。在非纸色的页面上，这层底就显成黄块。

改法：行内图标取消这层底，块状扫描图保留（它们是纸面扫描图，留一圈纸色是刻意的）：

```css
.ato-mm-inline .ato-mm-button, .ato-mm-resource .ato-mm-button { background: transparent; }
```

- `story/assets/mixed-media/styles.css`：新增上面这条规则；`@media (forced-colors: active)` 里的纸色兜底保留（Windows 高对比度下仍保证深色字形可见）。
- `story/index.html`、`ss/index.html`：样式表缓存参数提到 `?v=20261005-transparent-icons1`。
- `story/tests/inline-icon-svg.test.cjs` 新增第 4 项：行内图标按钮必须是 `background: transparent`，块图仍保留纸色底，两端页面都带缓存参数。

验证（headless Chrome + CDP）：
- 四个条目共 1/11/11/1 个行内图标，`getComputedStyle(button).backgroundColor` 全部为 `rgba(0, 0, 0, 0)`；块状图仍是 `rgb(248, 242, 230)`。
- 逐像素取样：把图标框裁出来（29×28 px），四角都是页面底色 `#f6f0eb`，除字形墨色（`#19241a`）外没有第二种背景色——即"没有纸色矩形"。
- 截图 `tmp/c2-battle/transparent-c1-0-0.png`、`transparent-c2-731.png`、`icon-crop.png`。

## 未做 / 限制

- **块状图仍是 PNG**：雕文位置图、地图、大幅照片这些按整块排版的图没有去白底（它们本来就该有纸面），也没矢量化。用户若要一并处理可以再说。
- 内嵌位图的 142 张（地形板块等）在极大字号下会有位图感——这是保真与矢量的取舍；如果更喜欢"完全矢量、允许色块化"，把 `tmp/c13-fan/to_svg.py` 的 `VECTOR_KINDS` 放宽重跑即可。
- 旧的 275 个行内 PNG 已被 SVG 取代、没有任何映射再引用，已按用户指示**从图标目录移走**（3.4 MB，暂存在忽略目录 `tmp/c13-fan/removed-inline-pngs/`，需要彻底删除时跑 `node tmp/c13-fan/prune-icons.cjs --purge`）。图标目录现在只剩 **159 个块状 PNG（117 MB）+ 275 个 SVG（5.4 MB）**。
- 转换脚本依赖本机 anaconda 的 Pillow/numpy/scikit-image/scipy；换机器交接时需要同样的环境（或直接带上已生成的 SVG）。

## 相关文件哈希（SHA-256）

- `story/assets/mixed-media/mapping.js`（本地私有；随后 C2 战斗行重生成，见 [C2 民间版战斗正文](c2-battle-fan-text-20261005.md)）：最终 `f4ebb57bd5d3ab40b881850b291be04dee7c34b129ceec7784eacbf285472302`（本轮 SVG 改指时 `6c44c06e1be8b660403b424467e25ca3ebdcbf52c9f8971c4a679ed53855a7c9`）
- `story/assets/mixed-media/renderer.js`（放开 `.svg`）：`df854d9407d4d6e79d926d4e3245511e1cf6d1a54212cdbd60a0ee3597020da4`
- `story/index.html`（缓存参数；随后透明底一轮提到 `20261005-transparent-icons1`）：`b300bf3525ee2471898dc1553f33a3a234d4daebeb68995ae29b4564a6e35560`
- `ss/index.html`（缓存参数；随后透明底一轮提到 `20261005-transparent-icons1`）：`8948473d7fee57852d019f5c55f6bcb57b39a15ed07348959641e16cd7059ed3`
- `story/tests/inline-icon-svg.test.cjs`（新增）：`c700c65f54c3e00bd5a84d248960ba8bc2153e249404d1d0d596073d39048a4e`（含"行内图标不带背景色"一项）
- `story/assets/mixed-media/styles.css`（行内图标透明底）：`3ace2a4dafb0962bede0487dca056b2fbcee87a3fe93d87fdc271f4a3d552070`
- 图标目录：275 个 `.svg`（5.63 MB）+ 434 个 `.png`（126.3 MB，其中 159 个仍在使用）

## 工具位置（`tmp/c13-fan/`，忽略目录）

- `to_svg.py`：转换器（去白底、调色板描摹、内嵌位图、`--list/--write/--only/--raster`）。
- `svg-rewire.cjs`：把映射行改指 `.svg` 并重算哈希（写回前自动备份到 `backups/`）。
- `flatness.py` / `flatness2.py` / `error-by-kind.py` / `quant-metrics.py` / `debug-quant.py`：判断哪些图适合矢量化时的量化误差与纹理统计。
- `compare.py` + `compare*.png`：原图 vs SVG 目视对照。
- `browser-svg-check.cjs`：CDP 浏览器校验（加载、内在尺寸、无 404、随字号缩放）与整页截图。

临时静态服务器（127.0.0.1:18901）只用于浏览器验证，验收后已关闭。
