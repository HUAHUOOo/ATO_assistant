# 第二屏故事书：含版图的条目恢复双栏，图片缩小留在原位

> 后续追加：栏数改成按「字号能给到多大」自适应，战斗模块用三栏（见文末「追加：三栏」）。

反馈：第二屏显示故事书时，战斗模块（含版图 / 地形设置图的条目）不是双栏，还得下滑查看。

## 原因

第二屏正文的双栏来自 `ss/styles.css` 的 `.story-body { column-count: 2 }`，纯文字条目靠
`ss/app.js` 的 `fitStoryTextToViewport()` 二分字号缩到正好两栏、不用滚动。只要正文里挂出**块状
媒体**（战斗模块的 `terrain-diagram` 版图、地形设置图；铭文、字形这类块状小图同理），混排渲染器
会给容器加 `ato-mm-layout`（`story/assets/mixed-media/renderer.js`），而
`story/assets/mixed-media/styles.css` 里的 `.story-body.ato-mm-layout` 会把多栏整个退掉
（`column-count/column-width: auto`）——因为 `.story-body` 是**定高 flex 项**，继续当多栏容器
时，放不下的内容会往右分栏、被排到屏幕外（实测 1180px 视口 `scrollWidth` 7949px、约 7 栏，见
`release-notes/c45-items4-5-report-20261005.md`）。于是战斗模块一律变成「单栏 + 纵向滚动」。

## 改法

`ss/app.js`：

- 新增 `mixedStoryLayout()`（读 `ato-mm-layout`）与 `fitMixedStoryToViewport()`：含块状媒体的条目
  按**整屏放得下**二分字号（判定条件 `storyView.scrollHeight <= clientHeight`），字号写到容器
  行内样式且带 `!important`（要压过混排那条固定字号的规则）。
- `fitStoryTextToViewport()` 分流：含块状媒体时给 `.story-view` 加 `story-scroll` 并走上面的二分；
  纯文字条目摘掉 `story-scroll` 与那份行内字号，回到原来容器内的二分逻辑，行为不变。

`ss/styles.css`（选择器带 `.story-view.story-scroll` 才压得过混排那条规则）：

- `.story-body` 高度交给内容（`height: auto; overflow: visible`）、回到 `column-count: 2`，
  滚动改由外面那层 `.story-view` 承担——多栏只会把两栏拉高，永远不会再把内容排到看不见的栏里；
- 标题贴顶（`position: sticky`）并带底色，滚动时不被正文盖住；
- 块状媒体缩成正文里的小图：`max-height: 13em`（随字号一起缩放，二分才有单调性），点图仍走
  混排渲染器的放大窗口；
- 该模式下 `line-height` 从 1.75 收到 1.6：正文里有大量原书分段空行，收紧一点能让二分找到更大的
  字号。

> 中途试过「正文 | 版图」左右分栏（把版图搬进侧栏），已按反馈废弃：版图要留在正文对应位置。

## 验证（真实浏览器，无头 Chrome + CDP，走真实 `ss/app.js` 路径）

脚手架 `tmp/ss-check.html` + `tmp/ss-check.cjs`（用合成响应顶掉后端，其余复用 `ss/index.html`
的脚本与 DOM），截图 `tmp/ss-check-shots/`，数据 `tmp/ss-check.out.json`。

1920×1080：

| 条目 | 改动前（单栏，22px） | 现在 |
| --- | --- | --- |
| 迈达狮之战（1387 字，2 张版图） | 需滚 4.21 屏 | 双栏 13px，**不用滚动**，版图 221×169 |
| 战斗：今日之后再无迷阵（2108 字，1 张版图） | 需滚 6.04 屏 | 双栏 10px，需滚 1.16 屏，版图 180×130 |
| 严酷真相之战（2724 字，1 张版图） | 需滚 5.66 屏 | 双栏 10px，需滚 1.07 屏，版图 177×130 |
| 铭文条目 c1-0-8（小块状图） | 单栏滚动 | 双栏 22px，不用滚动，小图保持原尺寸 |

- 1366×768 / 390×844 同样**没有横向溢出**（`scrollWidth == clientWidth`），内容再长也只会纵向滚动；
- 控制台 0 error；点版图仍能打开放大窗口（标题、原书页码、图源与 mapping 一致）。

回归：

- `node --test --test-isolation=none story/tests/*.test.cjs`
- `node tools/test-second-screen-story-snapshot.cjs`
- `node --test --test-isolation=none tests/*.test.cjs`（含 `tests/lan-save-regressions.test.cjs`
  里 `openStory` 切片上下文补上本次改动引用的模块级变量）
- 新增 `story/tests/second-screen-story-columns.test.cjs`（5 项）：整屏二分取最大可读字号、纯文字
  条目摘掉 `story-scroll` 与行内字号、保留/重置滚动位置、样式表两栏与 em 上限、滚动交给外层容器。

## 已知取舍

- 最长的那几个战斗条目（2000 字以上）在 1080p 上仍要滚约 1.1 屏：正文里的原书分段空行本身就很占
  高度，双栏也已经用满；图片不再是主因（每张只有 130–170px 高）。
- 可调旋钮：图片上限 `13em`、行高 `1.6`、字号下限 `10px`（与纯文字条目一致）。若更看重可读性，
  把下限提到 12–14px 会牺牲一点滚动量；宽屏也可以考虑三栏。

## 追加：三栏（同日）

反馈：战斗模块从双栏改成三栏；另外如果故事过长、三栏能让字号变大，也切三栏。

先量再改——同一批条目分别按 2 / 3 / 4 栏跑一次页面自己的字号二分（1920×1080）：

| 条目 | 2 栏 | 3 栏 | 4 栏 |
| --- | --- | --- | --- |
| 迈达狮之战 | 13px ✓ | **17px ✓** | 18px ✓ |
| 今日之后再无迷阵 | 10px ✗ | **11px ✓** | 13px ✓ |
| 严酷真相之战 | 10px ✗ | **11px ✓** | 13px ✓ |
| 铭文条目（短） | 22px ✓ | 22px ✓ | 22px ✓ |

改法（`ss/app.js` + `ss/styles.css`）：

- 栏数走 CSS 变量 `--story-columns`（默认 2），两个模式（含块状媒体 / 纯文字）的量法不变；
- `storyColumnChoices()`：够宽（正文 ≥ `storyThreeColumnMinWidth = 900px`）才把 3 栏纳入候选，
  手机竖屏仍然两栏；
- `searchStoryFontSize(count, measure)`：按某个栏数二分字号；
- `fitStoryTextToViewport()` 把候选栏数各量一遍，**谁的字号大用谁**；字号一样大时，只有挂了
  **版图**（`terrain-diagram` / `battle-map`，即战斗模块）的条目优先三栏，其余（纯文字、铭文
  这类小块状图）保持两栏，阅读节奏不变。

真实浏览器（1920×1080，改动前 → 改动后）：

| 条目 | 改动前 | 改动后 |
| --- | --- | --- |
| 迈达狮之战 | 2 栏 13px，不用滚 | **3 栏 17px**，不用滚，版图 289×221 |
| 今日之后再无迷阵 | 2 栏 10px，要滚 1.16 屏 | **3 栏 11px，不用滚** |
| 严酷真相之战 | 2 栏 10px，要滚 1.07 屏 | **3 栏 11px，不用滚** |
| 铭文条目（无版图） | 2 栏 22px | 2 栏 22px（不变） |
| 三例 @390×844（手机竖屏） | 2 栏 | 2 栏（宽度不够不试三栏） |

回归：`story/tests/second-screen-story-columns.test.cjs` 从 5 项扩到 9 项（三栏更大字号就用三栏、
打平时版图条目用三栏 / 非版图保持两栏、纯文字两种情形、窄屏不试三栏、两个栏数都要量过）。

