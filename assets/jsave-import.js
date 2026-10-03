/*!
 * jsave-import.js —— 官方 Aeon Trespass App 存档（.jsave）→ ATO_assistant sections 转换器。
 *
 * 这是 jsave-import/import_jsave.py 的逐字段 JS 移植版（浏览器里跑不了 Python）。
 * 判定与注释一律照抄 Python 版，**没有**做"顺手优化"：任何看起来多余的分支、
 * 冗余的类型检查、以及"样例里恒为 0 但仍原样写"的写法都是刻意保留的，
 * 因为 tests/jsave-import.test.cjs 会拿 Python 版的输出做深比较（要求 0 处差异）。
 *
 * 对外接口（浏览器挂 window.ATO_JSAVE_IMPORT；node 走 module.exports）：
 *   isJsave(bytes)        —— 按**内容**判定是不是官方 .jsave（不看扩展名）
 *   parseJsave(buffer)    —— 取前 3 字节不透明头 + 第一个完整 JSON 值
 *                            → { prefix, official, rawJsonLength, staleTail }
 *   convert(official, opt)—— 官方对象 → ATO 的 sections（dashboard/map/record/
 *                            technology/heroes 五个分区；aibp/story АТО 端本来就
 *                            没有对应数据，保持不出现 —— 与 Python 版一致）
 *
 * 数据来源：
 *   * 官方枚举顺序（21 项属性 / 86 项货舱 / 6 项技能 / 41 hub / 15 阵营）取自
 *     app-extract/official-tables.json，内嵌在下面（只内嵌用得到的小表）。
 *   * ATO 地图瓦片取 window.ATO_MAP_DATA（map/map-data.js）；
 *     node 下从 map/map-data.js 现读。读不到只会影响地图落位的诊断文案。
 */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.ATO_JSAVE_IMPORT = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // ---------------------------------------------------------------- 路径与常量

  var MATRIX_ROWS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(
    ["AA", "BB", "CC", "DD", "EE", "FF"]);
  var MATRIX_COLS = 12;

  // 官方 cycle 下标（0 基）→ ATO 循环 id
  var CYCLE_IDS = ["c1", "c2", "c3", "c4", "c5"];

  // 机师技能：官方 ArgonautSkill 顺序 → ATO baseSkills 键
  var SKILL_KEYS = ["courage", "cunning", "endurance", "fury", "will", "wisdom"];

  // 官方 21 项属性 → ATO record 字段。
  // 值是 [顶层字段, cycleStats 内的字段]；null 表示 ATO 没有对应字段（会写进报告）。
  // 「顶层 + cycleStats 双写」的理由：`record/index.html:2287-2291` 的 cycleIdentityKeys
  // 说明这些字段是**按循环**的，真身在 `record.cycleStats[<cycle>]`，顶层的同名字段只是
  // 当前循环的视图（normalize 里 :2735-2737 会把 cycleStats[cycle] 回填到顶层）。
  var STAT_TO_RECORD = {
    CREW: ["crew", "crew"],
    HULL: ["hull", "hull"],
    AFATE: ["fate", "fate"],
    AKNOW: null,             // ATO 无对应字段
    AABILITY: ["aaLimit", "aaLimit"],
    STRANGERS: ["strangers", "strangers"],
    REFUGEES: null,          // → cycleStats.c2.crewCounters.refugees（单独写）
    CAPTIVES: null,          // → cycleStats.c2.crewCounters.captives（单独写）
    HUMANITY: ["humanity", "humanity"],
    DEFECTORS: ["renegade", "renegade"],   // 界面标签「变节者」，图标 defectors.svg
    CRIPPLED_TITANS: null,
    PARADOX: ["paradox", "paradox"],
    TIME_SILO: null,
    FROZEN_TIME: ["frozenTime", "frozenTime"],
    LOOP_LENGTH: ["loopLength", "loopLength"],
    SUMMON_LIMIT: ["summonLimit", null],
    TITAN_LIMIT: ["titanLimit", null],
    BABELIAN_DEBT: ["babelianDebt", "babelianDebt"],
    PARANOIA: ["paranoia", "paranoia"],
    OXYGEN: ["oxygenCurrent", "oxygenCurrent"],
    ARGONAUT_SUPPLY: ["supply", "supply"]
  };

  // 官方 argo_stats_lims[21] → ATO 的**上限**字段（不是当前值字段）。
  // ATO 真正存在的上限字段只有：hull / crew（由 cycleData 的 hull/crew 数组决定）、
  // titanLimit、nymphLimit、aaLimit、oxygenLimit（+ 半废弃的 godformLimit）。
  // 本次存档的 argo_stats_lims **整列都是 0**，所以「有字段但没数据」也要如实标出来。
  var STAT_LIMIT_TO_RECORD = {
    CREW: "crew",            // 上限来自 cycleData.c<N>.crew 的数组长度
    HULL: "hull",            // 同上
    AABILITY: "aaLimit",
    SUMMON_LIMIT: "summonLimit",
    TITAN_LIMIT: "titanLimit",
    OXYGEN: "oxygenLimit"
  };

  // 货舱资源官方枚举名 → ATO 键名（只列「不是」机械小驼峰的特例）
  var CARGO_NAME_OVERRIDES = {
    CALCIFIED_KNUCKLE_BONE: "calcifiedKnuckle",
    BLACKWOOL_STRAND: "blackWoolStrand",
    FADING_CONSTRUCT: "fadingLightConstruct"
  };

  // 官方 CORE_* → ATO 核心短名（ATO 里由 nemesis 敌人 key 派生，见 record/index.html:4476）
  var CORE_SHORT = {
    CORE_HEKATON: "hekaton",
    CORE_LABYRINTHAUROS: "labyrinthauros",
    CORE_TEMENOS: "temenos",
    CORE_CYCLONUS: "cyclonus",
    CORE_CHIMERA_METASTASIOS: "chimera",
    CORE_NIETZSCHEAN: "nietzschean",
    CORE_HYPERTIME_ORACLE: "oracle",
    CORE_ICARIAN_HARPY: "harpy",
    CORE_SUN_DESCENDANT: "sunDescendant",
    CORE_HERMESIAN_PURSUER: "pursuer",
    CORE_BURDEN: "adversary",
    CORE_MIDASCORE: "midascore",
    CORE_DEMIDJINN: "demidjinn",
    CORE_BABELIAN_LUNACY: "babelianLunacy",
    CORE_DAHAKA: "dahaka",
    CORE_DRAGON_PHOBOS: "dragonOfPhobos",
    CORE_MEDUKETOS: "meduketos",
    CORE_UR_FLEECE: "urFleece",
    CORE_TITAN_X: "titanX"
  };

  // 官方阵营 id → ATO 阵营键名（据 app-extract/official-tables.json 的 icon 字段与
  // record/index.html:1819-2174 的 diplomacy 表逐条对齐）
  var FACTION_TO_ATO = {
    f_minoans: "minoians",
    f_labyrinth: "labyrinthians",
    f_hornsworn: "hornsworn",
    f_helots: "helots",
    f_cyclopes: "cyclopes",
    f_symmachy: "symmachy",
    f_sunheirs: "sunheirs",
    f_delphians: "delphians",
    f_twilight: "twilightWatch",
    f_aristotelians: "aristotelians",
    f_wasters: "wasters",
    f_cthieves: "cloudThieves",
    f_vanguard: "outcastVanguard",
    f_followers: "followersOfArete",
    f_protectorate: "cycladeanProtectorate"
  };

  // 官方神之形态名 → ATO summonCards.godforms 的 id（record/index.html:2243-2259）
  var GODFORM_ALIASES = {
    zeus: "zeus",
    poseidon: "poseidon",
    demeter: "demeter",
    hephaestus: "hephaestus",
    hermes: "hermes",
    hermos: "hermes",
    ares: "ares",
    artemis: "artemis",
    athena: "athena",
    hades: "hades",
    "哈迪斯": "hades",
    dionysus: "dionysus",
    aphrodite: "aphrodite",
    hera: "hera",
    "helios-apollonis-exalted": "helios-apollonis-exalted",
    "poseidon-exalted": "poseidon-exalted",
    "poseidon ex": "poseidon-exalted",
    "zeus-exalted": "zeus-exalted",
    "hermes-exalted": "hermes-exalted"
  };

  // ATO 神之形态 id 全集（用于反查）
  var GODFORM_IDS = (function () {
    var set = {};
    Object.keys(GODFORM_ALIASES).forEach(function (key) { set[GODFORM_ALIASES[key]] = true; });
    ["dionysus", "aphrodite", "helios-apollonis-exalted", "hera"].forEach(function (id) {
      set[id] = true;
    });
    return set;
  })();

  // ATO 宁芙 id 全集（record/index.html:2261-2283）
  var NYMPH_IDS = {};
  ["engine", "solitude", "amalthean", "labyrinth", "depths", "sweets", "nietzschean",
    "forge", "blade", "knowledge", "mask", "curiosity", "night", "age", "hope",
    "machina", "silica", "midas", "natron", "ambrosia", "aether"
  ].forEach(function (id) { NYMPH_IDS[id] = true; });

  // ATO 记录的「阿尔戈号资源」行表：c1..c5 各自定义了哪些行（record/index.html:1764-2196
  // 的 cycleData.<c>.resources 逐条抄录，core / rare 是 sentinel 行）。
  // 这份表就是键名前缀规则的**唯一权威**：一行属于哪个循环，它的存储键就用哪个循环的前缀。
  var ATO_CYCLE_RESOURCES = {
    c1: ["trireme", "monument", "armament", "rawAmbrosia", "muscleCluster",
      "fearEssence", "calcifiedKnuckle", "mazeFragment", "grotesqueBeak",
      "infusedMechanism", "fleshyMantle", "powderedMatter", "core", "priests",
      "sisyphusTears", "rare"],
    c2: ["warTrireme", "relief", "warMachine", "violentAmbrosia", "fearEssence",
      "chimericTar", "grotesqueBeak", "mazeFragment", "supersolidRelief",
      "powderedMatter", "cyclopeanMetal", "livingAbyss", "retractableMechanism",
      "blackChain", "skinOfMalice", "reliefshellFragment", "core", "priests",
      "sisyphusTears", "pygmalionStones", "rare"],
    c3: ["sirenshell", "hyperboreanAlloy", "daedalusMakina", "frozenAmbrosia",
      "livingAbyss", "razorclaw", "grotesqueBeak", "skinOfMalice",
      "icarianFeather", "powderedMatter", "clothflesh", "writhingTentacle",
      "retractableMechanism", "eyesCluster", "sunburnedSkull",
      "reliefshellFragment", "core", "sisyphusTears", "priests", "echoes", "rare",
      "pygmalionStones"],
    c4: ["cursedDerelict", "imperialScroll", "babylonianContraption",
      "mutableAmbrosia", "blackenedHalo", "burnedOutGrace", "cursedBloatsack",
      "livingGold", "wishEmbryo", "oldIremFragment", "blackTaintedStepfinger",
      "promisedFuturesCarcass", "onyxDust", "ireEssence", "core", "rare", "priests",
      "echoes", "sisyphusTears", "pygmalionStones"],
    c5: ["atlanteanTekne", "orichalcumChunk", "liquidAether", "oxidizedAmbrosia",
      "promisedFuturesCarcass", "blackTaintedStepfinger", "hydradynamicScales",
      "amygdalanExtract", "photophobicFlesh", "microwaveCell", "blackWoolStrand",
      "fadingLightConstruct", "orichalcumAlloy", "slaveMetal", "core", "rare",
      "priests", "echoes", "sisyphusTears", "pygmalionStones"]
  };

  // 内蕴奥德赛轨道的 position 起点（index.html:4451 argoKnowledgeStart）
  var ARGO_KNOWLEDGE_START = { c1: 1, c2: 20, c3: 40, c4: 60, c5: 80 };

  // 稀有资源文本行的「名称/值」分隔符（用户指定小写 x；要换成 `×` 或 `*` 只改这里）
  var RARE_VALUE_SEP = "x";

  // 官方 CORE_* → 核心行所属循环（nemesisOptionsByCycle，record/index.html:2208-2214）
  var NEMESIS_BY_CYCLE = {
    c1: ["pursuer"],
    c2: ["adversary", "pursuer", "dahaka"],
    c3: ["adversary", "dahaka"],
    c4: ["dahaka"],
    c5: ["titanX"]
  };

  // 每轮的所有敌人 key（record/index.html 的 cycleData.<c>.enemies）—— 核心行 `cN-core-<key>`
  // 是按敌人而不是按 nemesis 选项生成的，真实存档 c1 档里同时有 pursuer 与 hekaton 的行。
  var CYCLE_ENEMIES = {
    c1: ["hekaton", "labyrinthauros", "temenos", "pursuer"],
    c2: ["cyclonus", "chimera", "nietzschean", "adversary"],
    c3: ["oracle", "harpy", "sunDescendant", "adversary"],
    c4: ["midascore", "demidjinn", "babelianLunacy", "dahaka"],
    c5: ["dragonOfPhobos", "meduketos", "urFleece", "titanX"]
  };

  // 每轮每个敌人的**轨道格 id 序列**（record/index.html 的 cycleData.<c>.enemies[].stages[].id），
  // 用来把官方 evo 的进度布尔数组落成 `record.enemies` 的 `<cycle>:<enemy>:<stageId>` 键。
  // 这份是 record/index.html 的抽出结果（Python 版会在运行时重新解析并比对）。
  var CYCLE_ENEMY_STAGES = {
    c1: {
      hekaton: ["0", "1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c"],
      labyrinthauros: ["spacer", "1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c"],
      temenos: ["1", "2", "3", "4"],
      pursuer: ["1", "2", "3", "4", "5"]
    },
    c2: {
      cyclonus: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
      chimera: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
      nietzschean: ["1", "2", "3", "4"],
      adversary: ["1", "2", "3", "4", "5"]
    },
    c3: {
      oracle: ["1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c", "5"],
      harpy: ["1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c", "5"],
      sunDescendant: ["1", "2", "3", "4", "5"],
      adversary: ["1", "2", "3", "4", "5"]
    },
    c4: {
      midascore: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c",
        "5a", "5b", "5c", "5d", "6"],
      demidjinn: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c",
        "5a", "5b", "5c", "5d", "6"],
      babelianLunacy: ["1", "2", "3", "4", "5", "6"],
      dahaka: ["1", "2", "3", "4", "5", "6", "7", "8"]
    },
    c5: {
      dragonOfPhobos: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
      meduketos: ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
      urFleece: ["1", "2", "3", "4", "5"],
      titanX: ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
    }
  };

  // 官方 CORE_* → 所属循环
  var CORE_CYCLE = {
    CORE_HEKATON: "c1", CORE_LABYRINTHAUROS: "c1", CORE_TEMENOS: "c1",
    CORE_HERMESIAN_PURSUER: "c1",
    CORE_CYCLONUS: "c2", CORE_CHIMERA_METASTASIOS: "c2", CORE_NIETZSCHEAN: "c2",
    CORE_BURDEN: "c2",
    CORE_HYPERTIME_ORACLE: "c3", CORE_ICARIAN_HARPY: "c3",
    CORE_SUN_DESCENDANT: "c3",
    CORE_MIDASCORE: "c4", CORE_DEMIDJINN: "c4", CORE_BABELIAN_LUNACY: "c4",
    CORE_DAHAKA: "c4",
    CORE_DRAGON_PHOBOS: "c5", CORE_MEDUKETOS: "c5", CORE_UR_FLEECE: "c5",
    CORE_TITAN_X: "c5"
  };

  // 按循环存的「身份字段」（record/index.html:2287-2291 cycleIdentityKeys）：
  // 真身在 record.cycleStats[<cycle>]，顶层的同名字段只是「当前循环的视图」
  // （normalize 里 :2735-2737 把 cycleStats[cycle] 的值回填到顶层）。
  var CYCLE_IDENTITY_KEYS = [
    "storyCard", "doomCard", "mapTiles", "fate", "aaLimit", "strangers", "humanity",
    "renegade", "loopLength", "frozenTime", "paradox", "babelianDebt", "oxygenCurrent",
    "oxygenLimit", "reapMarkNotes", "sowMarkNotes", "paranoia"
  ];

  // ---------------------------------------------------------------- 官方数据表（内嵌）

  // app-extract/official-tables.json: argo_stats_order（21 项）
  var ARGO_STATS_ORDER = ["CREW", "HULL", "AFATE", "AKNOW", "AABILITY", "STRANGERS",
    "REFUGEES", "CAPTIVES", "HUMANITY", "DEFECTORS", "CRIPPLED_TITANS", "PARADOX",
    "TIME_SILO", "FROZEN_TIME", "LOOP_LENGTH", "SUMMON_LIMIT", "TITAN_LIMIT",
    "BABELIAN_DEBT", "PARANOIA", "OXYGEN", "ARGONAUT_SUPPLY"];

  // app-extract/official-tables.json: argonaut_skills_order（6 项）
  var ARGONAUT_SKILLS_ORDER = ["COURAGE", "CUNNING", "ENDURANCE", "FURY", "WILL", "WISDOM"];

  // 官方数据表（86 项货舱 / 41 个 hub / 15 个阵营 / 319 张科技卡英文名 / 497 个装备卡号）
  // 统一从 assets/jsave-tables.js 取：那个文件必须在本文件**之前**加载
  // （index.html 的 <script> 顺序），node 下则按相对路径 require 一次。
  // 读不到就立刻抛错，别让转换结果悄悄退化成"全部查不到"。
  var TABLES_CACHE = null;

  function officialTables() {
    if (TABLES_CACHE) return TABLES_CACHE;
    var tables = (root && root.ATO_JSAVE_TABLES) || null;
    if (!tables && typeof require === "function") {
      try {
        tables = require("./jsave-tables.js");
      } catch (error) {
        tables = null;
      }
    }
    if (!tables || !tables.cargoOrder || !tables.adventureHubs) {
      throw new Error("缺少 assets/jsave-tables.js（官方数据表）：请确认它在 jsave-import.js 之前加载");
    }
    TABLES_CACHE = tables;
    return tables;
  }

  // app-extract/official-tables.json: cargo_resource_order（86 项；转换器只用前 85 项）
  function cargoResourceOrder() { return officialTables().cargoOrder; }

  // app-extract/official-tables.json: adventure_hubs（41 个 hub，按 c1..c5 顺序）
  function adventureHubs() { return officialTables().adventureHubs; }

  // app-extract/official-tables.json: diplomacy_factions_by_cycle（15 个 f_* 阵营 + 5 条
  // `-10`/`0` 的轨道区间标记行；后者不是阵营，不会被映射）
  function diplomacyFactions() { return officialTables().diplomacyFactions; }

  // technology/ato_gear_production.json: techCardNames —— 只留**英文名部分**
  // （`english_of()` 本来就会把中文后缀切掉，内嵌前先切好可省 2/3 体积；
  //  值逐条与官方表一致，测试里会用完整表复核）。
  function techCardNames() { return officialTables().techNames; }

  // technology/ato_gear_production.json: gearCards 的键集合（只用来判「卡号认不认识」）
  function gearCardIds() { return officialTables().gearKeys; }

  // ---------------------------------------------------------------- Python 语义小工具

  function isDict(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isList(value) {
    return Array.isArray(value);
  }

  // Python 的 `int(x)`：对 bool 给 0/1，对数字向零截断，对字符串先解析再截断。
  function pyInt(value) {
    var number;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") number = value;
    else if (typeof value === "string") {
      var text = value.trim();
      var match = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.exec(text);
      if (!match) return NaN;
      number = Number(text);
    } else return NaN;
    if (typeof number !== "number" || Number.isNaN(number) || !Number.isFinite(number)) return NaN;
    return number < 0 ? Math.ceil(number) : Math.floor(number);
  }

  // Python 的 `%d`：只接受整数。
  function pctD(value) {
    return String(pyInt(value));
  }

  function truthy(value) {
    // Python 的 `not value` / `if value:`：空容器、0、"" 都是假。
    if (value === null || value === undefined) return false;
    if (value === false) return false;
    if (value === 0) return false;
    if (value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(value);
  }

  function pyJsonString(text) {
    var out = '"';
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var code = text.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (code < 0x20) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
      else out += ch;
    }
    return out + '"';
  }

  function jsonEnsureAsciiString(text) {
    var out = '"';
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var code = text.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (code < 0x20 || code > 0x7e) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
      else out += ch;
    }
    return out + '"';
  }

  // Python `json.dumps(x, ensure_ascii=False)` 的等价物。
  // 注意 Python **默认**在 `,` 和 `:` 后面带空格（`[0, 0, -1]`、`{"a": 1}`），
  // 区块里的每一行都是这个格式，所以不能沿用压缩写法 —— 测试会逐字节比对。
  function pyJson(value) {
    if (value === null || value === undefined) return "null";
    if (value === true) return "true";
    if (value === false) return "false";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "null";
      return Number.isInteger(value) ? String(value) : String(value);
    }
    if (typeof value === "string") return pyJsonString(value);
    if (isList(value)) return "[" + value.map(pyJson).join(", ") + "]";
    if (isDict(value)) {
      return "{" + Object.keys(value).map(function (key) {
        return pyJsonString(String(key)) + ": " + pyJson(value[key]);
      }).join(", ") + "}";
    }
    return pyJsonString(String(value));
  }

  // Python `json.dumps(..., ensure_ascii=True)` 的等价物：非 ASCII 一律 \\uXXXX 转义。
  function jsonAscii(value) {
    if (typeof value === "string") return jsonEnsureAsciiString(value);
    return pyJson(value).replace(/[^\x00-\x7f]/g, function (ch) {
      return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  // Python `json.dumps(x, ensure_ascii=False, separators=(",", ":"))` 的等价物
  //（只有「忆识剧场泪珠/登升核心」那一行用它，历史原因，见 buildUnimportedNotes）。
  function compactJson(value) {
    return pyJson(value).replace(/, /g, ",").replace(/: /g, ":");
  }

  function jsonEnsureAscii(value) {
    if (isList(value)) return "[" + value.map(jsonEnsureAscii).join(", ") + "]";
    if (isDict(value)) {
      var keys = Object.keys(value).sort();
      return "{" + keys.map(function (key) {
        return jsonEnsureAscii(key) + ": " + jsonEnsureAscii(value[key]);
      }).join(", ") + "}";
    }
    return jsonAscii(value);
  }

  // Python 的 `json.dumps(dict, ensure_ascii=True, sort_keys=True, indent=1)` 风格的
  // canonical 形式 —— 只给测试做深比较用（Python 那边由测试自己实现同一套格式）。
  function canonicalJson(value, indent) {
    indent = indent === undefined ? 0 : indent;
    var pad = new Array(indent + 1).join(" ");
    var inner = new Array(indent + 2).join(" ");
    if (isList(value)) {
      if (!value.length) return "[]";
      return "[\n" + value.map(function (item, index) {
        return inner + canonicalJson(item, indent + 1) + (index < value.length - 1 ? "," : "");
      }).join("\n") + "\n" + pad + "]";
    }
    if (isDict(value)) {
      var keys = Object.keys(value).sort();
      if (!keys.length) return "{}";
      return "{\n" + keys.map(function (key, index) {
        return inner + jsonAscii(key) + ": " + canonicalJson(value[key], indent + 1)
          + (index < keys.length - 1 ? "," : "");
      }).join("\n") + "\n" + pad + "}";
    }
    return jsonAscii(value);
  }

  function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function camel(name) {
    // TRIREME→trireme，RAW_AMBROSIA→rawAmbrosia。
    var parts = String(name).split("_").filter(function (part) { return part.length > 0; });
    if (!parts.length) return "";
    return parts[0].toLowerCase() + parts.slice(1).map(function (part) {
      return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase();
    }).join("");
  }

  function fold(text) {
    // 大小写/重音/标点归一，用于宽松比对名字（JS 版的 NFD 只处理拉丁重音，
    // 中日韩没有组合记号，所以结果与 Python 的 NFKD 一致 —— 用不到的地方不修）。
    return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function englishOf(label) {
    // 'Trireme Armor 三列桨战船盔甲' → 'trireme armor'
    var match = String(label).split(/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/)[0];
    return match.trim();
  }

  function splitKey(key) {
    // mnemos_c1_09 → ['c1', '09']；fm_c1_03 → ['c1','03']
    var match = /(c[1-5])_(\d+)/.exec(String(key));
    return match ? [match[1], match[2]] : [null, null];
  }

  var uniqueIdCounter = 0;

  function uniqueId(prefix, seen) {
    // 生成不与 seen 冲突的 id（Python 用毫秒时间戳；这里加了一个进程内计数器，
    // 免得同一毫秒内的两次调用撞在一起 —— 同名的机师必须各有各的 id）。
    // `seen` 是普通对象（键 = 已用过的 id），这样重跑同一个 official 也不会串味。
    uniqueIdCounter += 1;
    var candidate = prefix + "-" + String((Date.now() * 1000 + uniqueIdCounter) % 10000000000);
    var n = 0;
    while (seen[candidate]) {
      n += 1;
      candidate = prefix + "-" + String(Date.now() % 10000000000) + "-" + String(n);
    }
    seen[candidate] = true;
    return candidate;
  }

  // ---------------------------------------------------------------- 矩阵备注解析

  var LETTER_RE = /^[A-Za-z]+/;
  var DIGIT_RE = /^[0-9]+/;
  var CJK_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/;

  var CIRCLE_WORDS = ["圈起来", "圈出", "圈"];
  var CROSS_WORDS = ["划掉", "划去", "叉"];
  // 判定「独立词元」时的分隔符（参照 jsave-work/matrix-notes-0000.txt 的样例）
  var SEPARATORS = " \t\r\n,.;:!?、，。；：！？·|/\\-–—()（）[]【】\"'“”‘’";

  function isAsciiAlphaNumeric(ch) {
    return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }

  function _circleIn(text) {
    for (var i = 0; i < CIRCLE_WORDS.length; i += 1) {
      var pos = text.indexOf(CIRCLE_WORDS[i]);
      if (pos >= 0) return [pos, pos + CIRCLE_WORDS[i].length];
    }
    return null;
  }

  function _crossIn(text) {
    for (var i = 0; i < CROSS_WORDS.length; i += 1) {
      var pos = text.indexOf(CROSS_WORDS[i]);
      if (pos >= 0) return [pos, pos + CROSS_WORDS[i].length];
    }
    return null;
  }

  function tokenizeNotes(text) {
    // 把备注切成 (start, end, token)，标点只作分隔符。
    //
    // * 拉丁字母/数字成段：`l`、`sow`、`buyaobuaoji`
    // * 「圈」类关键词单独成段（并吸收它左边的字）：`L 圈起来的谎言` → `L` + `圈起来`
    //   —— 这样「圈起来的谎言」不会被整段吃掉，切开后剩下的 `的谎言` 才能进笔记；
    //   但 `谎言圈起来` 里的 `谎言` 会被吸进关键词段（多消费几个字，只会让笔记更少，
    //   不会写错矩阵）。
    // * 其余汉字连续成段
    var out = [];
    var index = 0;
    while (index < text.length) {
      var ch = text[index];
      if (SEPARATORS.indexOf(ch) >= 0) { index += 1; continue; }
      if (isAsciiAlphaNumeric(ch)) {
        var rest = text.slice(index);
        var match = LETTER_RE.exec(rest) || DIGIT_RE.exec(rest);
        out.push([index, index + match[0].length, match[0]]);
        index += match[0].length;
        continue;
      }
      var hit = _circleIn(text.slice(index));
      if (!hit) hit = _crossIn(text.slice(index));
      if (hit) {
        // 把 index 到关键词末尾整体吃成一个 token（含左侧汉字），
        // 解析时只切掉关键词本身，左侧汉字会退回笔记。
        var end = index + hit[1];
        out.push([index, end, text.slice(index, end)]);
        index = end;
        continue;
      }
      var cjk = CJK_RE.exec(text.slice(index));
      if (cjk) {
        out.push([index, index + cjk[0].length, cjk[0]]);
        index += cjk[0].length;
      } else {
        index += 1;
      }
    }
    return out;
  }

  function remainingText(text, cuts) {
    // 返回 text 中不在任何 cut 区间内的字符（保持原顺序）。
    var ranges = cuts.slice().sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    var index = 0;
    ranges.forEach(function (range) {
      if (range[0] > index) out.push(text.slice(index, range[0]));
      index = Math.max(index, range[1]);
    });
    out.push(text.slice(index));
    return out.join("");
  }

  function parseMatrixNote(note) {
    // 解析一条矩阵备注。
    //
    // 返回对象：
    //   value    : ATO matrix 值（"T"/"L"/"circle"/"circleT"/"circleL"/"cross"/null）
    //   leftover : 去掉被消费词元后的剩余文本（未做首尾分隔符裁剪）
    //   consumed : 被消费的词元列表（用于报告）
    var rawTokens = tokenizeNotes(note || "");
    var toks = rawTokens.filter(function (t) { return Boolean(t[2]); });
    var consumed = [];
    var circle = false;
    var kind = null;       // "letter" / "circle" / "cross"
    var letter = null;

    // 1) 先找「圈」类词元（可能是一整段汉字里的一段，例如 `圈起来的谎言`）
    for (var i = 0; i < toks.length; i += 1) {
      if (circle) break;
      var hit = _circleIn(toks[i][2]);
      if (hit) {
        circle = true;
        kind = kind || "circle";
        // 只切掉「圈」那几字；词元里其余的字（如 `圈起来的谎言` 的 `的谎言`）
        // 由 remainingText 自动保留，无需另外记录
        consumed.push([toks[i][0] + hit[0], toks[i][0] + hit[1]]);
      }
    }

    // 2) 再找「划掉」类
    if (!circle) {
      for (var j = 0; j < toks.length; j += 1) {
        var cross = _crossIn(toks[j][2]);
        if (cross) {
          kind = "cross";
          consumed.push([toks[j][0] + cross[0], toks[j][0] + cross[1]]);
          break;
        }
      }
    }

    // 3) 字母标记：只认「整段就是一个字母」的 token，取第一个
    var letterTokens = toks.filter(function (t) {
      return t[2].length === 1 && "TtLl".indexOf(t[2]) >= 0;
    });
    if (letterTokens.length) {
      letter = letterTokens[0][2].toUpperCase();
      consumed.push([letterTokens[0][0], letterTokens[0][1]]);
    }

    // 4) 组值
    var value;
    if (circle && letter) value = "circle" + letter;
    else if (circle) value = "circle";
    else if (kind === "cross") value = "cross";
    else if (letter) value = letter;
    else value = null;

    // 5) 重建剩余文本：保留所有未被消费区间覆盖的字符（顺序不变）
    var cuts = consumed.slice().sort(function (a, b) { return a[0] - b[0]; });
    var leftoverRaw = remainingText(note || "", cuts);
    return {
      value: value, leftover: leftoverRaw, consumed: cuts,
      circle: circle, cross: kind === "cross", letter: letter
    };
  }

  var TRIM_CHARS = " \t\r\n";        // 只裁空白

  // 单独残留的标记字（`圈` 这类）说明关键词被切错了，视为已被消费，不进笔记
  var MARKER_CHARS = {};
  ("圈划掉去叉." + " \t\r\n,.;:!?、，。；：！？·|/\\-–—()（）[]【】\"'“”‘’")
    .split("").forEach(function (ch) { MARKER_CHARS[ch] = true; });

  // 中文虚词/助词：如果残留文本以这些字打头，说明它失去了被消费词元的依托，读起来是断的
  var CHINESE_FUNCTION_CHARS = {};
  "的了之乎者也而且或但与和及以及在于其所以被把给对从向".split("")
    .forEach(function (ch) { CHINESE_FUNCTION_CHARS[ch] = true; });

  function cleanLeftover(text) {
    // 只裁掉首尾空白。
    //
    // （早先版本会连首尾标点一起裁，结果 `a l.sow` 的残留 `.sow` 被裁成 `sow`；
    //  用户要求保留 `.sow`，所以这里只裁空白。）
    return String(text).replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
  }

  function isOnlyMarkers(text) {
    if (!text) return false;
    for (var i = 0; i < text.length; i += 1) {
      if (!MARKER_CHARS[text[i]]) return false;
    }
    return true;
  }

  function leftoverIsMeaningful(leftover) {
    // 残留文本能否独立成立。
    //
    // * 纯 ASCII（英文/编号）→ 能（`.sow`、`2x`、`cd` 都读得懂）
    // * 含汉字 → 至少 2 个字，且不以虚词打头（`的谎言` 不行，`船坞` 可以）
    if (!leftover) return false;
    var allAscii = true;
    for (var i = 0; i < leftover.length; i += 1) {
      if (leftover.charCodeAt(i) >= 128) { allAscii = false; break; }
    }
    if (allAscii) return true;
    if (CHINESE_FUNCTION_CHARS[leftover[0]]) return false;
    return leftover.length >= 2;
  }

  // ---------------------------------------------------------------- 资源键规则

  function computeSharedResourceKeys(cycleResources) {
    // 复刻 record/index.html:2227-2240 的 `sharedResourceKeys`：
    // 在 c1..c5 的 resources 里出现 **>1 次** 的键算共享键（`core` sentinel 除外）。
    var table = cycleResources || ATO_CYCLE_RESOURCES;
    var counts = {};
    CYCLE_IDS.forEach(function (cycle) {
      var seen = {};
      (table[cycle] || []).forEach(function (key) {
        if (key === "core" || seen[key]) return;
        seen[key] = true;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    var shared = {};
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > 1) shared[key] = true;
    });
    return shared;
  }

  var SHARED_RESOURCE_KEYS = computeSharedResourceKeys();

  function definingCycle(rowKey) {
    // 该资源行最早在哪个循环被定义（同一 key 可能在多个循环里出现）。
    for (var i = 0; i < CYCLE_IDS.length; i += 1) {
      if ((ATO_CYCLE_RESOURCES[CYCLE_IDS[i]] || []).indexOf(rowKey) >= 0) return CYCLE_IDS[i];
    }
    return null;
  }

  function cyclesDefining(rowKey) {
    return CYCLE_IDS.filter(function (cycle) {
      return (ATO_CYCLE_RESOURCES[cycle] || []).indexOf(rowKey) >= 0;
    });
  }

  function atoResourceKey(rowKey) {
    // ATO 资源存储键：共享键不带前缀，其余用**定义它的那个循环**的前缀。
    //
    // 这条规则来自 record/index.html:4621 `resourceStorageKey()`：
    //     sharedResourceKeys.has(key) ? key : `${state.cycle}-${key}`
    // `state.cycle` 是定义该行的循环（切到 c1 时 c1 的行就是 `c1-xxx`）。
    // 真实存档校验（data/ato-campaign-1111.json 的 c1 档）：
    //   * `c1-trireme` / `c1-monument` / `c1-infusedMechanism` / `c1-calcifiedKnuckle`（c1 独有行）带前缀
    //   * `fearEssence` / `grotesqueBeak` / `powderedMatter` / `pygmalionStones`（多个循环都有的行）不带
    //   * `c1-core-pursuer` / `c1-core-hekaton`（动态核心行）也带前缀
    //
    // 注意：c4 与 c5 **都有**的行（`blackTaintedStepfinger`、`promisedFuturesCarcass`）也算共享键，
    // 所以存储键是不带前缀的裸名 —— 即使这个值是 c5 页签上的那一行。
    var cycle = definingCycle(rowKey);
    if (SHARED_RESOURCE_KEYS[rowKey] || cycle === null) return rowKey;
    return cycle + "-" + rowKey;
  }

  // ---------------------------------------------------------------- ATO 地图瓦片

  function loadAtoMapTiles(data) {
    // 返回 { cycle: [tileId, ...] }。数据来自 map/map-data.js（`window.ATO_MAP_DATA = {...}`）。
    // 用来决定 `map...tokens.AG/AD` 里 tileId 的写法（真实数据是 `"001"` 这种补零串）。
    var source = data || root.ATO_MAP_DATA || null;
    if (!source) return {};
    var out = {};
    (source.cycles || []).forEach(function (cycle) {
      out[cycle && cycle.id] = ((cycle && cycle.tiles) || []).map(function (tile) {
        return String(tile && tile.id);
      });
    });
    return out;
  }

  // ---------------------------------------------------------------- 笔记区块常量
  // （导不进 ATO 的官方内容 → 记录表笔记区块；见 buildUnimportedNotes）

  // 区块的前后标识：人一眼能认出这段不是自己写的；stripNotesBlock() 靠它保证重跑不叠两份。
  var NOTES_BLOCK_BEGIN = "──────── 官方存档未导入项（由 .jsave 导入生成，勿手改） ────────";
  var NOTES_BLOCK_END = "──────── 官方存档未导入项 结束 ────────";
  var NOTES_BLOCK_CUT = "（明细已截断，完整内容见导入报告）";
  var NOTES_BLOCK_LIMIT = 4000;     // 整个区块（含前后标识行）的字符上限
  var NOTES_ARRAY_LIMIT = 12;       // 数组/列表超过 12 项才截断
  var NOTES_ARRAY_KEEP = 8;         // 截断时留前 8 项
  var NOTES_VALUE_LIMIT = 160;      // 单行值（字典/长文本压成一行后）的字符上限

  // 官方顶层键里「ATO 完全没有落点」的那些：不硬塞进没有 UI 的死字段（用户看不到），
  // 而是以文本形式写进 `record.notes` 的带标识区块（用户指定）。键 → 区块里的中文标签。
  var NOTES_KEYS = {
    campaign_uid: "战役 UID",
    campaign_start_date: "战役开始时间",
    campaign_name: "战役名",
    battle_logs: "战斗记录",
    mnestis_boss_tracks: "忆识剧场 boss 轨道",
    mnestis_notes: "忆识剧场笔记",
    mnestis_tears: "忆识剧场泪珠/登升核心",
    mnestis_cores: "忆识剧场泪珠/登升核心",
    mnestis_knosckouts: "忆识剧场泪珠/登升核心",
    crypric_languages: "密语语言",
    loadout_list: "配装",
    timeline_tloops: "时间回环",
    portal_target: "传送门目标",
    argo_stats_lims: "属性上限无落点",
    next_battle_notes: "下战斗笔记",
    campaign_tile_notes: "地图格笔记"
  };

  // 「不必导」而不是「导不进」的官方界面偏好 / 格式版本：刻意不写进笔记（写了只是噪音）。
  var NOTES_SKIP_KEYS = { save_version: true };
  var NOTES_SKIP_PATTERNS = ["search_options"];

  // 本转换器消费（读并落到某处）的官方顶层键。
  var CONSUMED_KEYS = {
    campaign_cycle: "→ dashboard cycles.<cN> / record.cycle",
    campaign_stats: "→ record.storyCard / doomCard / dashboard.cardTracks / record.day",
    player_names: "→ heroes[].playerName",
    "argonaut_%d": "→ heroes[]（在役）",
    dead_argonauts: "→ heroes.graveyard",
    retired_argonauts: "→ heroes.graveyard",
    argo_stats_vals: "→ record 具名字段 + cycleStats（16/21）",
    cargo_resources: "→ record.resources",
    rres_names: "→ record.resources['rare']（`名称x值`）",
    rres_vals: "→ record.resources['rare']（`名称x值`）",
    evo: "→ record.enemies（阶段布尔）+ record.nemesisSelections",
    maps: "→ map...cycles.<c>.tokens.AG/AD + tileVariants",
    gf_names: "→ record.godforms",
    gf_used: "→ record.godformUsedCards",
    smn_names: "→ record.nymphCards",
    smn_used: "→ record.nymphUsedCards",
    titan_names: "→ record.titans[].name",
    titan_cripl: "→ record.titans[].crippled",
    dead_titans: "→ record.deadTitans（字符串，顶层、不按循环）",
    pygmalion: "→ record.pygmalion",
    echo_track: "→ record.pygmalion['echoes-progress-N']（回响轨前 N 格）",
    diplomacy_factions: "→ record.diplomacy",
    adventures: "→ record.adventures",
    matrix: "→ record.matrix（布尔格）",
    matrix_notes: "→ record.matrix（T/L/圈/划） + record.notes（残留）",
    campaign_notes: "→ record.notes",
    tally_lbls: "→ record.counters",
    tally_marks: "→ record.counters",
    timeline_status: "→ dashboard.<cN>.state.day",
    timeline_notes: "→ dashboard.<cN>.state.dateNotes",
    gear_list: "→ record.arsenal",
    tech_deck_list: "→ technology.unlocked（筛选用）",
    tech_id_list: "→ technology.unlocked（卡号）"
  };

  // ---------------------------------------------------------------- 笔记区块的格式化

  function clipText(text, limit) {
    // 按字符数截断（超长加 `…`）。JS 的字符串下标即 UTF-16 码元，与 Python 的字符
    // 计数在 BMP 内一致；官方存档文本全是 BMP，够用。
    limit = limit === undefined ? NOTES_VALUE_LIMIT : limit;
    var value = String(text);
    if (value.length <= limit) return value;
    return value.slice(0, Math.max(0, limit - 1)) + "…";
  }

  function fmtNoteArray(values, limit) {
    // 数组 → 一行；超过 12 项按「前 8 项 + … +（共 N 项）」截断。
    if (!isList(values)) return clipText(values, limit);
    if (!values.length) return "（空）";
    if (values.length > NOTES_ARRAY_LIMIT) {
      var head = values.slice(0, NOTES_ARRAY_KEEP).map(jsonAscii).join(", ");
      return clipText("[" + head + ", …]（共 " + values.length + " 项）", limit);
    }
    return clipText(jsonAscii(values), limit);
  }

  function fmtNotePairs(pairs, limit) {
    // [(名称, 值)] → `A=1, B=2`；超过 12 项同样「留前 8 + （共 N 项）」。
    var items = pairs.map(function (pair) { return pair[0] + "=" + pair[1]; });
    if (!items.length) return "（无）";
    if (items.length > NOTES_ARRAY_LIMIT) {
      return clipText(items.slice(0, NOTES_ARRAY_KEEP).join(", ") + ", …（共 " + items.length + " 项）", limit);
    }
    return clipText(items.join(", "), limit);
  }

  function fmtNoteList(items, sep, limit) {
    // 字符串列表 → 一行（空项丢弃）；超过 12 项同样截断。
    sep = sep === undefined ? "、" : sep;
    var words = items.map(String).filter(function (word) { return word.trim().length > 0; });
    if (!words.length) return "（空）";
    if (words.length > NOTES_ARRAY_LIMIT) {
      return clipText(words.slice(0, NOTES_ARRAY_KEEP).join(sep) + "…（共 " + words.length + " 项）", limit);
    }
    return clipText(words.join(sep), limit);
  }

  function fmtNoteValue(value, limit) {
    // 任意官方值 → 一行：数组走截断规则，字典压成一行 JSON，空值写「（空）」。
    if (isList(value)) return fmtNoteArray(value, limit);
    if (isDict(value)) return Object.keys(value).length ? clipText(jsonAscii(value), limit) : "（空）";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null || value === undefined || value === "") return "（空）";
    return clipText(value, limit);
  }

  function fmtBattleLog(entry) {
    // 战报一条 → `{id:0, lvl:0, outcome:true, ko:0}`（键序固定，便于肉眼比对）。
    if (!isDict(entry)) return fmtNoteValue(entry);
    var order = ["id", "lvl", "outcome", "ko"];
    var keys = order.filter(function (key) { return key in entry; })
      .concat(Object.keys(entry).filter(function (key) { return order.indexOf(key) < 0; }).sort());
    return "{" + keys.map(function (key) {
      return key + ":" + jsonAscii(entry[key]);
    }).join(", ") + "}";
  }

  function fmtLanguages(lang) {
    // 密语模型 → 一行：三套字母的已解译格数 + 字母映射（长的那个截断）。
    function decoded(langKey, knownKey) {
      var known = lang[knownKey];
      if (isList(known) && known.length) {
        return [known.filter(Boolean).length, known.length];
      }
      return null;
    }

    var parts = [];
    var counts = [];
    [["centi", "cent_lang", "known_centies"], ["babyl", "babyl_lang", "known_babyls"]]
      .forEach(function (spec) {
        var hit = decoded(spec[1], spec[2]);
        if (hit) counts.push(spec[0] + " " + hit[0] + "/" + hit[1]);
      });
    if (counts.length) parts.push("已解译 " + counts.join("、"));
    if ("wiped" in lang) parts.push("wiped=" + (lang.wiped ? "true" : "false"));
    ["cent_lang", "siren_lang", "babyl_lang"].forEach(function (key) {
      if (truthy(lang[key]) && key === "cent_lang") {
        parts.push(key + "=" + fmtNoteArray(lang[key], 64));
      }
    });
    // siren_lang / babyl_lang 合成一段「siren_lang/babyl_lang 各 N 项」
    // （N 取列表里**第一个有值**的那条的长度 —— 照抄 Python：`len(lang[others[0]])`）
    var others = ["siren_lang", "babyl_lang"].filter(function (key) { return truthy(lang[key]); });
    if (others.length) {
      parts.push(others.join("/") + " 各 " + lang[others[0]].length + " 项");
    }
    var translated = ["centi_translations", "siren_translations", "babyl_translations"]
      .map(function (key) { return (lang[key] || []).length; });
    parts.push("translations centi/siren/babyl=" + translated.join("/") + " 条");
    return clipText(parts.join("；") || "（空）");
  }

  function fmtLoadouts(loadouts, limit) {
    // 配装 → 一行：每套 `「标题」Titan N=M 件`；整组 gear_ids 全空的写明「均为空」。
    if (!loadouts || !loadouts.length) return "（空）";
    var parts = [];
    var prefs = 0;
    loadouts.slice(0, NOTES_ARRAY_LIMIT).forEach(function (item) {
      if (!isDict(item)) return;
      var title = String(item.loadout_title || "（无题）");
      var titans = (item.titan_loadouts || []).filter(isDict);
      var filled = [];
      titans.forEach(function (titan) {
        var ids = titan.gear_card_ids || [];
        if (ids.length) {
          filled.push(String(titan.titan_loadout_title || "?") + "=" + ids.length + " 件");
        }
        if (truthy(titan.gear_card_prefs) || truthy(titan.gear_card_notes)) prefs += 1;
      });
      if (filled.length) parts.push("「" + title + "」" + filled.join("、"));
      else {
        var slots = titans.map(function (titan) {
          return String(titan.titan_loadout_title || "?");
        }).join("/") || "无泰坦槽";
        parts.push("「" + title + "」→ " + slots + "（gear_ids 均为空）");
      }
    });
    var text = parts.join("；");
    if (loadouts.length > NOTES_ARRAY_LIMIT) text += "…（共 " + loadouts.length + " 套）";
    if (prefs) text += "（另有 gear_card_prefs/notes " + prefs + " 组非空，未展开）";
    return clipText(text, limit);
  }

  function extractNotesBlock(text) {
    // 取出 notes 里已存在的区块（含前后标识行）；没有则返回空串。
    if (typeof text !== "string") return "";
    var begin = text.indexOf(NOTES_BLOCK_BEGIN);
    if (begin < 0) return "";
    var end = text.indexOf(NOTES_BLOCK_END, begin + NOTES_BLOCK_BEGIN.length);
    if (end < 0) return text.slice(begin);      // 只有开始标识 → 后面的全算旧区块
    return text.slice(begin, end + NOTES_BLOCK_END.length);
  }

  function stripNotesBlock(text) {
    // 剥掉旧区块（含标识行）→ 剩下的用户原文。重跑/二次导入靠它不叠两份。
    if (typeof text !== "string") return "";
    var block = extractNotesBlock(text);
    if (!block) return text;
    // 区块前后各带一个换行时，连那个换行一起剥掉，免得留下空行（会让重跑结果与首次不一致）
    var patterns = ["\n" + block, block + "\n", block];
    for (var i = 0; i < patterns.length; i += 1) {
      if (text.indexOf(patterns[i]) >= 0) {
        return text.replace(patterns[i], "").replace(/^\n+/, "").replace(/\n+$/, "");
      }
    }
    return text;
  }

  // ---------------------------------------------------------------- 转换器

  function Converter(tables, dropDeadSlots) {
    this.tables = tables;
    this.drop_dead_slots = Boolean(dropDeadSlots);
    this.argo_order = ARGO_STATS_ORDER;
    this.cargo_order = cargoResourceOrder();
    this.skill_order = ARGONAUT_SKILLS_ORDER;
    this.hubs = adventureHubs();
    this.factions = diplomacyFactions();
    this.tech_names = techCardNames();
    this.gear_names = gearCardIds();
    this.map_tiles = tables.mapTiles || loadAtoMapTiles();
    this.official_keys = [];
    this.warnings = [];
    this.stats = {};
    this.matrix_rows = [];
  }

  // -------- dashboard

  Converter.prototype.leadingTrue = function (flags) {
    // 从 0 开始的连续 true 段长度；非连续时取最长前缀并告警。
    var count = 0;
    for (var i = 0; i < flags.length; i += 1) {
      if (flags[i]) count += 1;
      else break;
    }
    var total = flags.filter(Boolean).length;
    if (count !== total) {
      this.warnings.push(
        "timeline_status 非连续：前缀 " + count + " 格为 true，但全表共 " + total + " 格 true；"
        + "ATO 只按前缀换算天数，后续 true 格会丢失。");
    }
    return count;
  };

  Converter.prototype.buildDashboard = function (official, cycleId) {
    var state = {};
    var timeline = official.timeline_status || [];
    // 官方的 timeline 是 **0 基下标**：81 格全 true = 下标 0..80 = 游戏内第 80 天
    // （用户在游戏内核对：campaign_0000 的 day = 80，已确认差 1 的疑问）。
    // 所以天数是「最后一个 true 的下标」，不是 true 的个数；0 格 true（全新战役）→ 第 0 天。
    var marked = timeline.length ? this.leadingTrue(timeline) : 0;
    var day = Math.max(0, marked - 1);
    state.day = day;

    var dateNotes = {};
    (official.timeline_notes || []).forEach(function (note, index) {
      if (note) dateNotes[("0" + index).slice(-2)] = note;
    });
    state.dateNotes = dateNotes;

    // cardTracks 真实结构（data/ato-campaign-11111.json）：
    //   {"story": {"position": int, "progress": int, "doom": int}, "doom": {...},
    //    "inwardOdyssey": {...}}
    // 官方只有 story_card / doom_card / inward，没有 position/progress 的子结构。
    var stats = official.campaign_stats || {};
    var storyCard = stats.story_card;
    var doomCard = stats.doom_card;
    // inwardOdyssey.position = 阿尔戈号知识起点（index.html:4451 argoKnowledgeStart）
    var inwardPosition = ARGO_KNOWLEDGE_START[cycleId] === undefined ? 0 : ARGO_KNOWLEDGE_START[cycleId];
    // inwardOdyssey.progress = 官方 inward 布尔。
    // 用户确认语义：这个槽**最多只能放 1 个进展**，所以官方直接用布尔表示（true → 1，false → 0）
    // —— 不是"猜的转换"，而是官方表达方式就是 0/1。
    var inwardProgress = stats.inward ? 1 : 0;
    // 卡上的 TOKENS = ATO 卡轨的「进展」计数器。依据官方 SAVE 屏截图（对话内已核对）：
    // 每张卡只有一个 TOKENS 槽，story_tokens=-1 时该槽为空、doom_tokens=1 时显示 1；
    // 且 ATO 自己提示「在故事步骤放置 1 个进展」→ 卡上的指示物就是「进展」。
    // 官方用 -1 表示"未设置" → ATO 用 0。
    // ATO 的 doom 轨另有「灾祸」计数器（cardTracks.doom.doom），官方无此维度 → 保持 0。
    var storyProgress = stats.story_tokens;
    var doomProgress = stats.doom_tokens;
    state.cardTracks = {
      story: {
        position: (typeof storyCard === "number" && Number.isInteger(storyCard) && storyCard >= 0)
          ? storyCard : 0,
        progress: (typeof storyProgress === "number" && Number.isInteger(storyProgress))
          ? Math.max(0, storyProgress) : 0,
        doom: 0
      },
      doom: {
        position: (typeof doomCard === "number" && Number.isInteger(doomCard) && doomCard >= 0)
          ? doomCard : 0,
        progress: (typeof doomProgress === "number" && Number.isInteger(doomProgress))
          ? Math.max(0, doomProgress) : 0,
        doom: 0
      },
      inwardOdyssey: { position: inwardPosition, progress: inwardProgress, doom: 0 }
    };
    state.cardTracksVersion = 2;

    this.stats.day = day;
    this.stats.dateNotes = Object.keys(dateNotes).length;
    this.stats.inward = stats.inward;
    this.stats.inward_progress = inwardProgress;
    return state;
  };

  // -------- record

  Converter.prototype.rowKeyOf = function (name) {
    // 官方货舱枚举名 → ATO 的记录表行 key（不含循环前缀）。
    if (CORE_SHORT[name]) return "core-" + CORE_SHORT[name];
    return CARGO_NAME_OVERRIDES[name] || camel(name);
  };

  Converter.prototype.storageKeyOf = function (name) {
    // 官方货舱枚举名 → ATO 的 resources 存储键。
    if (CORE_SHORT[name]) {
      var cycle = CORE_CYCLE[name] || definingCycle("core-" + CORE_SHORT[name]);
      return cycle ? cycle + "-core-" + CORE_SHORT[name] : "core-" + CORE_SHORT[name];
    }
    return atoResourceKey(this.rowKeyOf(name));
  };

  Converter.prototype.buildResources = function (official, cycleId) {
    var self = this;
    var resources = {};
    var keymap = {};
    this.cargo_order.slice(0, 85).forEach(function (name) {
      keymap[name] = self.storageKeyOf(name);
    });
    var rows = {};
    (ATO_CYCLE_RESOURCES[cycleId] || []).forEach(function (row) { rows[row] = true; });
    // ATO **任意循环**里出现过的行（用来判「官方这一项 ATO 根本没有对应行」，
    // 例如 UMBRAL_COUNT / STRING_WISH / STRING_WISH_PICK）；core / rare 是 sentinel 行，不算。
    var rowsAnywhere = {};
    Object.keys(ATO_CYCLE_RESOURCES).forEach(function (cycle) {
      ATO_CYCLE_RESOURCES[cycle].forEach(function (name) {
        if (name !== "core" && name !== "rare") rowsAnywhere[name] = true;
      });
    });
    var values = official.cargo_resources || [];
    var written = 0;
    var skippedZero = 0;
    var zeroWithKey = 0;
    var notInCycleRows = [];
    var unrenderedNonzero = [];
    var detail = [];
    this.cargo_order.slice(0, 85).forEach(function (name, index) {
      var value = index < values.length ? values[index] : 0;
      var rowKey = self.rowKeyOf(name);
      var core = Boolean(CORE_SHORT[name]);
      var inRows = core ? (CORE_CYCLE[name] === cycleId || Boolean(rows[rowKey])) : Boolean(rows[rowKey]);
      var storage = keymap[name];
      if (!inRows) notInCycleRows.push(name);
      if (!truthy(value)) {
        skippedZero += 1;
        if (inRows) zeroWithKey += 1;
      } else {
        resources[storage] = pyInt(value);
        written += 1;
        if (!inRows) unrenderedNonzero.push(name + "=" + value);
      }
      detail.push({
        index: index, official: name, value: pyInt(value || 0),
        row_key: rowKey, storage_key: storage,
        defining_cycle: core ? CORE_CYCLE[name] : definingCycle(rowKey),
        cycles: core && CORE_CYCLE[name] ? [CORE_CYCLE[name]] : cyclesDefining(rowKey),
        shared: !CORE_SHORT[name] && Boolean(SHARED_RESOURCE_KEYS[rowKey]),
        visible_now: inRows,
        // 「ATO 有对应行」= 行 key 直接命中，或只是命名变体
        // （SUPERSOLID_RELIEF_MASS → supersolidReliefMass，ATO 那行叫 supersolidRelief）
        ato_row: core || Boolean(rowsAnywhere[rowKey])
          || Object.keys(rowsAnywhere).some(function (row) {
            return rowKey.indexOf(row) >= 0 || row.indexOf(rowKey) >= 0;
          }),
        written: Boolean(value)
      });
    });

    // 稀有资源：ATO 是跨循环共享的一行文本（record/index.html:1840 resources["rare"]），
    // 用户指定格式：`名称` + 小写 x + `值`，逐条一行（textarea 支持换行）。
    // 名称里含空格也原样保留；值缺失/为负按 0 处理。
    var rareNames = (official.rres_names || []).map(String);
    var rareVals = official.rres_vals || [];
    var rareLines = [];
    var rarePairs = [];
    rareNames.forEach(function (name, index) {
      if (!name.trim()) return;
      var raw = index < rareVals.length ? rareVals[index] : null;
      var value = pyInt(raw);
      if (Number.isNaN(value)) value = 0;
      if (value < 0) value = 0;
      var line = name + RARE_VALUE_SEP + value;
      rareLines.push(line);
      rarePairs.push({ name: name, value: value, line: line, raw: raw, missing: raw === null });
    });
    if (rareLines.length) resources.rare = rareLines.join("\n");

    this.stats.resource_rows = written;
    this.stats.resource_zero_rows = skippedZero;
    this.stats.zero_with_key = zeroWithKey;
    this.stats.not_in_cycle_rows = notInCycleRows;
    this.stats.unrendered_nonzero = unrenderedNonzero;
    this.stats.resource_detail = detail;
    this.stats.rare_lines = rareLines;
    this.stats.rare_pairs = rarePairs;
    this.stats.rare_names = rareNames.length;
    this.stats.rare_vals = rareVals.length;
    return { resources: resources, keymap: keymap };
  };

  Converter.prototype.buildAdventures = function (official, cycleId) {
    // 官方 adventures[41] → ATO record.adventures 字典。
    //
    // 官方第 k 条按 adventure_hubs 顺序拿 adv_count；
    // adv_progress 长度 = 1 + adv_count + 1，依次 α → adv1..advN → Ω。
    // ATO 键 = `<cycle>-<本轮 hub 序号从 0 起>-<槽位>`（record/index.html:4103, 4112）。
    var self = this;
    var hubs = this.hubs;
    var cycleName = "CYCLE_" + ("0" + (CYCLE_IDS.indexOf(cycleId) + 1)).slice(-2);
    var mine = hubs.filter(function (hub) { return hub.cycle === cycleName; });
    var adventures = {};
    var cells = 0;
    var mismatch = [];
    var list = official.adventures || [];
    mine.forEach(function (hub, localIndex) {
      var k = hubs.indexOf(hub);
      var entry = k < list.length ? list[k] : null;
      if (entry === null || entry === undefined) {
        mismatch.push([hub.hub, "官方存档缺该条目"]);
        return;
      }
      var progress = entry.adv_progress || [];
      var expected = 1 + pyInt(hub.adv_count) + 1;
      if (progress.length !== expected) {
        mismatch.push([hub.hub, "adv_progress 长度 " + progress.length + " ≠ 1+" + hub.adv_count
          + "+1=" + expected]);
      }
      progress.forEach(function (value, slotIndex) {
        var slot;
        if (slotIndex === 0) slot = "alpha";
        else if (slotIndex === progress.length - 1) slot = "omega";
        else slot = "mid" + slotIndex;
        if (!value) return;      // 0 不写（见报告「取舍」）
        adventures[cycleId + "-" + localIndex + "-" + slot] = true;
        cells += 1;
      });
    });
    this.stats.adventure_cells = cells;
    this.stats.adventure_hubs_seen = mine.length;
    this.stats.adventure_mismatch = mismatch;
    return adventures;
  };

  Converter.prototype.buildDiplomacy = function (official, cycleId) {
    // 官方 `diplomacy_factions[3]`（整数数组）→ `record.diplomacy["<cN>-<faction>"]`。
    //
    // **按名字映射，不按下标**：官方表的顺序与 ATO `cycleData.<c>.diplomacy` 数组顺序在
    // c4 / c5 上不一致（c4 的 aristotelians/wasters 互换；c5 三家整体轮换），
    // 所以这里用「官方数组下标 ↔ 官方表里同 cycle 的第 i 个 `f_*`」配对，
    // 每个 `f_*` 再经 `FACTION_TO_ATO` 落到 ATO 键 —— 绝不 `zip` 两边的数组。
    var cycleName = "CYCLE_" + ("0" + (CYCLE_IDS.indexOf(cycleId) + 1)).slice(-2);
    var targets = this.factions.filter(function (faction) {
      return faction.cycle === cycleName && String(faction.id).indexOf("f_") === 0;
    });
    var values = official.diplomacy_factions || [];
    var diplomacy = {};
    var unmapped = [];
    var audit = [];
    targets.forEach(function (faction, index) {
      var value = index < values.length ? values[index] : 0;
      var key = FACTION_TO_ATO[faction.id];
      if (!key) {
        unmapped.push(faction.id);
        return;
      }
      var full = cycleId + "-" + key;
      diplomacy[full] = String(value);
      audit.push({
        index: index, official_id: faction.id,
        ato_key: full, value: String(value)
      });
    });
    if (unmapped.length) this.warnings.push("阵营 id 无 ATO 对应：" + unmapped.join(", "));
    if (values.length > targets.length) {
      this.warnings.push(
        "diplomacy_factions 有 " + values.length + " 项，本轮只认前 " + targets.length + " 项（官方表里同 cycle 的 "
        + "`-10`/`0` 行是外交轨道区间标记，不是阵营）");
    }
    this.stats.diplomacy_rows = Object.keys(diplomacy).length;
    this.stats.diplomacy_audit = audit;
    return diplomacy;
  };

  Converter.prototype.buildMatrix = function (official) {
    // 矩阵 384 格 + 备注。返回 (matrix_dict, note_lines, 核对行列表)。
    var matrixRaw = official.matrix || [];
    var notesRaw = official.matrix_notes || [];
    var matrix = {};
    var noteLines = [];
    var rows = [];
    var total = Math.max(matrixRaw.length, notesRaw.length);
    for (var i = 0; i < total; i += 1) {
      var label = MATRIX_ROWS[Math.floor(i / MATRIX_COLS)] + String(i % MATRIX_COLS + 1);
      var officialFlag = i < matrixRaw.length ? Boolean(matrixRaw[i]) : false;
      var note = i < notesRaw.length ? notesRaw[i] : "";
      var parsed = note ? parseMatrixNote(note)
        : { value: null, leftover: "", consumed: [] };
      var value = parsed.value;
      var cell = null;
      if (value !== null) {
        matrix[label] = value;
        cell = value;
      } else if (officialFlag) {
        matrix[label] = true;
        cell = true;
      }
      var leftover = cleanLeftover(parsed.leftover);
      if (isOnlyMarkers(leftover)) leftover = "";
      var preserved = false;
      if (note && value !== null && leftover && !leftoverIsMeaningful(leftover)) {
        // 残留只剩虚词（`L 圈起来的谎言` → `的谎言`），读起来是断的，
        // 那就保留完整原文，别把备注切残。
        leftover = cleanLeftover(note);
        preserved = true;
      }
      var line = "";
      if (leftover) {
        line = label + " " + leftover;
        noteLines.push(line);
      }
      if (note) {
        rows.push({
          label: label,
          official: officialFlag,
          raw: note,
          value: cell,
          note_line: line,
          leftover: leftover,
          preserved: preserved
        });
      }
    }
    this.matrix_rows = rows;
    this.stats.matrix_marks = Object.keys(matrix).length;
    this.stats.matrix_notes_lines = noteLines.length;
    return { matrix: matrix, note_lines: noteLines, rows: rows };
  };

  Converter.prototype.buildTitans = function (official, seenIds) {
    var names = official.titan_names || [];
    var crippled = official.titan_cripl || [];
    var titans = [];
    names.forEach(function (rawName, index) {
      var name = String(rawName).trim();
      if (!name) return;
      titans.push({
        id: uniqueId("titan", seenIds),
        name: name,
        count: 1,
        limit: 1,
        crippled: index < crippled.length ? Boolean(crippled[index]) : false
      });
    });
    this.stats.titans = titans.length;
    this.stats.titan_dropped_blank = names.filter(function (name) {
      return !String(name).trim();
    }).length;
    return titans;
  };

  Converter.prototype.buildArsenal = function (official) {
    // 装备清单 → record.arsenal（键 = 官方装备卡号，值 {quantity, manufactured}）。
    //
    // `quantity` = 官方 `gear_card_number`（现有件数）；
    // `manufactured` **固定 0** —— ATO 的语义是「累计制造」，而官方的那个数字只是件数，
    // 没有任何信息能说明其中多少是造出来的，填 0 比编一个数字保守。
    var self = this;
    var arsenal = {};
    var missing = [];
    (official.gear_list || []).forEach(function (item) {
      var gearId = String(item.gear_card_id || "").trim().toUpperCase();
      if (!gearId) return;
      var quantity = item.gear_card_number;
      quantity = (typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 1)
        ? quantity : 1;
      if (gearId in arsenal) arsenal[gearId].quantity += quantity;
      else arsenal[gearId] = { quantity: quantity, manufactured: 0 };
      if (!self.gear_names[gearId]) missing.push(gearId);
    });
    this.stats.arsenal_items = Object.keys(arsenal).length;
    this.stats.arsenal_unknown_ids = missing;
    return arsenal;
  };

  Converter.prototype.buildTech = function (official, cycleId) {
    var self = this;
    var ids = official.tech_id_list || [];
    var deck = official.tech_deck_list || [];
    var unlocked = [];
    var untranslated = [];
    var unknown = [];
    ids.forEach(function (rawId, index) {
      if (index >= deck.length || !deck[index]) return;
      var cardId = String(rawId);
      var label = self.tech_names[cardId];
      if (!label) {
        untranslated.push(cardId);
        return;
      }
      var english = englishOf(label);
      if (!english) {
        untranslated.push(cardId);
        return;
      }
      unlocked.push(english.toLowerCase());
      if (!self.tech_names[cardId]) unknown.push(cardId);
    });
    this.stats.tech_unlocked = unlocked.length;
    this.stats.tech_untranslated = untranslated;
    this.stats.tech_deck_true = deck.filter(Boolean).length;
    this.stats.tech_unknown = unknown;
    return {
      currentCycle: "cycle" + (CYCLE_IDS.indexOf(cycleId) + 1),
      unlocked: unlocked
    };
  };

  // -------- heroes

  Converter.prototype._heroObject = function (entry, seenIds, officialNames, playerNames) {
    var template = String(entry.argonaut_template_id || "");
    var argonaut = template.indexOf("arg_") === 0 ? template.slice(4) : template;
    if (argonaut && !officialNames[argonaut]) {
      this.warnings.push("机师模板 " + template + " 去前缀后不在 ATO ARGONAUTS 列表里");
    }
    var skills = entry.skills || [];
    var baseSkills = {};
    SKILL_KEYS.forEach(function (key, index) {
      baseSkills[key] = index < skills.length ? pyInt(skills[index]) : 0;
    });

    var mnemos = {};
    var mnemosProgress = {};
    CYCLE_IDS.forEach(function (cycle) { mnemos[cycle] = []; });
    var mnemosKeys = entry.mnemos_keys || [];
    var mnemosVals = entry.mnemos_vals || [];
    mnemosKeys.forEach(function (key, index) {
      if (index >= mnemosVals.length) return;
      var value = mnemosVals[index];
      var split = splitKey(key);
      var cycle = split[0], suffix = split[1];
      if (!cycle) {
        if (String(key).trim()) this.warnings.push("无法解析记忆键：" + String(key));
        return;
      }
      var short = cycle + "_" + suffix;
      if (!mnemos[cycle]) mnemos[cycle] = [];
      mnemos[cycle].push(short);
      mnemosProgress[short] = pyInt(value);
    }, this);

    var fated = {};
    var fatedProgress = {};
    CYCLE_IDS.forEach(function (cycle) { fated[cycle] = []; });
    var fatedKeys = entry.fmnemos_keys || [];
    var fatedVals = entry.fmnemos_vals || [];
    fatedKeys.forEach(function (key, index) {
      if (index >= fatedVals.length) return;
      var value = fatedVals[index];
      var split = splitKey(key);
      var cycle = split[0], suffix = split[1];
      if (!cycle) {
        if (String(key).trim()) this.warnings.push("无法解析宿命记忆键：" + String(key));
        return;
      }
      var short = "fm_" + cycle + "_" + suffix;
      if (!fated[cycle]) fated[cycle] = [];
      fated[cycle].push(short);
      fatedProgress[short] = pyInt(value);
    }, this);

    var tri = entry.triskelion || [0, 0, 0];
    // 官方 `TriskelionStat` 枚举的声明顺序是 **DANGER, RAGE, FATE**（IL2CPP 元数据，
    // app-extract/global-metadata.dat），而官方数组一律按枚举下标序列化 ——
    // 已被两处独立证实：`ArgoStats`(21) 与 `CargoResource`(86) 的顺序都与数组逐位吻合。
    // 所以 tri[0]=DANGER、tri[1]=RAGE、tri[2]=FATE；ATO 侧对应的键是
    // danger / fury（界面标签「怒气」，即 RAGE）/ fate。
    // ⚠️ 五份样例三值全为 0，数据无法自证；此为依据枚举顺序的推断（与本文件其他枚举一致）。
    var triskelion = {
      danger: tri.length > 0 ? pyInt(tri[0]) : 0,
      fury: tri.length > 1 ? pyInt(tri[1]) : 0,
      fate: tri.length > 2 ? pyInt(tri[2]) : 0
    };

    var playerId = entry.player_id;
    var names = playerNames;
    var playerName = "";
    if (typeof playerId === "number" && Number.isInteger(playerId)
      && playerId >= 0 && playerId < names.length && names[playerId]) {
      playerName = String(names[playerId]);
    } else if (typeof playerId === "number" && Number.isInteger(playerId) && playerId !== 0) {
      this.warnings.push("player_id=" + playerId + " 在 player_names（" + names.length + " 项）里取不到名字");
    }

    return {
      id: uniqueId("hero", seenIds),
      argonaut: argonaut,
      customName: String(entry.argonaut_name || ""),
      playerName: playerName,
      basicSkill: "",
      skillsExpanded: false,
      baseSkills: baseSkills,
      mnemos: mnemos,
      mnemosProgress: mnemosProgress,
      mnemosNodeProgress: [],
      mnemosTags: [],
      fatedMnemos: fated,
      fatedProgress: fatedProgress,
      triskelion: triskelion,
      abilities: (entry.abilities || []).map(String).filter(function (text) {
        return text.trim().length > 0;
      }).join("\n"),
      notes: (entry.notes || []).map(String).filter(function (text) {
        return text.trim().length > 0;
      }).join("、")
    };
  };

  Converter.prototype.buildHeroes = function (official, officialNames, dropDeadSlots) {
    // 官方 4 个在役槽 + dead + retired 全部导入，一个不丢。
    //
    // **不做任何按名字的去重**：同名复用是这款游戏的常态（同一个模板死了再招一个新的），
    // campaign_0000 的墓园里 `arg_telebac` 出现 4 次、`arg_oleander` 3 次、`arg_orphan` 3 次，
    // 在役槽里的 ASTER/ORPHAN/OLEANDER 是**不同的个体**。
    // ATO 的 hero 有唯一 `id`，同名不冲突。
    var self = this;
    var seenIds = {};
    var heroes = [];
    var graveyard = [];
    var inService = [];
    var dead = official.dead_argonauts || [];
    var retired = official.retired_argonauts || [];
    var playerNames = official.player_names || [];
    var noTemplate = [];
    function signature(entry) {
      return [String(entry.argonaut_template_id || ""), String(entry.argonaut_name || "")];
    }
    var deadSig = dead.map(signature);
    var retiredSig = retired.map(signature);
    var deadUsed = deadSig.map(function () { return false; });
    var retiredUsed = retiredSig.map(function () { return false; });
    var slotLabels = [];

    var inServiceSlots = [0, 1, 2, 3].filter(function (index) {
      return Boolean(official["argonaut_" + index]);
    });
    inServiceSlots.forEach(function (index) {
      var entry = official["argonaut_" + index];
      if (!entry) return;
      var sig = signature(entry);
      var dropped = false;
      if (dropDeadSlots) {
        [[deadSig, deadUsed], [retiredSig, retiredUsed]].forEach(function (pool) {
          if (dropped) return;
          var sigs = pool[0], used = pool[1];
          for (var i = 0; i < sigs.length; i += 1) {
            if (!used[i] && sigs[i][0] === sig[0] && sigs[i][1] === sig[1]) {
              used[i] = true;
              dropped = true;
              return;
            }
          }
        });
      }
      slotLabels.push("arg" + index + " " + entry.argonaut_name + "(" + entry.argonaut_template_id + ")"
        + (dropped ? "  [已丢弃：与墓园同名]" : ""));
      if (dropped) return;
      heroes.push(self._heroObject(entry, seenIds, officialNames, playerNames));
      inService.push(entry);
    });

    function toGrave(entry) {
      var hero = self._heroObject(entry, seenIds, officialNames, playerNames);
      if (!officialNames[hero.argonaut]) {
        noTemplate.push(entry.argonaut_name + "(" + entry.argonaut_template_id + ")");
      }
      var deathNote = String(entry.death_note || "").trim();
      var katharsis = String(entry.katharsis || "").trim();
      if (!deathNote) deathNote = "（官方存档 death_note 为空）";
      var merged = deepClone(hero);
      merged.retiredAt = "";
      merged.retireReason = deathNote;
      merged.katharsisCode = katharsis;
      graveyard.push(merged);
    }

    dead.forEach(toGrave);
    retired.forEach(toGrave);

    this.stats.heroes = heroes.length;
    this.stats.graveyard = graveyard.length;
    this.stats.hero_entities_expected = inServiceSlots.length + dead.length + retired.length;
    this.stats.hero_slots = slotLabels;
    this.stats.graveyard_no_ato_template = noTemplate;
    this.stats.katharsis_in_service = inService.map(function (entry) {
      return String(entry.katharsis || "");
    }).filter(function (text) { return text.trim().length > 0; });
    return { heroes: heroes, graveyard: graveyard };
  };

  Converter.prototype.buildSummon = function (official) {
    // gf_names/gf_used、smn_names/smn_used → ATO godforms / nymphCards 等。
    var self = this;
    var godforms = [], godformUsed = [];
    var gfNames = official.gf_names || [];
    var gfUsed = official.gf_used || [];
    gfNames.forEach(function (name, index) {
      var key = String(name).trim().toLowerCase();
      var atoId = GODFORM_ALIASES[key];
      if (!atoId) {
        self.warnings.push("神之形态 " + String(name) + " 无法映射到 ATO id");
        return;
      }
      if (godforms.indexOf(atoId) < 0) godforms.push(atoId);
      var used = index < gfUsed.length ? gfUsed[index] : undefined;
      if (used && godformUsed.indexOf(atoId) < 0) godformUsed.push(atoId);
    });

    var nymphs = [], nymphUsed = [];
    var unmappedNymphs = [];
    var smnNames = official.smn_names || [];
    var smnUsed = official.smn_used || [];
    smnNames.forEach(function (name, index) {
      var label = String(name).trim();
      if (!label) return;
      var atoId = NYMPH_IDS[label.toLowerCase()] ? label.toLowerCase() : null;
      if (!atoId) {
        unmappedNymphs.push(label);
        return;
      }
      if (nymphs.indexOf(atoId) < 0) nymphs.push(atoId);
      var used = index < smnUsed.length ? smnUsed[index] : undefined;
      if (used && nymphUsed.indexOf(atoId) < 0) nymphUsed.push(atoId);
    });

    this.stats.godforms = godforms.length;
    this.stats.godformUsedCards = godformUsed.length;
    this.stats.nymphCards = nymphs.length;
    this.stats.nymphUsedCards = nymphUsed.length;
    this.stats.nymph_unmapped = unmappedNymphs;
    return {
      godforms: godforms, nymphs: nymphs,
      godformUsed: godformUsed, nymphUsed: nymphUsed
    };
  };

  // -------- 总装

  Converter.prototype._statValue = function (name, values) {
    var index = this.argo_order.indexOf(name);
    if (index < 0) return 0;
    return index < values.length ? values[index] : 0;
  };

  Converter.prototype.buildStatLimits = function (statLims) {
    // 官方 argo_stats_lims[21] 与 ATO 上限字段对位（逐项，含无法对位者）。
    var rows = [];
    this.argo_order.forEach(function (name, index) {
      var value = index < statLims.length ? statLims[index] : 0;
      var field = STAT_LIMIT_TO_RECORD[name] || null;
      rows.push({
        index: index, name: name, value: value,
        ato_field: field,
        note: field ? "对位" : "ATO 没有这个上限字段"
      });
    });
    return rows;
  };

  // -------- 笔记区块：导不进 ATO 的官方内容

  Converter.prototype.buildUnimportedNotes = function (official, unmappedStats, limitRows) {
    // 官方存档里导不进 ATO 的内容 → 带前后标识的笔记区块（键见 NOTES_KEYS）。
    //
    // 规矩：**一行一项**、`中文标签：值`；值为空 / 全 0 / 全 false 的项也照写
    // （写明「（空）」「全 false（未使用）」），否则用户根本不知道官方还有这东西、
    // 以及它被忽略了。整个区块超过 NOTES_BLOCK_LIMIT 时按「先砍最长的明细、保留计数」压缩。
    var rows = [];

    function add(label, detail, short) {
      rows.push({ label: label, detail: detail, short: short === undefined ? null : short });
    }

    function has(key) { return key in official; }

    function stat(name, fallback) {
      var table = official.campaign_stats || {};
      return name in table ? table[name] : (fallback === undefined ? null : fallback);
    }

    // 战役元信息
    if (has("campaign_uid")) add("战役 UID", fmtNoteValue(official.campaign_uid));
    if (has("campaign_start_date")) add("战役开始时间", fmtNoteValue(official.campaign_start_date));
    if (has("campaign_name")) add("战役名", fmtNoteValue(official.campaign_name));

    // 战报
    var logs = official.battle_logs;
    if (isList(logs)) {
      add("战斗记录（" + logs.length + " 条）",
        fmtNoteList(logs.map(fmtBattleLog), "；"),
        logs.length + " 条（明细见导入报告）");
    }

    // 忆识剧场
    var tracks = official.mnestis_boss_tracks;
    if (isList(tracks)) {
      add("忆识剧场 boss 轨道（" + tracks.length + "）", fmtNoteArray(tracks),
        tracks.length + " 格（明细见导入报告）");
    }
    if (has("mnestis_tears") || has("mnestis_cores") || has("mnestis_knosckouts")) {
      var tears = official.mnestis_tears || [];
      var cores = official.mnestis_cores || [];
      // 注意这一行刻意用**压缩** JSON（Python 版这里传了 separators=(",", ":")），
      // 与同一区块里其它行的 `[0, 0, -1]` 松散写法不同 —— 照抄，别统一。
      add("忆识剧场泪珠/登升核心",
        "tears=" + compactJson(tears) + " cores=" + compactJson(cores)
        + " KO=" + fmtNoteValue(official.mnestis_knosckouts),
        "tears " + tears.length + " 项 / cores " + cores.length + " 项");
    }
    var mnotes = official.mnestis_notes;
    if (isList(mnotes)) {
      add("忆识剧场笔记（" + mnotes.length + " 条）", fmtNoteList(mnotes, "；"),
        mnotes.length + " 条");
    }

    // 密语语言
    var lang = official.crypric_languages;
    if (isDict(lang)) {
      add("密语语言", fmtLanguages(lang), "三套字母的映射未展开（见导入报告）");
    }

    // 配装
    var loadouts = official.loadout_list;
    if (isList(loadouts)) {
      add("配装（" + loadouts.length + " 套）", fmtLoadouts(loadouts),
        loadouts.length + " 套（明细见导入报告）");
    }

    // 时间回环
    var loops = official.timeline_tloops;
    if (isList(loops)) {
      var detail;
      if (loops.length && loops.every(function (flag) { return flag === false; })) {
        detail = "全 false（未使用）";
      } else if (loops.length && loops.every(function (flag) { return flag === true; })) {
        detail = "全 true";
      } else {
        detail = fmtNoteArray(loops);
      }
      add("时间回环（" + loops.length + " 格）", detail,
        loops.length + " 格（明细见导入报告）");
    }

    if (has("portal_target")) add("传送门目标", fmtNoteValue(official.portal_target));

    // 属性上限：没有对位字段的那 15 项 + 有字段但值为 0（写了会清空既有值）的那 6 项
    var noField = limitRows.filter(function (row) { return !row.ato_field; });
    var limitDetail = fmtNotePairs(noField.map(function (row) {
      return [row.name, row.value];
    }));
    var zeroed = limitRows.filter(function (row) {
      return row.ato_field && (row.value === null || row.value === 0 || row.value === "0");
    }).map(function (row) { return row.name; });
    if (zeroed.length) {
      limitDetail += "；另 " + zeroed.length + " 项有对位字段但值为 0（写了会清空既有值，故未写）："
        + zeroed.join("、");
    }
    add("属性上限无落点（" + noField.length + " 项）", limitDetail,
      noField.length + " 项（明细见导入报告）");

    // 属性值：ATO 没有具名字段的那几项
    add("属性值无落点（" + unmappedStats.length + " 项）",
      fmtNotePairs(unmappedStats.map(function (item) { return [item.name, item.value]; })),
      unmappedStats.length + " 项（明细见导入报告）");

    // campaign_stats.round_step
    var roundStep = stat("round_step");
    if (roundStep !== null && roundStep !== undefined) {
      add("轮次步骤", fmtNoteValue(roundStep) + "（语义未定，未导入）",
        fmtNoteValue(roundStep) + "（语义未定，未导入）");
    }

    // 官方 pygmalion（单整数）
    if (has("pygmalion")) {
      add("皮格马利翁（单整数）",
        fmtNoteValue(official.pygmalion) + "（粒度不同，未导入）",
        "粒度不同，未导入");
    }

    // 下战斗笔记
    var nextNotes = official.next_battle_notes;
    if (isList(nextNotes)) {
      add("下战斗笔记（" + nextNotes.length + " 条）", fmtNoteList(nextNotes, "、"),
        nextNotes.length + " 条（明细见导入报告）");
    }

    // 货舱里 ATO 根本没有对应行的项
    var noRow = (this.stats.resource_detail || []).filter(function (row) { return !row.ato_row; });
    add("资源无对应行（" + noRow.length + " 项）",
      fmtNotePairs(noRow.map(function (row) { return [row.official, row.value]; })),
      noRow.length + " 项（明细见导入报告）");

    // 地图格笔记
    var tileNotes = official.campaign_tile_notes;
    if (isList(tileNotes)) {
      add("地图格笔记（" + tileNotes.length + " 条）", fmtNoteList(tileNotes, "；"),
        tileNotes.length + " 条");
    }

    var block = this.assembleNotesBlock(rows);
    this.stats.notes_block_lines = rows.length;
    this.stats.notes_block = block;
    this.stats.notes_block_len = block.length;
    return block;
  };

  Converter.prototype.assembleNotesBlock = function (rows) {
    // 拼区块；超长时先砍最长的明细（保留计数），再不行就整行省略（标签留下）。
    function lineOf(row, mode) {
      if (mode === "cut") return row.label + "：（已省略，见导入报告）";
      if (mode === "short" && row.short) return row.label + "：" + row.short;
      return row.label + "：" + row.detail;
    }

    var modes = rows.map(function () { return "full"; });
    var truncated = false;

    function render() {
      return [NOTES_BLOCK_BEGIN].concat(rows.map(function (row, index) {
        return lineOf(row, modes[index]);
      }), [NOTES_BLOCK_END]);
    }

    while (render().join("\n").length > NOTES_BLOCK_LIMIT) {
      var best = null;
      rows.forEach(function (row, index) {        // 1) 砍最长的明细 → 计数版
        if (modes[index] === "full" && row.short) {
          if (best === null || row.detail.length > rows[best].detail.length) best = index;
        }
      });
      if (best !== null) {
        modes[best] = "short";
        truncated = true;
        continue;
      }
      rows.forEach(function (row, index) {        // 2) 还超 → 整行省略（留标签）
        if (modes[index] !== "cut") {
          if (best === null || lineOf(row, modes[index]).length
            > lineOf(rows[best], modes[best]).length) best = index;
        }
      });
      if (best === null) break;
      modes[best] = "cut";
      truncated = true;
    }

    var lines = render();
    if (truncated) lines.splice(lines.length - 1, 0, NOTES_BLOCK_CUT);
    return lines.join("\n");
  };

  Converter.prototype.buildEvo = function (official, cycleId) {
    // 官方 `evo` → `record.enemies`（阶段布尔字典）+ `record.nemesisSelections`。
    //
    // 键的构造规则抄自 record/index.html:3795-3801 `getEvolutionStageKey()`：
    //   * nemesis 敌人：`nemesis:<enemy>:<stageId>`
    //   * 共享轨道：   `<cycle>:shared:<a>+<b>:<stageId>`
    //   * 普通敌人：   `<cycle>:<enemy>:<stageId>`
    // 官方存档只给两个布尔数组 `evo_prim1_track` / `evo_prim2_track`，没有「哪个是哪个敌人」的
    // 信息，所以按本轮前两个敌人（nemesis 优先）顺序落位；无法落位的部分列进报告。
    var evo = official.evo || {};
    var enemies = {};
    var detail = { written: 0, dropped: [], note: "" };
    var nemesisSel = {};
    var adv = evo.evo_adversary;
    var options = NEMESIS_BY_CYCLE[cycleId] || [];
    if (typeof adv === "number" && Number.isInteger(adv) && adv >= 0 && adv < options.length) {
      nemesisSel[cycleId] = options[adv];
    } else if (adv !== null && adv !== undefined && adv !== 0) {
      detail.dropped.push("evo_adversary=" + adv + "（本轮 nemesis 选项只有 "
        + (options.join("/") || "无") + "）");
    }

    var cyclesEnemies = CYCLE_ENEMIES[cycleId] || [];
    // 排序：nemesis 选项优先，其余按 cycleData 顺序
    var ordered = options.filter(function (key) { return cyclesEnemies.indexOf(key) >= 0; })
      .concat(cyclesEnemies.filter(function (key) { return options.indexOf(key) < 0; }));
    var tracks = [["evo_prim1_track", "prim1"], ["evo_prim2_track", "prim2"]];
    tracks.forEach(function (track) {
      var trackName = track[0], label = track[1];
      var flags = evo[trackName] || [];
      if (!flags.length) return;
      if (!ordered.length) {
        detail.dropped.push(trackName + "：本轮没有可对位的敌人");
        return;
      }
      var enemy = ordered[0];
      ordered = ordered.slice(1);
      var stages = (CYCLE_ENEMY_STAGES[cycleId] || {})[enemy] || [];
      for (var i = 0; i < flags.length; i += 1) {
        if (i >= stages.length) {
          detail.dropped.push(trackName + " 第 " + (i + 1) + " 格：" + enemy + " 只有 "
            + stages.length + " 个阶段");
          break;
        }
        if (!flags[i]) continue;
        var stageId = stages[i];
        if (stageId === "spacer") {
          detail.dropped.push(trackName + " 第 " + (i + 1) + " 格对应 " + enemy + " 的占位格（无 markKey）");
          continue;
        }
        var key = options.indexOf(enemy) >= 0
          ? "nemesis:" + enemy + ":" + stageId
          : cycleId + ":" + enemy + ":" + stageId;
        enemies[key] = true;
        detail.written += 1;
      }
    });
    detail.note += ("共享轨道（`<cycle>:shared:<a>+<b>:<stage>`）未实现："
      + "需要 `stages[].sharedWith` 的信息，本次没解析；"
      + "落到共享格上的进度会记成对应敌人的普通格。");
    ["evo_adv_mode", "evo_track_history"].forEach(function (key) {
      if (key in evo) detail.dropped.push(key + "（ATO 无对应位置）");
    });
    if ("evo_adv_count" in evo) {
      detail.note += "evo_adv_count=" + evo.evo_adv_count + " 无对应字段；";
    }
    this.stats.evo = detail;
    this.stats.nemesis_selections = nemesisSel;
    this.stats.titanx_track_position = evo.evo_boss_count;
    return { enemies: enemies, nemesis: nemesisSel };
  };

  // 官方 `maps` → ATO 地图循环状态（`map...cycles.<c>`）。
  //
  // 官方每一格（实测 campaign_0005(4).jsave 的 maps[0]，80 格）都带这些键：
  //
  //   expl                 bool         已探索（63 格 true）→ `explored`
  //   revl                 bool         已揭示（7 格 true）→ `previewRevealed`，规则见下
  //   argo / advr          bool         阿尔戈 / 主仇敌位置 → `tokens.AG` / `tokens.AD`
  //   add_advr             [bool,bool]  额外仇敌（ATO 只有一个 `AD` 位，无落点）
  //   toks                 [bool × N]   格上指示物（N 随循环变：c2=4、c4=7、c5=8）
  //   reward_token         string       奖励指示物名字（**所有样例每格都是默认值 "Hull"**，
  //                                     只有 `has_reward_token` 为 true 才代表真的放着）
  //   has_reward_token     bool         该格是否放着奖励指示物（5 份样例全 false）
  //   has_generic_token    bool         该格是否放着通用指示物（5 份样例全 false）
  //   can_have_reward_token bool        该格能不能放奖励指示物（静态属性，c2 实测 31 格 true）
  //   note                 string       格笔记 → `tileNotes`
  //   alternative          bool         变体面 → `tileVariants[tileId] = "alternate"`
  //
  // 落位前提（任一不满足就**一个地图字段都不写**）：官方 `maps` 恰好一张、能读到
  // ATO 该轮地图的 tileId 表、且格数与官方地图**逐格一致** —— 下标对位差一格就会把
  // A 格的状态写到 B 格上，比不写更糟。
  //
  // `toks` / `reward_token` / `add_advr` 目前**不落位**：`toks` 的位序与位含义
  // （哪一个 bit 是黑喙 / 遗迹 / 通用指示物……）在 5 份样例里只出现过 7 个 true
  // （格 021 的 0+3 位、026 的 1 位、033/051/066 的 3 位、065 的 5 位），没有任何
  // 能把位序钉死的信息，且长度随循环变（c2=4、c4=7、c5=8），猜一个位序等于往
  // 用户的图上放错的指示物；`reward_token` 在所有样例里都是默认值 "Hull"（连
  // `has_reward_token` 为 false 的格子也一样），照写会让 80 格全部长出奖励指示物；
  // `add_advr` 在 ATO 里没有第二个仇敌位。三者都如实记进 `stats.map_detail.unmapped`
  // 与导入报告，不写进 `record.notes`（那会让 `record` 分区与冻结的 Python 参考
  // 快照产生差异，见 tests/jsave-import.test.cjs 的说明）。
  Converter.prototype.buildMapSection = function (official, cycleId) {
    var maps = official.maps || [];
    var empty = {
      tokens: {}, variants: {}, explored: {}, previewRevealed: {}, tileNotes: {}, written: false
    };
    var detail = { entries: maps.length, written: false, note: "" };
    var tileIds = this.map_tiles[cycleId] || [];
    if (maps.length !== 1) {
      detail.note = "官方存档有 " + maps.length + " 张地图，无法确定对应关系，未落位";
      this.stats.map_detail = detail;
      return empty;
    }
    var tiles = maps[0] || [];
    if (!tileIds.length || tiles.length !== tileIds.length) {
      detail.note = tileIds.length
        ? ("唯一一张地图有 " + tiles.length + " 格，而 ATO 的 " + cycleId + " 地图有 "
          + tileIds.length + " 格，格数不符，未落位")
        : ("读不到 map/map-data.js 里 " + cycleId + " 的格表，官方格下标换不成 ATO 的 "
          + "tileId（补零串），未落位");
      this.stats.map_detail = detail;
      return empty;
    }
    var tokens = {};
    var variants = {};
    var explored = {};
    var previewRevealed = {};
    var tileNotes = {};
    var tokTiles = [];
    var addAdvrTiles = [];
    var rewardTiles = [];
    tiles.forEach(function (tile, i) {
      if (!tile || typeof tile !== "object") return;
      var tileId = tileIds[i];
      if (!tileId) return;
      if (tile.argo) tokens.AG = tileId;
      if (tile.advr) tokens.AD = tileId;
      if (tile.alternative) variants[tileId] = "alternate";
      // `expl` 为 false 的格子绝不写进 `explored`。
      if (tile.expl === true) explored[tileId] = true;
      // `revl`：官方是**每格一个布尔**（本档 7 格），不是"单个最新揭示"。
      // ATO 侧只有两个「揭示」相关的键：
      //   `latestRevealedTile`  —— **单值字符串**，语义是"最近一次新翻开的板块"，
      //                            由 markTileExplored() 在**探索**时写入（map/app.js:612），
      //                            7 个标志位表达不了顺序，也不该由导入来编造顺序；
      //   `previewRevealed`     —— **集合**，"已揭示但还没探索"，渲染时与 explored 一样
      //                            显示正面（map/app.js:1347），markTileExplored() 会在
      //                            探索时把同名键删掉（map/app.js:611）。
      // 所以规则定为：`revl && !expl` → `previewRevealed[tileId] = true`（本档 3 格：
      // 008 / 065 / 070）。同时 expl=true 的 4 格（004 / 016 / 042 / 062）不写：
      // 它们已经由 `explored` 覆盖，ATO 自己在探索时也会删掉 previewRevealed。
      // 语义上仍有两种读法（"曾经揭示过" / "当前已揭示未探索"），两种读法下这条规则
      // 的结果一致（都是"未探索 + 已揭示"那部分），详见 map-import-work/report.md。
      if (tile.revl === true && tile.expl !== true) previewRevealed[tileId] = true;
      if (typeof tile.note === "string" && tile.note.trim()) tileNotes[tileId] = tile.note;
      if (Array.isArray(tile.toks) && tile.toks.some(Boolean)) tokTiles.push(tileId);
      if (Array.isArray(tile.add_advr) && tile.add_advr.some(Boolean)) addAdvrTiles.push(tileId);
      if (tile.has_reward_token === true || tile.has_generic_token === true) {
        rewardTiles.push(tileId);
      }
    });
    detail.written = true;
    detail.tokens = tokens;
    detail.variants = Object.keys(variants).length;
    detail.explored = Object.keys(explored).length;
    detail.preview_revealed = Object.keys(previewRevealed).length;
    detail.tile_notes = Object.keys(tileNotes).length;
    var unmapped = [];
    if (tokTiles.length) {
      unmapped.push({
        key: "toks",
        label: "格上指示物",
        tiles: tokTiles,
        reason: "官方 toks 的位序与位含义无法确认（位长随循环变），未落位"
      });
    }
    if (addAdvrTiles.length) {
      unmapped.push({
        key: "add_advr",
        label: "额外仇敌",
        tiles: addAdvrTiles,
        reason: "ATO 只有一个 AD（仇敌）位，额外的仇敌没有落点"
      });
    }
    if (rewardTiles.length) {
      unmapped.push({
        key: "reward_token",
        label: "奖励/通用指示物",
        tiles: rewardTiles,
        reason: "has_reward_token / has_generic_token 为 true 的格子无法对应 ATO 的指示物 id"
      });
    }
    detail.unmapped = unmapped;
    this.stats.map_detail = detail;
    this.stats.map_tokens = tokens;
    this.stats.map_variants = variants;
    this.stats.map_explored = explored;
    this.stats.map_preview_revealed = previewRevealed;
    this.stats.map_tile_notes = tileNotes;
    return {
      tokens: tokens,
      variants: variants,
      explored: explored,
      previewRevealed: previewRevealed,
      tileNotes: tileNotes,
      written: true
    };
  };

  // 供 buildHeroes 校验用的 ATO 机师 id 全集（hero/index.html:1030-1058）
  var ATO_ARGONAUT_IDS = {};
  ["odys", "circe", "phenelope", "telebac", "herakleides", "olympia", "leocules",
    "raz", "fisher", "hypatia", "anakreon", "anathea", "orphan", "aster", "dastan",
    "aktisaeos", "oleander", "omorfos", "blank10", "blank11", "blank12", "blank13",
    "blank14", "blank15", "blank16"
  ].forEach(function (id) { ATO_ARGONAUT_IDS[id] = true; });

  Converter.prototype.buildSections = function (official) {
    var self = this;
    this.official_keys = Object.keys(official);
    var cycleIndex = pyInt(official.campaign_cycle || 0);
    var cycleId = CYCLE_IDS[cycleIndex];
    var stats = official.campaign_stats || {};

    var dashboardState = this.buildDashboard(official, cycleId);
    var resourceResult = this.buildResources(official, cycleId);
    var resources = resourceResult.resources;
    var resourceKeymap = resourceResult.keymap;
    var adventures = this.buildAdventures(official, cycleId);
    var diplomacy = this.buildDiplomacy(official, cycleId);
    var matrixResult = this.buildMatrix(official);
    var matrix = matrixResult.matrix;
    var matrixNoteLines = matrixResult.note_lines;
    var seenIds = {};
    var titans = this.buildTitans(official, seenIds);
    var arsenal = this.buildArsenal(official);

    // record.notes = campaign_notes 逐条 + 矩阵残留行（用户自己的内容，显示在最上面）
    var notesLines = (official.campaign_notes || []).map(String).filter(function (text) {
      return text.trim().length > 0;
    });
    notesLines = notesLines.concat(matrixNoteLines);
    // 万一原文里夹带了上一轮生成的区块（把生成结果二次导入的情形），先剥掉再重拼 —— 幂等
    var baseNotes = stripNotesBlock(notesLines.join("\n"));
    var notes = baseNotes;

    var countersLines = [];
    var tallyLbls = official.tally_lbls || [];
    var tallyMarks = official.tally_marks || [];
    tallyLbls.forEach(function (rawLabel, index) {
      var label = String(rawLabel).trim();
      if (label) countersLines.push(label + " " + (index < tallyMarks.length ? tallyMarks[index] : undefined));
    });
    var counters = countersLines.join("\n");

    var statValues = official.argo_stats_vals || [];
    var statLims = official.argo_stats_lims || [];
    var record = {
      profileName: "阿尔戈号记录",
      cycle: cycleId,
      day: String(dashboardState.day),
      location: "",
      storyCard: String((stats.story_card === undefined ? "" : stats.story_card)),
      doomCard: String((stats.doom_card === undefined ? "" : stats.doom_card)),
      mapTiles: "",
      counters: counters,
      notes: notes,
      adventures: adventures,
      diplomacy: diplomacy,
      resources: resources,
      matrix: matrix,
      titans: titans,
      arsenal: arsenal
    };

    // 21 项属性：同时写 record.cycleStats[<cycle>]（真身）与顶层（当前循环的视图）
    var mapped = {};
    var unmappedStats = [];
    var cycleStatsEntry = {};
    this.argo_order.forEach(function (name, index) {
      var value = index < statValues.length ? statValues[index] : 0;
      var target = STAT_TO_RECORD[name];
      if (!target) {
        unmappedStats.push({ name: name, value: value });
        return;
      }
      var topField = target[0], cycleField = target[1];
      if (topField) record[topField] = String(value);
      if (cycleField) cycleStatsEntry[cycleField] = String(value);
      mapped[name] = { field: topField, cycle_field: cycleField, value: value };
    });
    this.stats.stats_mapped = Object.keys(mapped).length;
    this.stats.stats_unmapped = unmappedStats;

    // 官方 argo_stats_lims 与 ATO 的上限字段对位（详见报告 §6.2）
    var limitRows = this.buildStatLimits(statLims);
    var limitWritten = [];
    limitRows.forEach(function (row) {
      if (!row.ato_field || row.value === null || row.value === 0 || row.value === "0") return;
      record[row.ato_field] = String(row.value);
      if (CYCLE_IDENTITY_KEYS.indexOf(row.ato_field) >= 0) {
        cycleStatsEntry[row.ato_field] = String(row.value);
      }
      limitWritten.push(row.ato_field);
    });
    this.stats.stat_limit_rows = limitRows;
    this.stats.stat_limit_written = limitWritten;

    // 官方导不进 ATO 的内容 → 文本区块，追加在用户内容（campaign_notes + 矩阵残留）之后。
    // 区块内容每次都由官方存档重新生成，所以重跑不会叠两份。
    this.stats.notes_base = baseNotes;
    var block = this.buildUnimportedNotes(official, unmappedStats, limitRows);
    // `base_notes.rstrip("\n") + "\n" + block`：用户内容非空（只看空白与换行）时，
    // 去掉尾部换行再接区块；否则 notes 就是区块本身。
    notes = baseNotes.replace(/\n+$/, "").length
      ? baseNotes.replace(/\n+$/, "") + "\n" + block
      : block;
    record.notes = notes;

    // cycleStats：真身。除属性外，把 counters/notes/boons/afflictions/syncLog 也按循环放一份
    var cycleCounters = {
      storyCard: String((stats.story_card === undefined ? "" : stats.story_card)),
      doomCard: String((stats.doom_card === undefined ? "" : stats.doom_card)),
      mapTiles: "",
      counters: counters,
      notes: notes,
      boons: "",
      afflictions: "",
      syncLog: ""
    };
    Object.keys(cycleCounters).forEach(function (key) { cycleStatsEntry[key] = cycleCounters[key]; });
    // c2 的船员三格（船员/难民/俘虏，record/index.html:3675-3682）
    if (cycleId === "c2") {
      cycleStatsEntry.crewCounters = {
        crew: pyInt(this._statValue("CREW", statValues)),
        refugees: pyInt(this._statValue("REFUGEES", statValues)),
        captives: pyInt(this._statValue("CAPTIVES", statValues))
      };
    }
    record.cycleStats = {};
    record.cycleStats[cycleId] = cycleStatsEntry;
    record.cycleDays = {};

    var heroResult = this.buildHeroes(official, ATO_ARGONAUT_IDS, this.drop_dead_slots);
    var heroes = heroResult.heroes;
    var graveyard = heroResult.graveyard;
    var summon = this.buildSummon(official);
    // record.pygmalion 是「按轨道分格」的布尔字典，真实存档里观察到两种键：
    //   {"echoes-progress-0/1/2": bool}            ← 官方 echo_track（截图 ARGONAUTS 页
    //                                                 的 "ECHOES OF RECOLLECTION TRACK"）
    //   {"pygmalionStones-progress-0/1/2": bool}   ← 另一条轨道
    // 官方 echo_track 是整数（已标记的格数，五份样例全 0）→ 前 n 格置 true。
    // 官方另一个 `pygmalion`（单整数，样例=2）语义未确认，**不猜**，列报告待确认。
    var echoTrack = official.echo_track;
    var echoSteps = (typeof echoTrack === "number" && Number.isInteger(echoTrack) && echoTrack > 0)
      ? echoTrack : 0;
    // 格数取 3，与真实存档里观察到的键集一致（echoes-progress-0/1/2）。
    var pygmalion = {};
    for (var i = 0; i < 3; i += 1) pygmalion["echoes-progress-" + i] = i < echoSteps;
    this.stats.echo_track = echoTrack;
    this.stats.echo_steps = echoSteps;
    record.godforms = summon.godforms;
    record.nymphCards = summon.nymphs;
    record.godformUsedCards = summon.godformUsed;
    record.nymphUsedCards = summon.nymphUsed;
    record.pygmalion = pygmalion;
    record.maxUnlocked = {};

    // evo → record.enemies（阶段布尔字典）+ nemesisSelections；maps → map tokens
    var evoResult = this.buildEvo(official, cycleId);
    record.enemies = evoResult.enemies;
    record.nemesisSelections = evoResult.nemesis;

    // 官方 dead_titans（整数）→ record.deadTitans（字符串，顶层、不按循环；
    // 见 record/index.html:1610 输入框 / :2330 defaultState / :2738 normalize）。
    // 官方值为 0 时也要写 "0"（不是空串 —— 空串在界面上显示 "-"，含义是「未设置」）。
    var deadTitans = official.dead_titans;
    if (typeof deadTitans === "number" && Number.isInteger(deadTitans)) {
      record.deadTitans = String(Math.max(0, deadTitans));
    } else if (deadTitans !== null && deadTitans !== undefined) {
      var parsed = pyInt(deadTitans);
      record.deadTitans = Number.isNaN(parsed) ? "0" : String(Math.max(0, parsed));
    }
    this.stats.dead_titans = deadTitans;
    this.stats.dead_titans_written = record.deadTitans;

    var technologyUser = this.buildTech(official, cycleId);
    var cycle = { id: cycleId, state: dashboardState };
    var mapResult = this.buildMapSection(official, cycleId);

    var mapCycle = { tokens: deepClone(mapResult.tokens || {}) };
    // 已探索 / 已揭示（revl）/ 格笔记：只有整张地图真的落位了才写（格数不符时
    // buildMapSection 会整体放弃，这里也就不会用空字典把用户已有的地图状态抹掉）。
    if (mapResult.written) {
      mapCycle.explored = deepClone(mapResult.explored);
      mapCycle.previewRevealed = deepClone(mapResult.previewRevealed);
      mapCycle.tileNotes = deepClone(mapResult.tileNotes);
    }
    // 官方 campaign_stats.city_tile（截图「LAST VISITED CITY TILE O21」）→ ATO 地图的
    // 「最后到访的城市」标记：map/app.js:30 注册的 `last_city`，
    // 存法 `cycles.<c>.tokens.markers[<tileId>].last_city = true`
    // （实测真实存档里是 markers.027.last_city 这种形状）。
    // tileId 用三位补零串，与 AG/AD 同一套编号（实测 argo_tile=57 ↔ "057"）。
    var cityTile = (official.campaign_stats || {}).city_tile;
    if (typeof cityTile === "number" && Number.isInteger(cityTile) && cityTile >= 0) {
      if (!mapCycle.tokens.markers) mapCycle.tokens.markers = {};
      mapCycle.tokens.markers[("00" + cityTile).slice(-3)] = { last_city: true };
      this.stats.city_tile = ("00" + cityTile).slice(-3);
    }
    if (truthy(this.stats.map_variants)) {
      mapCycle.tileVariants = deepClone(this.stats.map_variants);
    }
    // 官方 next_battle_notes[]（自由文本数组）没有 terrain/hubId 结构，落不进
    // nextBattleTerrain 的 {terrain,hubId,boxId,hub,source,setAtDay} 形状 —— 见报告 §17。
    dashboardState.nextBattleTerrain = null;

    var sections = {
      dashboard: {
        activeProfileId: "default",
        profiles: {
          default: {
            id: "default",
            name: "默认用户",
            // 刻意不写 termLanguage：那是用户的界面偏好，官方存档没有来源，
            // 写死会覆盖用户已有设置（实测把 'official' 改成了 'fan'）。
            activeCycleId: cycleId,
            cycles: {}
          }
        }
      },
      record: { users: { default: record } },
      map: {
        users: {
          default: {
            activeCycleId: cycleId,
            cycles: {}
          }
        }
      },
      technology: {
        users: {
          default: Object.assign({}, technologyUser, {
            unimportant: [],
            conditions: []
            // treeLanguage / hideUnknownTech / hideTreeImage 同理：用户界面偏好，不写。
          })
        }
      },
      heroes: {
        heroes: heroes,
        activeHeroId: heroes.length ? heroes[0].id : "",
        graveyard: graveyard
      }
    };
    sections.dashboard.profiles.default.cycles[cycleId] = cycle;
    sections.map.users.default.cycles[cycleId] = mapCycle;

    this.stats.cycle_id = cycleId;
    this.stats.resource_keymap = resourceKeymap;
    this.stats.cycle_identity_keys = CYCLE_IDENTITY_KEYS;
    return sections;
  };

  // ---------------------------------------------------------------- 解析 .jsave 容器

  // 官方 58 个顶层键（campaign_0000 实测）。内容判定用它，不看扩展名。
  var OFFICIAL_TOP_KEYS = {};
  ["echo_track", "save_version", "campaign_name", "campaign_start_date", "campaign_cycle",
    "campaign_stats", "campaign_uid", "player_names", "argonaut_0", "argonaut_1",
    "argonaut_2", "argonaut_3", "dead_argonauts", "retired_argonauts", "argo_stats_vals",
    "argo_stats_lims", "cargo_resources", "rres_names", "rres_vals", "gf_names", "gf_used",
    "smn_names", "smn_used", "dead_titans", "titan_names", "titan_cripl", "pygmalion",
    "diplomacy_factions", "adventures", "matrix", "matrix_notes", "evo",
    "mnestis_boss_tracks", "mnestis_notes", "mnestis_tears", "mnestis_cores",
    "mnestis_knosckouts", "battle_logs", "maps", "portal_target", "campaign_notes",
    "next_battle_notes", "tally_lbls", "tally_marks", "campaign_tile_notes",
    "timeline_status", "timeline_notes", "timeline_tloops", "search_options_json",
    "gear_list", "loadout_list", "tech_deck_list", "tech_id_list", "ability_search_options",
    "production_search_options", "tech_search_options", "trade_search_options",
    "crypric_languages"
  ].forEach(function (key) { OFFICIAL_TOP_KEYS[key] = true; });

  // ATO 自己的存档包绝不会带的键；出现即说明这是 ATO 的 JSON，不是官方 .jsave。
  var ATO_MARKER_KEYS = { sections: true, legacyDashboard: true, profiles: true };

  function toBytes(input) {
    if (!input) return null;
    // 用 toString 判定而不是 `instanceof`：页面里可能是别的 realm（iframe / vm）造出来的
    // TypedArray，`instanceof` 会漏判。
    var tag = Object.prototype.toString.call(input);
    if (tag === "[object Uint8Array]" || tag === "[object Uint8ClampedArray]") {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (tag === "[object ArrayBuffer]") return new Uint8Array(input);
    if (tag === "[object Int8Array]" || tag === "[object Uint16Array]"
      || tag === "[object Int16Array]" || tag === "[object Uint32Array]"
      || tag === "[object Int32Array]") {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof input === "string") {
      if (typeof TextEncoder === "function") return new TextEncoder().encode(input);
      var out = new Uint8Array(input.length);
      for (var i = 0; i < input.length; i += 1) out[i] = input.charCodeAt(i) & 0xff;
      return out;
    }
    return null;
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8").decode(bytes);
    }
    var text = "";
    for (var i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    try {
      return decodeURIComponent(escape(text));
    } catch (error) {
      return text;
    }
  }

  // 括号 / 字符串感知的扫描器：返回**第一个完整 JSON 值**的结束下标（不含）。
  //
  // 官方 App 覆盖写入时不截断，JSON 后面可能残留旧数据（实测有 31KB 残留），
  // 所以不能把整个文件丢给 JSON.parse —— 只能消费第一个完整的 JSON 值。
  function scanJsonEnd(text, start) {
    var index = start;
    while (index < text.length && " \t\r\n".indexOf(text[index]) >= 0) index += 1;
    if (index >= text.length) return -1;
    var first = text[index];
    if (first !== "{" && first !== "[") return -1;
    var stack = [];
    var inString = false;
    var escaped = false;
    for (; index < text.length; index += 1) {
      var ch = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{" || ch === "[") { stack.push(ch); continue; }
      if (ch === "}" || ch === "]") {
        var open = stack.pop();
        if (open === undefined) return -1;
        if ((ch === "}") !== (open === "{")) return -1;
        if (!stack.length) return index + 1;
      }
    }
    return -1;
  }

  // 单个值（含嵌套）的扫描器：返回**值的下标起点**与**结束下标（不含）**。
  // 字符串里的大括号/中括号不算结构，需要转义感知。
  function scanValueEnd(text, start) {
    var index = start;
    while (index < text.length && " \t\r\n".indexOf(text[index]) >= 0) index += 1;
    if (index >= text.length) return -1;
    var ch = text[index];
    if (ch === "{" || ch === "[") return scanJsonEnd(text, index);
    if (ch === '"') {
      var i = index + 1;
      var escaped = false;
      for (; i < text.length; i += 1) {
        var c = text[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') return i + 1;
      }
      return -1;
    }
    var end = index;
    while (end < text.length && ",}] \t\r\n".indexOf(text[end]) < 0) end += 1;
    return end > index ? end : -1;
  }

  // 逐个键值对地扫，只取 `campaign_cycle` / `campaign_uid` 这种标量元信息，
  // 不建整棵对象（脏尾巴里可能有任意垃圾，整棵解析会踩雷）。
  function scanTopLevelScalars(text) {
    var out = {};
    var index = 0;
    while (index < text.length && " \t\r\n".indexOf(text[index]) >= 0) index += 1;
    if (text[index] !== "{") return out;
    index += 1;
    while (index < text.length) {
      while (index < text.length && " \t\r\n,".indexOf(text[index]) >= 0) index += 1;
      if (index >= text.length) break;
      if (text[index] === "}") break;
      if (text[index] !== '"') break;
      var keyEnd = scanValueEnd(text, index);
      if (keyEnd < 0) break;
      var key;
      try {
        key = JSON.parse(text.slice(index, keyEnd));
      } catch (error) {
        break;
      }
      index = keyEnd;
      while (index < text.length && " \t\r\n".indexOf(text[index]) >= 0) index += 1;
      if (text[index] !== ":") break;
      index += 1;
      var valueEnd = scanValueEnd(text, index);
      if (valueEnd < 0) break;
      var raw = text.slice(index, valueEnd).trim();
      if (raw && raw[0] !== "{" && raw[0] !== "[") {
        try {
          out[key] = JSON.parse(raw);
        } catch (error) { /* 标量解析不了就跳过，不影响主流程 */ }
      }
      index = valueEnd;
    }
    return out;
  }

  function parseJsaveText(text) {
    var end = scanJsonEnd(text, 0);
    if (end < 0) {
      throw new Error("第 4 个字节起不是一个完整的 JSON 值（文件被截断或不是官方存档？）");
    }
    var slice = text.slice(0, end);
    var official;
    try {
      official = JSON.parse(slice);
    } catch (error) {
      throw new Error("JSON 解析失败：" + String((error && error.message) || error));
    }
    var meta = scanTopLevelScalars(slice);
    return { official: official, rawJsonLength: end, meta: meta };
  }

  function parseJsave(input) {
    var bytes = toBytes(input);
    if (!bytes || bytes.length < 4) {
      throw new Error("文件太短，不可能是官方 .jsave（至少 3 字节头 + 一个 JSON 对象）");
    }
    var prefix = Array.prototype.slice.call(bytes.slice(0, 3));
    var text = bytes.length > 3 ? decodeUtf8(bytes.slice(3)) : "";
    var parsed = parseJsaveText(text);
    return {
      prefix: prefix,
      official: parsed.official,
      rawJsonLength: parsed.rawJsonLength,
      staleTail: Math.max(0, bytes.length - 3 - parsed.rawJsonLength),
      // 只含标量元信息（campaign_cycle / campaign_uid / campaign_name / save_version …），
      // 让调用方在**不碰脏尾巴**的前提下判断存档是否与当前的循环对得上。
      meta: parsed.meta
    };
  }

  function isJsave(input) {
    // 判定只看**内容**：前 3 字节不透明头 + 紧随其后的 JSON 对象 + 官方字段名。
    // 扩展名不参与 —— ATO 自己的战役 JSON 以 `{` 打头，第 4 字节是 `"`，会在这里被挡掉。
    var bytes = toBytes(input);
    if (!bytes || bytes.length < 4) return false;
    var marker = bytes[3];
    if (marker !== 0x7b && marker !== 0x5b) return false;   // '{' 或 '['
    var parsed;
    try {
      parsed = parseJsave(bytes);
    } catch (error) {
      return false;
    }
    var official = parsed.official;
    if (!isDict(official)) return false;
    for (var i = 0; i < Object.keys(ATO_MARKER_KEYS).length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(official, Object.keys(ATO_MARKER_KEYS)[i])) return false;
    }
    var keys = Object.keys(official);
    for (var j = 0; j < keys.length; j += 1) {
      if (OFFICIAL_TOP_KEYS[keys[j]]) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 入口

  function convert(official, options) {
    options = options || {};
    var converter = new Converter({ mapTiles: options.mapTiles || null }, options.dropDeadSlots);
    var sections = converter.buildSections(official);
    return sections;
  }

  // 带诊断的入口：sections + converter.stats/warnings + official（报告用）。
  function convertWithReport(official, options) {
    options = options || {};
    var converter = new Converter({ mapTiles: options.mapTiles || null }, options.dropDeadSlots);
    var sections = converter.buildSections(official);
    return {
      sections: sections,
      stats: converter.stats,
      warnings: converter.warnings.concat(),
      officialKeys: converter.official_keys.concat()
    };
  }

  return {
    isJsave: isJsave,
    parseJsave: parseJsave,
    convert: convert,
    convertWithReport: convertWithReport,
    // 供测试与页面复用的内部件（不承诺稳定，但深比较测试要用）
    _internal: {
      Converter: Converter,
      canonicalJson: canonicalJson,
      scanJsonEnd: scanJsonEnd,
      scanValueEnd: scanValueEnd,
      scanTopLevelScalars: scanTopLevelScalars,
      notesBlock: { begin: NOTES_BLOCK_BEGIN, end: NOTES_BLOCK_END, limit: NOTES_BLOCK_LIMIT },
      officalTopKeys: OFFICIAL_TOP_KEYS,
      atoArgonautIds: ATO_ARGONAUT_IDS,
      cycleIdentityKeys: CYCLE_IDENTITY_KEYS,
      rareValueSep: RARE_VALUE_SEP,
      mapTiles: loadAtoMapTiles
    }
  };
});
