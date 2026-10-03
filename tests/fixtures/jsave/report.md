# 官方 `.jsave` 导入：JS 移植 + 主控台接入（交付报告）

日期：2026-10-03
目标：让主控台 `index.html` 的「导入状态」除了 ATO 战役 JSON，还能直接吃官方 App 的 `.jsave`。

---

## 1. 改了哪些文件（含行号）

### 新增

| 文件 | 规模 | 作用 |
| --- | --- | --- |
| `assets/jsave-import.js` | 2303 行 / 107 KB | `jsave-import/import_jsave.py` 的逐字段 JS 移植版。暴露 `window.ATO_JSAVE_IMPORT`（同时 `module.exports` 兼容 node） |
| `assets/jsave-tables.js` | 160 行 / 37.5 KB | 数据表与转换器**拆开**：官方枚举顺序（86 货舱 / 41 hub / 15 阵营）、319 张科技卡的英文名、497 个装备卡号。值以 JSON 文本分段存，加载时 `JSON.parse` 一次 |
| `tests/jsave-import.test.cjs` | 378 行 | 9 条用例：内容判定、陈旧尾巴、与 Python 参考逐叶子深比较、导入入口分流、文案/accept、既有 JSON 路径未破坏 |
| `jsave-web/`（开发用，非页面依赖） | — | 参考文件生成与校验的脚本与产物，见 §5 |

`assets/jsave-import.js` 关键入口：

| 位置 | 内容 |
| --- | --- |
| `:27` | UMD 挂载 `root.ATO_JSAVE_IMPORT` |
| `:309` | `officialTables()` —— 取 `assets/jsave-tables.js`（浏览器走 `root.ATO_JSAVE_TABLES`，node 走 `require("./jsave-tables.js")`），读不到立刻抛错 |
| `:2023` | `Converter.prototype.buildSections` —— 五个分区总装 |
| `:2415` / `:2431` | `parseJsaveText` / `parseJsave`（含 `meta` 顶层标量扫描） |
| `:2450` | `isJsave` |
| `:2477` / `:2485` | `convert` / `convertWithReport` |
| `:2521` 起 | 括号/字符串感知扫描器 `scanJsonEnd` / `scanValueEnd` / `scanTopLevelScalars` |

### 修改

`index.html`（9422 行，原 9414 行）：

| 行 | 改动 |
| --- | --- |
| `:2452` | （未动，`map/map-data.js` 在前，转换器用它落地图瓦片） |
| `:2456-2460` | 新增 `<script src="./assets/jsave-tables.js">` 与 `<script src="./assets/jsave-import.js">`（tables 在前） |
| `:2352` | 「导入状态」按钮加 `title="可导入 ATO 状态包（.json）或官方 App 存档（.jsave）"` |
| `:2357-2358` | `importInput` 的 `accept` 放宽为 `application/json,.json,.jsave,application/octet-stream` |
| `:9091-9136` | **新增** `applyImportedSections()`：把原 `importStateFile` 里的 try 主体原样搬出来（`expectedRevisions` / `SAVE_CONFLICT` / 基线推进一字未改），两种来源共用同一条合并路径 |
| `:9140-9196` | `importStateFile()`：改成读**字节**（`readAsArrayBuffer`），先按内容判 `isJsave`，是 `.jsave` 就走 `parseJsave` → `convert` → `applyImportedSections`；不是就照走原来的 `JSON.parse` 分支 |

原来的 JSON 导入路径：判定式、`sections` 取值、`isFullBackup`、`dashboardImport` 回退、`importEntries` 过滤条件、`importCampaignSections` 调用与 `expectedRevisions` 计算**全部逐字保留**，只是搬进了 `applyImportedSections`（并用单一返回值 `return await applyImportedSections(...)` 保持 try/catch 语义不变）。

`tools/test-dashboard-import-export.cjs`（既有测试，**必须跟着改**，见 §4.4）：

| 行 | 改动 |
| --- | --- |
| `:24-60` | 新增 `extractAsyncDeclaration()`（按声明切函数，且跳过参数表的解构花括号） |
| `:59-68` | `Reader` 打桩：`readAsText` → `readAsArrayBuffer`（读字节，与页面一致） |
| `:169-176` | context 补 `TextDecoder` / `TextEncoder` / `Uint8Array` / `ArrayBuffer`，`window.ATO_JSAVE_IMPORT` 给一个「不是 jsave」的桩 |
| `:222-230` | 抽函数时额外带上 `applyImportedSections`（放在 `backupPrelude` 之后） |

**没有改动**：`jsave-import/import_jsave.py`（另一个代理在改它）、`data/` 下任何文件、`record/index.html`。

---

## 2. JS 与 Python 的差异点：**0 处**

### 参考文件是怎么来的

| 项 | 值 |
| --- | --- |
| 输入 | `D:\files\Tencent Files\2628451455\FileRecv\MobileFile\campaign_0005(2).jsave`（87,812 B，prefix `81 ae 05`，JSON 87,809 B，**陈旧尾巴 0**，`campaign_cycle=4` → `c5`，`campaign_uid=496311329`） |
| 参考实现 | `jsave-import/import_jsave.py`，`LastWriteTime = 2026-10-03 23:34:25`，SHA-256 `2CEAB631383F8313F901A82015674E07C975D4E4B068C4C59C9F8104B1351973` |
| 参考产物 | `jsave-web/ref-final/live0005.sections.json`（`jsave-web/pysnap/snap0005.sections.json` 是它的冻结副本，逐字节相同），79,606 B，**42 条自带断言全部 PASS** |
| 冻结副本 | `jsave-web/pysnap/import_jsave_snapshot.py` + `jsavelib.py`（SHA-256 与上面 live 文件**完全相同**），`run_snapshot.py` 是它的加载器（把 `ROOT/TABLES/GEAR_PROD/MAP_DATA_JS` 重定向回仓库） |

**关于「另一个代理正在改 import_jsave.py」**：按要求先看过修改时间与 `官方存档未导入项` 字样——该字样在文件里（`:1217` 的 docstring 与 `:1797` 的 `NOTES_KEYS` 标签表），文件在 `23:34:25` 被写过一次；等我把参考产物生成完毕、准备再核对时，它的 SHA-256 已经和 `23:34:25` 那份快照一致，且此后未再变化（`LastWriteTime` 仍是 `23:34:25`）。所以**本次深比较的参照物是一个冻结副本**，Python 侧后续再改也不会把这条验收变成"移动靶"。`jsave-web/pysnap/run_snapshot.py` 可以随时重跑出同一份参考；另附 `pysnap/which_ato_row.py`，用来现场对照 live 与 frozen 两份实现在「资源无对应行」上的落位判定（本次两边一致，都是 3 项）。

### 比较方式

`leafDiffs()`（测试里）与 `jsave-web/check-assets.cjs`（开发脚本）都做**逐叶子**比较：对象按键集合并、数组按下标、标量 `JSON.stringify` 相等；唯一豁免是 `*.id` / `activeHeroId` —— 那是 Python `unique_id()` 的毫秒时间戳，两次运行必然不同（`ref` 与 `snap` 两份产物之间有 41 处 id 差异，正好证明豁免是必要的）。另有一套 canonical 形式（`json.dumps(ensure_ascii=True, sort_keys=True, indent=1)` 风格）逐行比对，用来兜住"键顺序 / 数字格式"这类叶子看不出的差异。

### 结果

```
assets/jsave-tables.js + assets/jsave-import.js
jsave: ...\campaign_0005(2).jsave
python reference: ...\jsave-web\pysnap\snap0005.sections.json
leaf diffs: 0
```

canonical 逐行比较：`2913` 行对 `2913` 行，**除 id 行外 0 处不同**。

> 过程中曾出现 2 处差异（`record.notes` 与 `cycleStats.c5.notes` 两片文本），两边都是我最初的移植与 Python 不一致，已按 Python 改回：
> 1. 区块里的 JSON 一律用 Python `json.dumps(..., ensure_ascii=False)` 的**松散**写法（`[0, 0, -1]`、`{"a": 1}`），**除了**「忆识剧场泪珠/登升核心」那一行是 `separators=(",",":")` 的压缩写法——我原来统一成了压缩，属于"顺手优化"，已撤回；`fmt_languages` 里 `siren_lang/babyl_lang` 的「各 N 项」合并写法同理。
> 2. `fmt_note_pairs` 截断时的 `", …（共 N 项）"` 少了一个前置逗号。
> 这两处都不是语义问题，是**文本逐字符**问题；因为落点在 `record.notes`（用户可见的笔记区块），所以按"照抄 Python"处理。

---

## 3. 移植时逐条对齐的要点（都照抄 Python 的判定与注释）

* `campaign_cycle` 0 基 → `c{N+1}`（`buildSections` 用 `CYCLE_IDS[cycleIndex]`，不 +1 后再查表）。
* 机师**不按名字去重**：`argonaut_0..3` 非空槽全写，`dead_argonauts` + `retired_argonauts` 全部进 `graveyard`（本档 4 + 20 = 24，与 Python 的「机师实体总数」断言一致）。
* 资源键前缀按 `sharedResourceKeys` 规则：多循环出现 → 裸名；否则 `cN-` 取**定义该行的循环**（`definingCycle`），核心行走 `<CORE_CYCLE>-core-<短名>`。
* `record` 的 17 个 `cycleIdentityKeys`：顶层与 `cycleStats[c5]` 双写，测试里额外断言 `cycleStats.c5.notes === record.notes`。
* 稀有资源 `名字x值`，分隔符是常量 `RARE_VALUE_SEP`。
* `story_card`/`doom_card` → `cardTracks.story/doom.position`（0 基下标）；`story_tokens`/`doom_tokens` → `.progress`（官方 `-1` → 0）；`inward` 布尔 → `inwardOdyssey.progress`，`position = argoKnowledgeStart(cN)`。
* `timeline_status` 天数 = **最后一个 true 的下标**（不是个数）；`timeline_notes[i]` → `dateNotes["%02d" % i]`。
* `triskelion` = `[danger, fury, fate]`（官方枚举顺序 DANGER/RAGE/FATE）。
* `city_tile` → `tokens.markers["%03d"].last_city = true`。
* `dead_titans` → `record.deadTitans`（**字符串**）。
* `echo_track` → `record.pygmalion["echoes-progress-0/1/2"]`（前 n 格 true，格数固定 3）；官方单整数 `pygmalion` 不导。
* 外交阵营**按名字映射**（`FACTION_TO_ATO`），全程没有任何按下标 `zip` 的地方。
* `matrix[384]` 行优先 32×12；`matrix_notes` 解析出 T/L/圈/划 → 矩阵值，残留 → `record.notes`；解析器（切词、圈/划词元、"独立词元"判定、虚词过滤）逐函数照抄。
* `round_step` 不导，改为写进笔记区块（`轮次步骤：9（语义未定，未导入）`）。
* **未导入项笔记区块**（Python 新加的那套）：前后标识、`NOTES_BLOCK_LIMIT=4000` 的"先砍最长明细、再整行省略"压缩、`stripNotesBlock` 幂等（挡住二次导入叠两份）、various `fmt_note_*` 的截断规则，全部 1:1 移植；本档产出 32 行区块、1070 字符，与 Python 逐字符相同。
* `maps`：只有「恰好一张 + 格数与该轮 ATO 地图一致」才落位。本档 c5 官方地图 80 格而 ATO c5 地图 80 格 → 落位 `{"AG": "057", "AD": "070"}` + 21 个 `tileVariants`（与 Python 一致）。
* 用户界面偏好（`termLanguage`、`treeLanguage`、`hideUnknownTech`、`hideTreeImage`、`search_options*`、`save_version`）一律**不写**，与 Python 同样刻意。

---

## 4. 测试结果

### 4.1 新增 `tests/jsave-import.test.cjs`：9/9 PASS

```
✔ isJsave 按内容判定：.jsave 为真、ATO 状态包为假
✔ parseJsave 只消费第一个完整 JSON 值：JSON 后面的陈旧尾巴必须容忍
✔ convert() 与 Python 参考 sections.json 逐叶子相同
✔ 真实 .jsave 的转换结果带上了七个分区里 ATO 真正有数据的那五个
✔ 导入入口：.jsave 走转换器，expectedRevisions 语义与常规导入一致
✔ 导入入口：常规 ATO 状态包仍然照常工作（行为未变）
✔ 导入入口：坏文件给人话提示，不抛原始异常
✔ 导入入口：.jsave 头 + 坏 JSON 提示「这看起来不是官方存档」
✔ 导入对话框接受 .jsave 且转换器脚本已挂进页面
ℹ tests 9 / pass 9 / fail 0
```

覆盖到的关键断言：

* `isJsave`：真 `.jsave` 为真；ATO 状态包为假；**ATO 状态包强行加 3 字节头也仍为假**（内容里有 `sections`/`legacyDashboard` 就否掉）；纯 JSON 为假；头部 + 截断 JSON 为假且不抛。
* `parseJsave`：人为在 JSON 后拼 4 KB 垃圾 + 一段 `{"broken": "a\"b", "x": [1, 2` 的脏尾巴，仍解析出正确 official，`staleTail` 字节数精确对上；`rawJsonLength + 3 + staleTail === fileBytes.length`；无尾巴时与 `JSON.parse` 结果一致；截断时报「不是一个完整的 JSON 值」。
* 深比较：`leafDiffs === []`；canonical 逐行只允许 id 行不同；`official.campaign_cycle=4`、`campaign_uid=496311329` 与 `meta` 对上。
* 导入入口：从 `index.html` 抽真实 `importStateFile()` 跑，验证 ● 只发一次 `importCampaignSections`；● 提交的分区正好是 `dashboard/map/record/technology/heroes`；● `sections.record` / `sections.map` 与 `convert()` 结果一致；● `expectedRevisions` = 服务器当前版本（`{dashboard:3, map:0, record:5, technology:0, heroes:0}`）；● 导入后页面切到 `c3`（= `campaign_cycle:2`）。
* ATO 状态包回归：7 个分区（含 `aibp`/`story` 的 null）照旧全部提交，`expectedRevisions` 含全部 7 项，提示「导入完成。」。
* 文案/属性：`accept` 含 `.jsave`、按钮 `title` 提到 `.jsave`、两个 `<script>` 标签在位且 tables 在 import 之前、`imported.app === "ATO Campaign Save Package" && version >= 3` 与 `await importCampaignSections(` 逐字仍在。

### 4.2 与 dashboard / import / record 相关的既有测试：**全绿**

`node <file>` 逐个跑，exit code 全 0：

```
tools/test-dashboard-import-export.cjs             exit=0   （改过打桩，见 §4.4）
tests/dashboard-constant-sync.test.cjs              exit=0
tests/dashboard-c4-endless-days.test.cjs            exit=0
tests/dashboard-rr-goto-box.test.cjs                exit=0
tests/dashboard-lan-console.test.cjs                exit=0
tests/save-normalization-regressions.test.cjs       exit=0
tests/record-nemesis.test.cjs                       exit=0
tests/record-adventure-boxes.test.cjs               exit=0
tests/record-enemy-stage-migration.test.cjs         exit=0
tests/previous-day-restore.test.cjs                 exit=0
tests/lan-save-regressions.test.cjs                 exit=0
tests/review-save-fixes.test.cjs                    exit=0
tests/matrix-content.test.cjs                       exit=0
tests/c5-face-reveal.test.cjs                       exit=0
tests/c5-unique-markers.test.cjs                    exit=0
tests/map-tile-lookup.test.cjs                      exit=0
tests/nemesis-battle.test.cjs                       exit=0
tests/nemesis-path.test.cjs                         exit=0
tests/titan-x-track.test.cjs                        exit=0
```

`tests/app-update-client.test.cjs`（已知本来就红）没有纳入，未改动。

另外 `node jsave-web/check-inline-syntax.cjs` 把 `index.html` 的 2 个内联脚本块逐个编译：**语法错误 0 个**。

### 4.3 复现命令

```powershell
$py   = 'C:\Users\banard\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$node = 'C:\Users\banard\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# 1) 重新生成参考答案（冻结副本，不碰 jsave-import/import_jsave.py）
& $py jsave-web\pysnap\run_snapshot.py "D:\files\...\campaign_0005(2).jsave" -o jsave-web\pysnap --name snap0005

# 2) JS 深比较（0 差异）
& $node jsave-web\check-assets.cjs

# 3) 用例
& $node tests\jsave-import.test.cjs
& $node tools\test-dashboard-import-export.cjs
```

### 4.4 为什么必须动 `tools/test-dashboard-import-export.cjs`

它是**既有**测试，直接给 `FileReader` 打桩成 `readAsText`。页面改成 `readAsArrayBuffer` 后，它 5 条用例全部红成 `reader.readAsArrayBuffer is not a function`。因为页面必须读字节才能按内容判 `.jsave`，所以把打桩改成读字节，并补上 `TextDecoder`/`Uint8Array` 与 `window.ATO_JSAVE_IMPORT` 桩（该测试只测 `.json` 路径，桩恒返回"不是 jsave"）。改完 5 条全绿，**且它验证的行为一条没放松**。

---

## 5. 最不确定的两处

### 5.1 官方数据表"预切英文名"这一步（中等风险，影响 `technology.unlocked`）

`assets/jsave-tables.js` 里的 `techNames` 不是原始 `techCardNames`，而是**生成时先用 `english_of()` 切掉中文后缀**的结果（原始值形状是 `"Trireme Armor 三列桨战船盔甲"`，内嵌的是 `"Trireme Armor"`）。理由是转换器里 `english_of()` 一定会切，存全量要多 2/3 体积。

风险：如果有人**以后**改 `english_of()` 的切分规则（比如改成按空格取最后一个英文词），预切过的表就再也回不到原始信息。缓解：`jsave-web/build-embed.py` 一行就能重建（切分用的是 Python 侧同一个正则），且本档 291 条 `unlocked` 与 Python 逐字符相同；`jsave-tables.js` 的 JSON 文本与生成脚本 `jsave-web/build-tables.cjs` 的产物逐键校验过（`roundtrip=true`）。**最稳妥的替代**是内嵌完整中英名（+20 KB），目前没这么做。

### 5.2 数据表拆成两个文件带来的加载顺序耦合

`assets/jsave-import.js` 现在**依赖** `assets/jsave-tables.js` 先加载：`officialTables()` 在浏览器里读 `root.ATO_JSAVE_TABLES`，读不到就抛 `缺少 assets/jsave-tables.js（官方数据表）`。`index.html` 里两个 `<script>` 的顺序已由测试断言（`:2459` 在 `:2460` 之前），node 侧则靠 `require("./jsave-tables.js")`（Node 相对 require 解析的是**模块所在目录**，不是进程 cwd）。

风险：任何"只引 jsave-import.js 不引 jsave-tables.js"的新页面（例如以后给简报页加同一个导入入口）会在**第一次转换时**才报错，而不是加载时。缓解：我在入口脚本里刻意做成"读不到就立刻抛错"，而不是静默退化成"所有卡号都查不到"；另外 `tests/jsave-import.test.cjs` 里保留了脚本顺序与 `window.ATO_JSAVE_IMPORT` 的断言。

### 附：另外两处已知取舍（不是不确定，但值得知道）

* **陈旧尾巴的 `meta` 扫描器是我自己加的**（Python 只调 `json.raw_decode` 拿 object，`test_dashboard-import-export` 那种"用 `.jsave` 判定循环"的需求没有对应函数）。它不参与 `convert()`，也不影响深比较；做法是"逐个顶层键值对地扫、只取标量"，遇到脏尾巴只跳过键值对、不整棵解析。它唯一的消费者是 `index.html:9157` 的 `parsed.meta?.campaign_cycle`，用来确保导入后页面停在官方存档那一轮。
* **`convert()` 只产出 5 个分区**（`dashboard/map/record/technology/heroes`），`aibp`/`story` 官方存档没有来源，因此不出现。导入入口的 `isFullBackup: false` 让 `importEntries` 的过滤条件把这两个分区挡掉——**与 Python 版 sections 的键集完全一致**，也让既有 ATO 状态包路径的语义（完整备份带 null 也提交）不受影响。

---

## 6. `jsave-web/` 里留下了什么

| 路径 | 用途 |
| --- | --- |
| `build-embed.py` | 从 `app-extract/official-tables.json` + `technology/ato_gear_production.json` 抽出小表 → `embed-fragments.json` |
| `embed-fragments.json` | 上述产物（含"已按 `english_of` 切成英文名"的科技卡表） |
| `build-tables.cjs` | `embed-fragments.json` → `assets/jsave-tables.js` 的源码文本（写到 `out/`，再由编辑工具搬进 `assets/`）。重跑出的文件与 `assets/jsave-tables.js` **逐键值相同**（5 张表全部 `true`），字节数略有差异只因生成时的换行缩进不同（28,712 B vs 37,550 B） |
| `check-assets.cjs` | 对发布版两个文件跑 `.jsave` → 与 Python 参考逐叶子比较（本次 `leaf diffs: 0`） |
| `check-inline-syntax.cjs` | 编译 `index.html` 的内联脚本，防手改破坏语法 |
| `pysnap/` | Python 转换器的**冻结副本** + `jsavelib.py` + `run_snapshot.py`（加载器）+ `which_ato_row.py`（对照 live/frozen 的资源落位判定）+ `snap0005.sections.json` / `.assertions.txt` |
| `ref-final/` | 直接跑 `jsave-import/import_jsave.py` 生成的参考产物与断言明细（42 条全 PASS）；`pysnap/snap0005.*` 是它的冻结副本 |

> 说明：本轮所有子进程产物都写在新建目录（`jsave-web/`）里，再逐个搬进 `assets/` / `tools/`；`assets/` 下已有文件由编辑工具写，`data/` 全程只读。
