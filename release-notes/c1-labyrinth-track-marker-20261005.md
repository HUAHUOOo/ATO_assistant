# 迷宫机牛 / 吞域兽：boss 大卡上的大迷宫轨道红圈

日期：2026年10月5日。工作目录：`D:\desktop\ATO_assistant`。

反馈：boss 面板上看不出「大迷宫指示物现在压在哪一格」。要求做成尼采超人 / 独眼巨人那种红圈，点一下换一格。

规则依据（两张卡面上的原文，就是截图里红圈那圈）：

- 附加战斗设置：将迷宫指示物放置在右侧大迷宫轨道最上方的一格。
- 大迷宫X：放置 X 枚大迷宫轨道上指示物所标记类型的大迷宫板块，放置在始徒前方，且与始徒相邻。然后将指示物顺时针移动到轨道上下一个类型上。

## 做法

- 新增轨道数据 `labyrinthTrackTracks`（`aibp/index.html`）：迷宫机牛、吞域兽各 4 格，**从最上方那格起顺时针**，坐标为面板宽/高的百分比（照 `ps/LABYRINTHAUROS/LABYRINTHAUROS.jpg`、`ps/ALPHA_TEMENOS/ALPHA_TEMENOS.jpg` 逐格量出）。

  | 顺序 | 迷宫机牛（left, top） | 吞域兽（left, top） | 圈宽 |
  | --- | --- | --- | --- |
  | 1 上方 | 92.4%, 6.1% | 85.8%, 80.9% | 5.6% / 5.0% |
  | 2 右方 | 96.2%, 10.9% | 90.7%, 86.9% | 同上 |
  | 3 下方 | 92.6%, 16.3% | 86.0%, 94.2% | 同上 |
  | 4 左方 | 88.1%, 10.9% | 80.3%, 87.5% | 同上 |

- 复用尼采 / 独眼巨人那套 `panel-state-marker` 浮层：`updateNietzscheStateUi` 里多一个 `labyrinth-track-marker` 类，宽度用面板宽度的百分比（`clamp(14px, 5.6%/5.0%, 140px)` + `aspect-ratio: 1`），所以任何显示尺寸都贴着印出来的格子，圈是正圆。
- 点一下（或点工具条上的 `nietzscheStateButton`）顺时针移一格，写进 `localStorage`：`aibp-labyrinth-track-v1-LABYRINTHAUROS` / `...-ALPHA_TEMENOS`；越界或坏值退回第 1 格（上方）。开局不预写 localStorage。
- 工具条按钮文字：`大迷宫指示物：O（1/4）`；圈的 tooltip：`Labyrinth O（大迷宫 O）：大迷宫轨道第 1/4 格，点击顺时针移到下一格`。
- 第二屏同步：快照新增字段 `labyrinthTrack`（只有这两个始徒非空），`ss/index.html` 的 `figure.boss-panel` 里加 `#bossLabyrinthTrack` 层，`ss/styles.css` 用同一份百分比画**只读**的红圈（点击仍然只在控制台做）。`ss/app.js` 的渲染 key 里也带上 `state.labyrinthTrack`，只改轨道格时第二屏不会卡在旧格。

## 验证

- 新增回归 `tests/aibp-labyrinth-track.test.cjs`（6 项）：顺时针顺序与类型、坐标落在卡图对应角落、四格互不重叠、点击前进/回卷/localStorage、坏值回退、控制台建圈三处接线、第二屏层与重绘 key。
- `node --test tests/aibp-*.test.cjs`：**114 项 0 失败**（含上述 6 项）。
- 真实浏览器（无头 Chrome + CDP，脚本 `tmp/labyrinth-track/browser-track.cjs`、`browser-ss-track.cjs`）：控制台实测圈心 = 92.4%/6.1%（迷宫机牛）、85.8%/80.9%（吞域兽），圈宽 = 面板宽的 5.6% / 5.0%，正圆；点一下后圈心 = 96.2%/10.9% 与 90.7%/86.9%，`localStorage` = 1，按钮文字变成 `大迷宫指示物：L（2/4）`。第二屏用打桩的 `campaignScreen.aibp` 快照渲染，圈心与圈宽与控制台逐项一致。
- 截图：`tmp/labyrinth-track/browser-labyrinthauros.png`、`browser-alpha_temenos.png`（点击前，圈在最上方一格）、`browser-*-after.png`（点击后）、`browser-ss-*.png`（第二屏）、放大图 `browser-lab-zoom.png`、`browser-tem-zoom.png`。

## 待你确认

- 轨道四格的**类型**是按卡面图标读的：2×2 方块 = O（Labyrinth O）、四连 = I（Labyrinth I）、三连 + 一格 = L、阶梯/Z 形 = Z。若实体卡上的顺序不是 **O → L → Z → I**（顺时针），只改 `labyrinthTrackTracks` 里每格的 `type` / `label` / `short` 即可，坐标不用动。

## 文件哈希

- `aibp/index.html`：`5af1a96bbb34215c5eebbe2ef08212a6ec31ae65c5bf615fe23aa5097ef6abb9`
- `ss/app.js`：`172cb2a8285a0ade3b7a7434352f8bf0e4976bf097c6c2bdedb414900a960a6e`
- `ss/index.html`：`39d896e4174939e744b55350b3003484e810bc74f718e4fb94ca8252af3607d2`
- `ss/styles.css`：`bb40d8a037a219e63035db901b6ac9fb9a15cc912c515df32af71732fb5d24ef`
- `tests/aibp-labyrinth-track.test.cjs`：`b3dd01e4ac46e4f851e0ecfa11657fe27230104883a11e414b1e64af4caa1afc`
