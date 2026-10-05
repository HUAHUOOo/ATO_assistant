# C2 民间版战斗正文：按官方版内容补入，措辞与 boss 名改用民间译法

日期：2026年10月5日。工作目录：`D:\desktop\ATO_assistant`。

用户要求：「C2民间版战斗也改成官方版部分，但是boss名称等措辞改成民间版」。

背景：`c2-730`…`c2-734` 五场战斗在民间数据里**只有条目骨架、正文长度为 0**（上游民间翻译没翻这五场），所以民间版战斗页一直是空的，连行内版图也无处可挂（上一轮 C1–C3 民间版补图时，这 36 处官方占位只能保持纯文本）。官方数据里这五场是完整的。

本次把官方正文补成民间版：**内容、规则、数值、表格与官方版逐项一致**，**术语与 boss 名改用民间译法**，并把由此解锁的版图挂回民间版。

## 结果

| 项 | 结果 |
| --- | --- |
| 补入正文的条目 | **5**：`c2-730` 独眼巨人之战、`c2-731` 蠕变奇美拉之战、`c2-732` 重担之战、`c2-733` 残酷说教之战、`c2-734` 你是什么？之战 |
| 正文长度 | 1089 / 2664 / 3451 / 3557 / 1199 字 |
| 新增民间版映射行 | **+49**（C2 战斗版图 36 + 这些条目里的资源图标 13） |
| 民间版映射总量 | 2907 → **2956** 行（1410 条目，0 issue） |
| 仍未挂图的官方占位 | 94 → **50**（只剩民间正文确实没有对应写法的资源图标） |

五场的行内版图现在都在民间版显示：`c2-731` 8 张地形板块 + 2 张等级布置图，`c2-730/732/733/734` 各对应 4/5/6/7 张板块 + 1 张布置图，加上末日/阿尔戈号命运等资源图标。

## 措辞对照（官方版 → 本次民间版）

| 官方版 | 民间版 |
| --- | --- |
| 战斗：无眼巨人 | 独眼巨人之战 Cyclonus Battle（boss：**独眼巨人 (Cyclonus)**） |
| 战斗：扩散嵌合体 | 蠕变奇美拉之战 Chimera Metastasios Battle（boss：**蠕变奇美拉 (Chimera Metastasios)**，正文中的简称 **奇美拉 (Chimera)**） |
| 战斗：巨石 | 重担之战 Burden Battle（boss：**重担 (Burden)**；特性名保留原样「难以推动的巨石」并加英文 Unstoppable Boulder） |
| 战斗：残酷一课 | 残酷说教之战 The Cruel Lesson Battle（正文里沿用民间故事页的 **残酷教训 (Cruel Lesson)**；boss 为 **尼采 (Nietzsche)**） |
| 战斗：你们是谁？ | 你是什么？之战 What Are You? Battle（boss：**尼采 (Nietzsche)**） |
| 骇物 / 骇物面板 / 骇物站位 | 始徒 (Primordial) / 始徒表 / 2: 始徒 (Primordial) 位置 |
| 战前简介 / 余波 / 落败 / 撤退（无法撤退） | 介绍 / 后果 / 失败 / 撤退：不可能 |
| 奖赏与惩罚 / 命运潮汐 / 三曲盘 | 奖励和惩罚 / 命运之潮 (Tides of Fate) / 三幅节 (Triskelions) |
| ［末日］/［阿尔戈号命运］/［阿尔戈号知识］ | 灾祸指示物 (Doom Token) / 阿尔戈号命运 (Argo Fate) / 阿尔戈号知识 (Argo Knowledge) |
| 板图 / 板图边界 / 板图列 | 棋盘 / 版边 (Board Edge) / 棋盘列 |
| 伤口堆 / 部位卡牌 / 部位III / 关键暴击 | 损伤堆 (Wound Stack) / BP 卡 / BP III / 重创 |
| 进化轨 / 战斗记录轨 | 进化轨迹 / 战斗轨迹 |
| 不毁 / 无垠 / 拴绳 | 不可摧毁 (Indestructible) / 无垠 (Boundless) / 拴绳 (Tether) |
| 船育泰坦 / 泰坦柱廊 / 势力城市 / 剧情卡牌 | 人造泰坦 (Argo-bred Titan) / 泰坦柱廊 (Titan Stoa) / 派系城市 / 故事卡 (Story card) |
| 旧忆卡牌 / 旧忆节点 / 航标梦境事件 | 记忆卡 (Mnemos card) / 记忆节点 (Mnemos node) / 法洛斯之梦 (Dream of Pharos) 事件 |
| 斯巴达河道工程 / 固防城市 / 圆柱 / 神浆池 / 小片悬崖 / 阿尔戈号船体 / 脆弱者坟场 | 斯巴达河道工程 (Spartan River Works) / 固防城市 (Fortified City) / 柱子 (Column) / 神浆池 (Ambrosia Pool) / 小型悬崖 (Small Cliff) / 阿尔戈号船体 (Argo Hull) / 弱者的集落 (Graveyard of the Frail) |

板块清单、等级标题、编号风格也跟民间版既有战斗统一（`3 x 名称 (English) 1x5`、`1-2 级` / `3 级+`、`1: 标准准备：…（参见规则书，第 34 页）`）。

## 数据与代码改动

- `story/data/storybook-data.js`（本地私有）：补入上述 5 条 `text`；文件版本不变（仍是 4556 条目），新增顶层 `adaptedBattleTexts` 说明块，写明这五条来自官方正文、改动依据与日期，避免后人误当成原民间译本。
- `story/assets/mixed-media/mapping.js`（本地私有）：重新生成 C1–C3 民间版映射（2956 行），C2 战斗行的 `semanticLabel`/`alt` 也换成民间 boss 名（弹窗标题、复制文本、放大按钮标签都跟着改）。
- `story/index.html`、`ss/index.html`：`storybook-data.js`、`mapping.js` 缓存参数提到 `?v=20261005-c2-battle1`。
- 生成器（`tmp/c13-fan/generate.cjs`）两处改进：等级/首块两种「图在清单前」的官方锚点分别对应到民间的等级标题与第一个板块项；C2 图注按民间 boss 名重写。
- `story/tests/c13-fan-media.test.cjs`：数量基线更新，并把原来「C2 战斗没有民间正文」的用例改成「C2 战斗必须用民间措辞且能挂图」的用例（boss 名、必要章节、官方独有词汇不得残留、49 处版图锚点存在）。
- `story/tests/mixed-media.test.cjs`：总量基线 8341 → **8390**。

## 验证

- **结构比对**（`tmp/c2-battle/check-adapted.cjs`）：五条的**数字多重集**与官方正文完全一致（仅两处刻意的措辞改写：`部位1/2/3` 表头 → `BP I/II/III`、`1个航标梦境事件` → `一个法洛斯之梦事件`）；**数字型表格数据行逐行相同**；官方章节一个不少；官方独有词汇零残留。
- **渲染器全量复核**（`tmp/c13-fan/verify-merged.cjs`，读盘后的映射）：民间 **1410 条目 / 2956 行**全部解析、0 issue、0 重叠；官方 **1424 条目 / 3008 行**、0 issue。
- **测试**：`c13-fan-media`、`inline-icon-svg`、`entity-bio-data`、`story-pipe-tables`、`official-entry-index`、`second-screen-story`、`speech-version`、`battle-aibp-links`、`c4-story-revision` 共 **50 项通过**；`mixed-media` 全量分支用例（8390 行 × 主屏/第二屏）另行重跑。
- **真实浏览器**（`tmp/c2-battle/browser-c2.cjs`，headless Chrome + CDP）：五场战斗在民间模式下正文长度 1073–3443 字、挂图 **8/13/10/10/8 = 49 张**（与映射完全一致）、板块/介绍/战斗设置章节齐全、boss 名与板块名都是民间译法、无失败请求。截图 `tmp/c2-battle/c2-fan-c2-731.png`（双等级板块 + 两张布置图）。

## 补充：删掉 C2 战斗里对原书整页扫描的引用（同日）

这五条原本还带着旧渲染器留下的字段：`"images": "./images/battles/c2/<战斗名>"` 与 `"imagePages": N`（把 `<base>-1.png`…`<base>-12.png` 当整页扫描铺出来）。查证：**当前应用没有任何代码读 `imagePages`**；`entry.images` 只在「AI 译文补充」渲染器里用，而那要求条目带 `originalText`，这五条没有——也就是说这两个字段早已是死数据（`c2-734` 的路径还拼成了「这是什么？之战」，与标题「你是什么？之战」都对不上，进一步说明是陈旧的）。

既然现在有正文和行内版图了，就按用户要求去掉引用：

- `story/data/storybook-data.js`：五条移除 `images` 与 `imagePages`，新增 `removedBattlePageScans` 说明块记录这件事；数据里已无任何 `battles/c2` 引用。
- 对应扫描件 `story/images/battles/c2/*.png`（**23 个文件、26.56 MB**）已无引用，按用户"不要再引用"的要求**移出工程**，暂存在忽略目录 `tmp/c2-battle/removed-c2-battle-scans/`（要彻底删除跑 `node tmp/c2-battle/park-c2-scans.cjs --purge`）。
- `story/index.html`：`storybook-data.js` 缓存参数提到 `?v=20261005-c2-battle2`。
- `story/tests/c13-fan-media.test.cjs`：C2 用例加断言——这五条不得再有 `images` / `imagePages` / `imageList`。

验证：数据加载正常（五条正文长度不变、字段为空）；浏览器重跑五场战斗全部正常（挂图 8/13/10/10/8，无失败请求，也没有任何整页扫描请求）；`c13-fan-media`、`inline-icon-svg`、`entity-bio-data`、`story-pipe-tables`、`official-entry-index`、`second-screen-story`、`speech-version`、`battle-aibp-links`、`c4-story-revision` 共 **51 项通过**。

## 说明与限制

- 这五条正文是**官方正文改写**，不是原民间译者手笔：规则与数值照官方，遣词按民间译法（含英文括注）。数据文件里已标记来源。
- `c2-733` 正文里的「残酷教训 (Cruel Lesson)」与条目标题「残酷说教之战」并存：标题沿用民间数据既有条目标题（页面显示的是它），正文沿用民间故事页里的叫法（`c2-0-7` 等 8 处都写「残酷教训」）。
- 人物索引 `story/data/entity-index.*` 是机器生成物，本次**未重新生成**：新增正文里的实体仍能被页面按别名标注，只是这些条目不会出现在人物小传的「段落」列表里。要补齐可重跑 `tools/generate-story-entity-index.mjs`。
- 五场战斗的**底部整页版图**本来就没有（C2 不在硬编码版图名单里），现在靠行内混排显示裁好的板块图与布置图。

## 相关文件哈希（SHA-256）

- `story/data/storybook-data.js`（本地私有）：`5649d5c0394dc05f8955e82934de260099a8d048be97a260975d6c47bc1bd83a`（改动前 `7dd7eda25d87f43441d2102f98e7eaca51dcb288906916a380075bc5d69c7d31`；补正文后、去引用前为 `499364450f71af80b16f6606dc44c36edc3e8347b755bd5a79160c80652d6430`）
- `story/assets/mixed-media/mapping.js`（本地私有）：`f4ebb57bd5d3ab40b881850b291be04dee7c34b129ceec7784eacbf285472302`（C2 战斗行重生成后的最终版）
- `story/tests/c13-fan-media.test.cjs`、`story/tests/mixed-media.test.cjs`：随基线更新（前者 `880abb3acd195d5dc4f7ca4815c2430a33626f87b776ccec392020e8999e147a`）

## 工具位置（`tmp/c2-battle/`，忽略目录）

- `fan-texts.json`：五条民间版正文的**权威副本**（写回脚本的输入）。
- `check-adapted.cjs`：结构比对（数字、表格、章节、词汇）。
- `apply-texts.cjs`：写回 `storybook-data.js`（改前自动备份到 `backups/`）。
- `browser-c2.cjs` 与 `c2-fan-c2-731.png`、`c2-fan-c2-732.png`：真实浏览器核对与截图。
- `off-c2-73x.txt`、`official-731-734.txt`：官方正文快照，便于逐句复核。
- 映射与图标同上一轮：`tmp/c13-fan/`（生成器、验证器、备份）。
