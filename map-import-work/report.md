# 官方 `.jsave` 地图状态导入（v3.5.0 追加轮）——交付报告

日期：2026-10-04
背景：上一轮发布前发现真漏洞 —— 官方 `.jsave` 的 `maps[]` 只导了「棋子位置（`argo`/`advr`）+ 变体面（`alternative`）+ 最后到访城市」，**已探索（`expl`）/ 最新揭示（`revl`）/ 格笔记（`note`）/ 格上指示物（`toks`、`reward_token`）一个都没导**。用户导入后打开地图，80 格里 63 格本来已探索，却全部显示为未探索。

改动文件：`assets/jsave-import.js`（唯一实现改动）、`tests/jsave-import.test.cjs`（深比较范围 + 4 条新用例）、`index.html`（只改了 `jsave-import.js` / `jsave-tables.js` 的缓存号）、`release-notes/v3.5.0.md`。
**没有改**：`jsave-import/import_jsave.py`（已冻结、依赖被删的 `app-extract/official-tables.json`，跑不起来）、`data/`（只读）、`map/app.js`、`jsave-tables.js`。

---

## 1. `map/app.js` 里查到的确切形状（读代码，不猜）

一个循环的地图状态就是 `map.users.<桶>.cycles.<c>`，默认形状来自 `map/app.js:288-305` 的 `defaultCycleState()`：

| 键 | 类型 | 语义 / 写入点 |
| --- | --- | --- |
| `currentTile` | 字符串 | 阿尔戈当前格；`map/app.js:366` 会由 `tokens.AG` 回填 |
| `latestRevealedTile` | **单值字符串** | 「最近一次新翻开的板块」；只由 `markTileExplored()` 在**探索**时写（`map/app.js:612`），取消探索时清空（`:1759`） |
| `explored` | `{ "<tileId>": true }` | 已探索 —— 就是「地图上开了的格子」；`markTileExplored()`（`:609-610`）写 true，`toggleExplored()`（`:1758`）删键 |
| `previewRevealed` | `{ "<tileId>": true }` | 「已揭示但还没探索」（手动揭示）；`revealTilePreviewById()`（`:1801-1802`）写，`markTileExplored()`（`:611`）在探索时删掉 |
| `tileNotes` | `{ "<tileId>": "文本" }` | 格子笔记，**字符串**（不是对象）；`saveTileNote()`（`:1731-1735`），值为空串时删键 |
| `tileVariants` | `{ "<tileId>": "alternate" }` | 变体面 |
| `titanXTrackPosition` | 数字 \| null | 1..7（`normalizeTitanXTrackPosition()`，`:387-392`） |
| `tokens.AG` / `tokens.AD` | 字符串 | 阿尔戈 / 仇敌所在格 |
| `tokens.hsCount` | 数字 | 侦察船数量 |
| `tokens.markers` | `{ "<tileId>": { "<tokenId>": true } }` | 格上指示物（`last_city` / `last_oasis` / `last_silver_ruin` / `c5_*` / odyssey 补给 / `ENGIN` / `hs` …；`normalizeMarkers()` `:429-446` 会把不在 `tokenAssets` 里的 id 丢掉） |
| `tokens.edgeMarkers` | `{ "<tileId>": { "<tokenId>": ["up", …] } }` | 边指示物（`sandstorm`） |

两条派生结论：

* **总格数 / 已探索数都是派生字段，不落盘**：总数来自 `map/map-data.js`（c5 实测 80 格），已探索数是 `cycle.tiles.filter(t => cycleState.explored[t.id]).length`（`map/app.js:1268`，快照里是 `exploredCount`/`exploredIds`，`:2158-2160`）。所以本轮只写原始字典，不写任何计数。
* `tileId` 是 `"001"` 这种三位补零串，顺序就是 `map/map-data.js` 里 `cycle.tiles` 的顺序（c5 实测 `"001"`…`"080"`），官方 `maps[0][i]` 与它按下标对位。

真实存档形状（`data/ato-campaign-*.json`，只读）与上表一致，例如 `ato-campaign-1111.json` 的 c5：`explored` 8 格 + `tileVariants` 1 格 + `tokens.{AG,AD,markers}`；`ato-campaign-111111.json` 的 c4 同时出现 `explored={029}`、`previewRevealed={030}`、`tokens.AD="030"` —— **仇敌停在一张未探索的板块上时，那张板块就在 `previewRevealed` 里**（这条实测直接支撑了下面的 `revl` 规则）。

---

## 2. 改了哪些键（转换器行为）

`Converter.prototype.buildMapSection()`（`assets/jsave-import.js`）从「只产出 `tokens` + `tileVariants`」扩成产出 5 个键，`buildSections()` 把它们写进 `map.users.default.cycles.<c>`：

| 官方字段 | ATO 落点 | 本档（`campaign_0005(4).jsave`，c5，80 格） |
| --- | --- | --- |
| `expl` | `explored["<id>"] = true` | **63 格**（`001,002,003,004,006,007,011…080`） |
| `revl`（未探索的那些） | `previewRevealed["<id>"] = true` | **3 格**（`008`、`065`、`070`） |
| `note` | `tileNotes["<id>"] = "<原文>"` | **1 格**（`026` = `通用指示物`） |
| `argo` / `advr` / `alternative` | `tokens.AG` / `tokens.AD` / `tileVariants` | `AG="057"`、`AD="070"`、21 个变体（**与上一轮完全一致，没有动**） |
| `toks` / `reward_token` / `has_*` / `add_advr` | **不落位**，只进 `stats.map_detail.unmapped` | 见 §4 |

落位前提（任一不满足就**整个地图一个字段都不写**）：官方 `maps` 恰好一张、能读到 `map/map-data.js` 里该轮的 tileId 表、且**格数逐格一致**。原来的实现遇到「读不到格表」会退化成裸序号（`"57"` 而不是 `"057"`），会给 `explored`/`tileNotes` 造出一整套错的键，所以这一轮的守卫收紧了：**不许错位**（`stats.map_detail.note` 里给人话：`格数不符，未落位` / `读不到 map/map-data.js 里 c5 的格表…未落位`）。

`campaign_stats.city_tile → tokens.markers["NNN"].last_city` 与地图落位是**两条独立路径**，本轮没改：即使地图整体不落位，城市标记照旧按原来的规则写。

## 3. `revl` 语义结论

官方 `revl` 是**每格一个布尔**，本档 7 格为 true（下标 3/7/15/41/61/64/69 → id `004/008/016/042/062/065/070`），其中 4 格同时 `expl=true`（`004/016/042/062`），3 格未探索（`008/065/070`）。5 份样例里只有 `campaign_0005*` 这份有地图内容，`campaign_0001`（c2，96 格）、`campaign_0003(1)`（c4，81 格）、`campaign_0004`（c5，80 格）的 `expl`/`revl` 全 false。

结论与规则：

1. **它不是"最新揭示"的单值**。ATO 里的「最新揭示」是 `latestRevealedTile`，**单值字符串**，语义是"最近一次新翻开的板块"，由探索动作写入；官方的 7 个标志位既装不进一个字符串，也不带任何顺序信息。**所以不写 `latestRevealedTile`**（测试里断言它是 `undefined`），不编造顺序。
2. **它是集合语义的「已揭示」**，能装下的 ATO 键只有集合型的 `previewRevealed`（"已揭示但还没探索"，渲染时与 `explored` 一样显示正面）。规则：**`revl && !expl` → `previewRevealed`**。
   * 4 格 `expl=true` 的不写：它们的可见状态已经由 `explored` 覆盖，而且 ATO 自己在探索时会删掉同名键（`map/app.js:611`），写进去没有任何可见效果。
   * 这条规则在「曾经揭示过」与「当前已揭示未探索」两种读法下**结果相同**：无论 `revl` 是"一度揭示过（官方不会在探索后清掉）"还是"当前处于已揭示未探索"，需要额外表达的都只是「未探索 + 已揭示」那一部分。
   * 未探索的 3 格有独立旁证：`070` 就是仇敌所在格（`advr=true`），`065` 上有指示物（`toks[5]=true`），而真实 ATO 存档里仇敌停在未探索板块上时那张板块**正是**在 `previewRevealed`（`ato-campaign-111111.json` 的 c4：`explored={029}`、`previewRevealed={030}`、`AD="030"`）。

## 4. 没有导的官方字段（本轮明确不猜）

* `toks`：每格一个布尔数组，**长度随循环变**（c2 = 4 位、c4 = 7 位、c5 = 8 位）。本档 6 格有 true（`021` 的第 0+3 位、`026` 的第 1 位、`033/051/066` 的第 3 位、`065` 的第 5 位），**没有任何能把位序钉死的信息**：位 3 出现在 4 格上，说明它不是 `unique` 类指示物，但 c5 里非 unique 的候选就有 `last_silver_ruin` / `c5_atlantean_capital` / `c5_ruin` 三个，无法二选一；`026` 的笔记写着「通用指示物」，但同格的 `has_generic_token=false`，两条线索互相矛盾。猜一个位序 = 往用户图上放错指示物，所以**不落位**，只把「哪些格有」记进 `stats.map_detail.unmapped`（本档 6 格：`021`、`026`、`033`、`051`、`065`、`066`）。
* `reward_token`：**5 份样例里每一格都是默认值 `"Hull"`**，包括 `has_reward_token=false` 的格子 —— 照写会让 80 格全长出奖励指示物。真正的"放着没有"要看 `has_reward_token` / `has_generic_token`，而本档（以及全部 5 份有内容的样例）这两个都是 false，所以没有落位。名字到 ATO 指示物 id 的映射同样没有证据（`can_have_reward_token` 在 c2 有 31 格 true，但没一格真的放了）。
* `add_advr`：每格 2 个布尔，本档 `014=[false,true]`、`034=[true,false]`。ATO 只有一个 `AD` 位（`tokenAssets` 里 `AD` 是 `unique`），**额外仇敌没有落点** → 记进 `unmapped`。
* 顺带记录（本轮不改）：`evo.evo_boss_count` 已经算进 `stats.titanx_track_position`，但**没有被写进** `map.cycles.<c>.titanXTrackPosition` —— 上一轮遗留的缺口，不在本轮范围。

**为什么这些"未导入项"没有进 `record.notes` 的区块**：`record` 分区仍然要与冻结的 Python 参考快照逐叶子相同（本轮只获准排除 `map` 分区），往 `record.notes` 里加一行就会破坏那条验收。所以地图侧的未导入信息走 `convertWithReport().stats.map_detail.unmapped`（页面不展示，报告与测试可见），这一点写进了发布说明的「已知限制」。

## 5. 测试

改 `tests/jsave-import.test.cjs`：

* 深比较那条用例改为**排除 `map` 分区**后逐叶子 + canonical 逐行比较（`dashboard/record/technology/heroes` **一字未放宽**）；另加两条保险：① 分区键集合必须一致；② 把本轮新增的三个键从 JS 的 `map` 里摘掉后，必须与冻结参考的地图分区逐叶子相同（`tokens` 的 `AG/AD/markers` 与 21 个 `tileVariants` 一个字都不许变），且三个新键确实存在。
  * 原因（也写在测试注释里）：Python 原型已冻结且**不可重跑**（依赖被删的 `app-extract/official-tables.json`），地图分区自 v3.5.0 起由 JS 版扩展，故该分区改为专项断言覆盖；**没有手工改冻结参考**。
* 新增 4 条用例（9 → 13 项）：
  1. 已探索格与官方 `expl` **逐格对照**（断言本档 63 格、`expl=false` 的 17 格逐个断言没被写成已探索、两个集合的排序后 id 列表完全相等）；
  2. `revl → previewRevealed`（7 个 true 里只写未探索的 3 格 `008/065/070`，已探索的 4 格不许写，`latestRevealedTile` 必须是 `undefined`）、`note → tileNotes`（`{"026":"通用指示物"}`）；
  3. `toks` / `reward_token` / `add_advr` 不落位：`markers` 里只剩城市标记 `021`，6 个 `toks` 格上没有 marker，但 `map_detail.unmapped` 必须如实列出 `toks`（6 格）与 `add_advr`（2 格）；
  4. 格数不一致（79 格）/ 读不到格表 / 两张地图 → **一个地图字段都不写**，并给出人话；反向对照同格数时确实会写（防止"反正都不写"的假绿）。

**变异检验（证明新用例有牙）**：临时改坏实现跑一遍，4 种改法全部让用例变红并已还原 —— ① `expl` 不判 true（全格写成已探索）；② `revl` 连已探索的格子一起写；③ 去掉格数校验；④ 格笔记不写。

全量回归（`tests/*.test.cjs` 56 个 + `tools/test-*.cjs` 27 个 = **83 个文件**）：

```
node:test 文件 64 个：tests 601 / pass 601 / fail 0
纯断言脚本 19 个：18 通过，1 失败
失败：tools/test-dashboard-cycle-story-constants.cjs（既有，与本次无关：
      该脚本用 `function NAME(` 抽函数会丢掉 async 前缀，而 adversaryBattleHref 在 HEAD 里就是 async）
tests/app-update-client.test.cjs：在本环境（放开写权限）通过，不是回归
TOTAL files=83 failing=1
```

* `node tools/check-inline-js.mjs index.html` → **2 个内联脚本块解析、0 failed**。
* 本档转换结果（`convertWithReport`）：`explored` 63、`preview_revealed` 3、`tile_notes` 1、`variants` 21、`tokens {AG:"057", AD:"070"}` —— 与官方 `expl`/`revl`/`note` 逐格对得上。

## 6. 最不确定的两处

1. **`revl` 的确切语义（中风险，但规则对两种读法都成立）**。它是"曾经揭示过（官方探索后不清标志）"还是"当前已揭示未探索"，从 5 份样例无法判定；本次按"未探索 + 已揭示 → `previewRevealed`"落位，两种读法下可见结果一致。若将来能拿到官方 App 的行为证据表明 `revl` 其实是"本步新翻开"的历史集合，那么这 3 格会被多标成"已揭示"（可见后果：3 格显示正面，比"整张图全未探索"轻得多），修法只是把规则收紧成"最后一个"或干脆不写。
2. **`toks` 的位序（中风险，已选择"不猜"）**。长度随循环变（4/7/8），位含义无证据；代价是 6 个格子的指示物不会自动出现在 ATO 地图上（用户看得到"少了个 token"，可以手动补，报告与 `map_detail` 里列了是哪 6 格）。反过来如果硬按某个猜法写，用户会看到**错的**指示物 —— 那比缺更糟，所以按"不猜 + 如实记录"处理。
