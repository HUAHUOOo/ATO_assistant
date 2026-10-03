// 官方 App 存档（.jsave）导入：JS 转换器 vs Python 参考实现。
//
// 未修改字段与 Python 冻结快照逐叶子比较；修复字段与各页面真实读取逻辑核对。
// 参考文件由 jsave-web/run-reference.md 里写的命令生成，路径见下面的 REFERENCE_PATHS。
//
// 跑法：node tests/jsave-import.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const readText = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

const jsaveTables = require(path.join(root, "assets", "jsave-tables.js"));
const jsaveImport = require(path.join(root, "assets", "jsave-import.js"));
const scoreSource = readText("index.html");

// 真的有存档才会跑「与 Python 深比较」；没有时按 node:test 的方式显式跳过而不是假装通过。
const JSAVE_PATHS = [
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0005(2).jsave",
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0005(4).jsave",
];
// 多分片（c1，32+80）与"整张网格"（c2，96 格而 ATO 只有 84 个板块）两份实测档。
const C1_SAVE_PATHS = [
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0000.jsave",
];
const C2_SAVE_PATHS = [
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0001(1).jsave",
];
// c3（4 张分片 80+80+80+9）与 c4（带真实标记）两份实测档。
const C3_SAVE_PATHS = [
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0002.jsave",
];
const C4_SAVE_PATHS = [
  "D:\\files\\Tencent Files\\2628451455\\FileRecv\\MobileFile\\campaign_0003(3).jsave",
];
const REFERENCE_PATHS = [
  path.join(root, "tests", "fixtures", "jsave", "pysnap", "snap0005.sections.json"),
];
const jsavePath = JSAVE_PATHS.find((file) => fs.existsSync(file)) || null;
const c1SavePath = C1_SAVE_PATHS.find((file) => fs.existsSync(file)) || null;
const c2SavePath = C2_SAVE_PATHS.find((file) => fs.existsSync(file)) || null;
const c3SavePath = C3_SAVE_PATHS.find((file) => fs.existsSync(file)) || null;
const c4SavePath = C4_SAVE_PATHS.find((file) => fs.existsSync(file)) || null;
const referencePath = REFERENCE_PATHS.find((file) => fs.existsSync(file)) || null;

// Python `unique_id()` 用的是毫秒时间戳，两次运行必然不同 —— 比较时按路径忽略。
const VOLATILE_ID = /(^|\.)(id|activeHeroId)$/;

// 地图板块表：直接用转换器自己的加载器，拿到 `{ ids, rows, cols, row0, col0, cells }`
// （网格信息是"官方数组下标 → ATO tileId"的第二种算法所需要的）。
function mapTilesFromMapData() {
  const source = readText("map/map-data.js");
  const data = JSON.parse(source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1));
  return jsaveImport._internal.mapTiles(data);
}

const MAP_TILES = mapTilesFromMapData();
const tileIdsOf = (cycleId) => MAP_TILES[cycleId].ids;
// 只按下标对位的旧形状（给"格数/网格都对不上"的负向用例与合成用例用）。
const positionalTiles = (ids) => ({ ids: ids.map(String) });

// 逐叶子比较，返回差异行（空数组 = 完全相同）。对象键顺序无关，数组按下标比。
function leafDiffs(actual, expected, where, out) {
  out = out || [];
  where = where || "";
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      out.push(`${where}: 长度 ${actual.length} ≠ Python ${expected.length}`);
    }
    for (let i = 0; i < Math.min(actual.length, expected.length); i += 1) {
      leafDiffs(actual[i], expected[i], `${where}[${i}]`, out);
    }
    return out;
  }
  const actualObject = actual && typeof actual === "object" && !Array.isArray(actual);
  const expectedObject = expected && typeof expected === "object" && !Array.isArray(expected);
  if (actualObject && expectedObject) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const child = where ? `${where}.${key}` : key;
      if (!(key in actual)) { out.push(`${child}: JS 缺这个键`); continue; }
      if (!(key in expected)) { out.push(`${child}: JS 多出这个键`); continue; }
      leafDiffs(actual[key], expected[key], child, out);
    }
    return out;
  }
  if (JSON.stringify(actual) === JSON.stringify(expected)) return out;
  if (VOLATILE_ID.test(where)) return out;
  out.push(`${where}: JS ${JSON.stringify(actual)} ≠ Python ${JSON.stringify(expected)}`);
  return out;
}

// 拼一个带脏尾巴的 .jsave：官方头部 + 完整 JSON + 陈旧旧数据。
function jsaveBytes(official, tail) {
  const body = Buffer.from(encoder.encode(JSON.stringify(official)), "utf8");
  const head = Buffer.from([0x81, 0xae, 0x05]);
  return tail ? Buffer.concat([head, body, tail]) : Buffer.concat([head, body]);
}

// ---------------------------------------------------------------- 内容判定

test("isJsave 按内容判定：.jsave 为真、ATO 状态包为假", () => {
  const official = { campaign_cycle: 1, campaign_uid: 42, cargo_resources: [0] };
  assert.equal(jsaveImport.isJsave(jsaveBytes(official)), true);
  assert.equal(jsaveImport.isJsave(jsaveBytes(official, Buffer.from("stale"))), true);

  const atoPackage = Buffer.from(encoder.encode(JSON.stringify({
    app: "ATO Campaign Save Package",
    version: 3,
    exportedAt: "2026-10-03T00:00:00.000Z",
    sections: { dashboard: { activeProfileId: "default", profiles: {} } },
  })), "utf8");
  assert.equal(jsaveImport.isJsave(atoPackage), false);

  // 就算强行加上 3 字节头，只要 JSON 里有 ATO 的 sections/legacyDashboard 标记，也必须判假。
  assert.equal(jsaveImport.isJsave(Buffer.concat([
    Buffer.from([0xdb, 0xbb, 0x03]), atoPackage,
  ])), false);

  // 纯 JSON（不带不透明头）一律不是 .jsave。
  assert.equal(jsaveImport.isJsave(Buffer.from('{"campaign_cycle": 1}', "utf8")), false);
  assert.equal(jsaveImport.isJsave(new Uint8Array(0)), false);
  // 头部 + 截断的 JSON → 判假（不抛异常）。
  assert.equal(jsaveImport.isJsave(Buffer.concat([
    Buffer.from([0x81, 0xae, 0x05]), Buffer.from('{"campaign_cycle": 1, "cargo', "utf8"),
  ])), false);
});

// ---------------------------------------------------------------- 陈旧尾巴

test("parseJsave 只消费第一个完整 JSON 值：JSON 后面的陈旧尾巴必须容忍", () => {
  const official = {
    campaign_cycle: 4,
    campaign_uid: 496311329,
    campaign_name: "Can toe",
    cargo_resources: [1, 2, 3],
    matrix: [true, false],
  };
  const staleTail = Buffer.from(
    encoder.encode("}]} garbage from an older, longer save " + "x".repeat(4096)), "utf8");
  const bytes = jsaveBytes(official, staleTail);

  const parsed = jsaveImport.parseJsave(bytes);
  assert.deepEqual(parsed.official, official);
  assert.deepEqual(parsed.prefix, [0x81, 0xae, 0x05]);
  assert.ok(parsed.rawJsonLength > 0 && parsed.rawJsonLength < bytes.length);
  assert.equal(parsed.staleTail, staleTail.length);
  assert.equal(parsed.rawJsonLength + 3 + parsed.staleTail, bytes.length);

  // 脏尾巴里出现引号/大括号/转义也不能影响扫描器。
  const nastyTail = Buffer.from(encoder.encode('{"broken": "a\\"b", "x": [1, 2'), "utf8");
  const parsed2 = jsaveImport.parseJsave(jsaveBytes(official, nastyTail));
  assert.deepEqual(parsed2.official, official);
  assert.equal(parsed2.staleTail, nastyTail.length);

  // 没有尾巴时二者相等，且 parseJsave 与 JSON.parse 结果一致。
  const clean = jsaveBytes(official);
  assert.deepEqual(jsaveImport.parseJsave(clean).official, JSON.parse(JSON.stringify(official)));
  assert.equal(jsaveImport.parseJsave(clean).staleTail, 0);

  // 元信息扫描器只认顶层标量，不碰脏尾巴。
  assert.equal(jsaveImport.parseJsave(bytes).meta.campaign_cycle, 4);
  assert.equal(jsaveImport.parseJsave(bytes).meta.campaign_uid, 496311329);
  assert.equal(jsaveImport.parseJsave(bytes).meta.campaign_name, "Can toe");
  assert.equal(jsaveImport.parseJsave(bytes).meta.cargo_resources, undefined);

  // JSON 本身被截断时，必须报人话而不是原始异常。
  const truncated = Buffer.concat([
    Buffer.from([0x81, 0xae, 0x05]), Buffer.from('{"campaign_cycle": 4, "cargo', "utf8"),
  ]);
  assert.throws(() => jsaveImport.parseJsave(truncated), /不是一个完整的 JSON 值/);
});

// ---------------------------------------------------------------- 与 Python 深比较

test("convert() 未改字段仍与 Python 冻结参考逐叶子相同", { skip: !jsavePath || !referencePath }, () => {
  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const parsed = jsaveImport.parseJsave(fs.readFileSync(jsavePath));
  const mine = jsaveImport.convert(parsed.official, { mapTiles: MAP_TILES });

  // ⚠️ 地图分区（`sections.map`）不参与深比较：
  // 参考实现是**冻结的 Python 原型**（`tests/fixtures/jsave/pysnap/`）。现役的
  // `jsave-import/import_jsave.py` 已不在工作区，它依赖的 `app-extract/official-tables.json`
  // 也不随源码发布（干净的检出里跑不起来），而这份原型**不产出**地图状态字段 ——
  // 本轮地图分区由 JS 版扩展（`explored` / `previewRevealed` / `tileNotes`，修的是
  // "官方存档导进来、地图上格子全是未探索"的真漏洞），改 Python 原型不在本轮范围，
  // 所以地图分区改为本文件里的专项断言覆盖（见下面的「地图导入」用例）。
  // 冻结参考本身是可复现的：本地用同一份 `app-extract/official-tables.json` 重跑原型，
  // 它自带的 42 条断言全 PASS，产物与冻结副本**逐叶子 0 差异**（canonical 2913 行对
  // 2913 行，非 id 行 0 处不同）—— 也就是说下面这个基准没有被手工改过。
  // 原型同样含天数、资源键、科技键、进化格、历史冒险和召唤名称的旧漏洞。
  // 只排除本轮明确修复的字段，下面专项用例通过真实页面函数验证这些字段。
  // 保留冻结产物，不能把错误输出继续当成正确行为的验收标准。
  const stripCorrectedFields = (sections) => {
    const copy = JSON.parse(JSON.stringify(sections));
    delete copy.map;
    const record = copy.record.users.default;
    ["cycleDays", "adventures", "enemies", "nymphCards", "nymphUsedCards"].forEach((key) => delete record[key]);
    ["supersolidReliefMass", "echoesOfRecollection", "c2-supersolidRelief", "echoes"].forEach((key) => delete record.resources[key]);
    const stripDiagnostics = (notes) => notes.split("\n").filter((line) => !/^(?:无法识别的宁芙|无法识别的神之形态|无法识别的科技卡|冒险进度无对应轨道|敌人进化未导入项)/.test(line)).join("\n");
    record.notes = stripDiagnostics(record.notes);
    Object.values(record.cycleStats).forEach((stats) => { stats.notes = stripDiagnostics(stats.notes); });
    delete copy.technology.users.default.unlocked;
    return copy;
  };
  const mineRest = stripCorrectedFields(mine);
  const referenceRest = stripCorrectedFields(reference);

  // 分区键集合必须先一致 —— 免得"少了一个分区"被 strip 掩盖过去。
  assert.deepEqual(Object.keys(mineRest).sort(), Object.keys(referenceRest).sort());
  assert.deepEqual(Object.keys(mine).sort(), ["dashboard", "heroes", "map", "record", "technology"]);

  const diffs = leafDiffs(mineRest, referenceRest, "sections");
  assert.deepEqual(diffs, [], `与 Python 差异 ${diffs.length} 处：\n${diffs.slice(0, 40).join("\n")}`);

  // 除了「毫秒时间戳 id」，canonical 形式也应当逐字符一致（能抓到键顺序/数字格式的差异）。
  const canonicalMine = jsaveImport._internal.canonicalJson(mineRest).split("\n");
  const canonicalRef = jsaveImport._internal.canonicalJson(referenceRest).split("\n");
  assert.equal(canonicalMine.length, canonicalRef.length);
  const idLines = canonicalMine.filter((line) => /"(id|activeHeroId)":/.test(line)).length;
  const otherDiffs = canonicalMine.filter((line, index) => line !== canonicalRef[index]
    && !/"(id|activeHeroId)":/.test(line) && !/"(id|activeHeroId)":/.test(canonicalRef[index]));
  assert.ok(idLines > 0, "参考里应当有 id 字段，否则忽略规则失效");
  assert.deepEqual(otherDiffs, [], `除 id 外还有 canonical 差异：\n${otherDiffs.slice(0, 20).join("\n")}`);

  // 地图分区虽然不比"完全相同"，但**不许把 Python 版已有的部分改坏**：把本轮新增的
  // 内容（explored / previewRevealed / tileNotes，以及 toks 落下来的指示物）从 JS 结果里
  // 摘掉之后，必须与冻结参考逐叶子相同（`tokens` 的 AG/AD、`markers` 里的 `last_city`
  // 与 21 个 `tileVariants` 一个字都不许变）。
  const mineMap = JSON.parse(JSON.stringify(mine.map));
  Object.values(mineMap?.users?.default?.cycles || {}).forEach((cycleState) => {
    ["explored", "previewRevealed", "tileNotes"].forEach((key) => delete cycleState[key]);
    const markers = cycleState.tokens?.markers;
    if (!markers) return;
    Object.entries(markers).forEach(([tileId, perTile]) => {
      Object.keys(perTile || {}).forEach((id) => { if (id !== "last_city") delete perTile[id]; });
      if (!Object.keys(perTile || {}).length) delete markers[tileId];
    });
  });
  assert.deepEqual(
    leafDiffs(mineMap, JSON.parse(JSON.stringify(reference.map)), "sections.map"), [],
    "地图分区里 Python 已有的部分（tokens / tileVariants）必须一字未改");
  // 反向保险：三个新键确实存在（否则上面的"摘掉再比"等于什么都没验）。
  const newKeys = Object.keys(mine.map.users.default.cycles.c5);
  ["explored", "previewRevealed", "tileNotes"].forEach((key) => {
    assert.ok(newKeys.includes(key), `地图循环状态里必须有 ${key}`);
  });

  // 顺带核对官方对象本身的标识字段。
  assert.equal(parsed.official.campaign_cycle, 4);
  assert.equal(parsed.official.campaign_uid, 496311329);
  assert.equal(parsed.meta.campaign_cycle, parsed.official.campaign_cycle);
  assert.equal(parsed.meta.campaign_uid, parsed.official.campaign_uid);
});

test("真实 .jsave 的转换结果带上了七个分区里 ATO 真正有数据的那五个", { skip: !jsavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(jsavePath));
  const sections = jsaveImport.convert(parsed.official, { mapTiles: MAP_TILES });
  assert.deepEqual(Object.keys(sections).sort(),
    ["dashboard", "heroes", "map", "record", "technology"]);
  const record = sections.record.users.default;
  assert.equal(record.cycle, "c5");
  assert.ok(record.notes.includes("官方存档未导入项"), "未导入项必须写进笔记区块");
  assert.equal(record.cycleStats.c5.notes, record.notes, "按循环字段必须与顶层一致");
  assert.equal(record.deadTitans, "76");
});

// ---------------------------------------------------------------- 非地图数据：用真实页面的读取逻辑验收

function recordPageContext() {
  const source = readText("record/index.html");
  const context = vm.createContext({
    state: null, elements: { cycleTitle: {}, cycleWarning: {} },
    document: { querySelectorAll: () => [] },
  });
  vm.runInContext(source.slice(source.indexOf("    const cycleData = "), source.indexOf("    const elements = "))
    + "\nthis.cycles = cycleData; this.summons = summonCards;", context);
  const names = ["isPlainObject", "cloneJson", "migrateEnemyStages", "normalizeState", "normalizeCycleStats",
    "normalizeCrewCounters", "normalizeNemesisSelections", "migrateNemesisProgress", "normalizeNemesisResourceHistory",
    "evolutionStages", "getEvolutionStage", "normalizeResources", "migrateSharedResourceKey", "normalizeCount",
    "normalizeSummonSelection", "normalizeTitanList", "normalizeTitanLimit", "normalizeDeadTitans", "migrateTitanLimit",
    "normalizeMatrix", "normalizeMatrixKey", "defaultDayForCycle", "normalizeCycleDay", "currentCycle",
    "currentCycleStats", "getCycleStat", "renderCycleFields", "getEvolutionStageKey", "isEvolutionStageActive", "resourceStorageKey"];
  vm.runInContext(names.map((name) => extractFunction(source, name)).join("\n"), context);
  const adventures = extractFunction(source, "renderAdventures");
  vm.runInContext(adventures.slice(adventures.indexOf("const slotPresets = "), adventures.indexOf("cycle.adventures.forEach"))
    + "this.adventureSlots = slotPresets;", context);
  return context;
}

function technologyPageContext() {
  const source = readText("technology/index.html");
  const context = vm.createContext({ window: {} });
  vm.runInContext(readText("technology/tech-page-layout.js"), context);
  vm.runInContext(source.slice(source.indexOf("function computeDisambiguatedTechNames("),
    source.indexOf("async function loadDictionaryData()")), context);
  context.data = context.dictionaryToAppData(JSON.parse(readText("technology/tech_card_dictionary.min.json")));
  context.PAGE_INDEX = new Map(context.data.pages.map((page, index) => [page.key, index]));
  context.DISAMBIGUATED_TECH_NAMES = context.computeDisambiguatedTechNames(context.data.pages);
  vm.runInContext(source.slice(source.indexOf("const TECH_KEY_ALIASES = "), source.indexOf("function techKey("))
    + ["techKey", "nodeKey", "cardsForNode", "isCoreNode", "isAutoUnlockedNode", "isUnlockedNode", "unlockAutomaticCyclesThrough"]
      .map((name) => extractFunction(source, name)).join("\n"), context);
  return context;
}

test("记录表读取和渲染后保留导入天数，五个循环均不归零", () => {
  const page = recordPageContext();
  for (let cycle = 0; cycle < 5; cycle++) {
    const sections = jsaveImport.convert({ campaign_cycle: cycle, timeline_status: Array(81).fill(true) });
    page.state = page.normalizeState(sections.record.users.default);
    page.renderCycleFields();
    assert.equal(page.state.day, "80");
    assert.equal(page.state.cycleDays[`c${cycle + 1}`], "80");
  }
});

test("货舱资源使用记录表实际读取的行键，超固体块与回响数量可见", () => {
  const cargo = jsaveTables.cargoOrder.map((name) => name === "SUPERSOLID_RELIEF_MASS" ? 19
    : name === "ECHOES_OF_RECOLLECTION" ? 7 : 0);
  const page = recordPageContext();
  page.state = page.normalizeState(jsaveImport.convert({ campaign_cycle: 4, cargo_resources: cargo }).record.users.default);
  page.state.cycle = "c2";
  assert.equal(page.state.resources[page.resourceStorageKey("supersolidRelief")], 19);
  page.state.cycle = "c5";
  assert.equal(page.state.resources[page.resourceStorageKey("echoes")], 7);
  assert.equal(page.state.resources.supersolidReliefMass, undefined);
  assert.equal(page.state.resources.echoesOfRecollection, undefined);
});

test("所有官方科技卡都映射到科技页面真实的键，重名科技按所属循环区分", () => {
  const page = technologyPageContext();
  const ids = Object.keys(jsaveTables.techNames);
  const result = jsaveImport.convertWithReport({ campaign_cycle: 4, tech_id_list: ids, tech_deck_list: ids.map(() => true) });
  const technology = result.sections.technology.users.default;
  const knownKeys = new Set(page.data.pages.flatMap((cycle) => cycle.nodes.map((node) => page.nodeKey(cycle.key, node))));
  assert.equal(result.stats.tech_untranslated.length, 0);
  assert.ok(technology.unlocked.length > 300, "不能用丢掉大部分科技的办法消除键名错误");
  assert.deepEqual(technology.unlocked.filter((key) => !knownKeys.has(key)), []);
  page.currentCycle = technology.currentCycle;
  page.unlocked = new Set(technology.unlocked);
  page.unlockAutomaticCyclesThrough(page.currentCycle);
  for (const cycle of page.data.pages) {
    for (const node of cycle.nodes.filter((item) => ["Cryptex Technology", "Monomythological Support", "Intelligence Gathering"].includes(item.name))) {
      assert.ok(page.isUnlockedNode(cycle.key, node), `${cycle.key}: ${node.name}`);
    }
  }
  const wrapped = jsaveImport.convertWithReport({ campaign_cycle: 1, tech_id_list: ["&BA1012", "BY1048"], tech_deck_list: [true, true] });
  assert.deepEqual(wrapped.sections.technology.users.default.unlocked, ["13th muse grand cannon"]);
  assert.match(wrapped.sections.record.users.default.notes, /无法识别的科技卡：BY1048/);
});

test("两条主要敌人轨道逐格可见，共享格使用共用键，空的第一轨不会挤掉第二轨", () => {
  const page = recordPageContext();
  for (const [cycle, config] of Object.entries(page.cycles)) {
    const primary = config.enemies.slice(0, 2);
    const official = { campaign_cycle: Number(cycle.slice(1)) - 1, evo: {
      evo_prim1_track: primary[0].stages.map(() => true), evo_prim2_track: primary[1].stages.map(() => true),
    } };
    page.state = page.normalizeState(jsaveImport.convert(official).record.users.default);
    for (const enemy of primary) {
      for (const stage of enemy.stages.filter((item) => item.marker !== "spacer")) {
        assert.ok(page.isEvolutionStageActive(enemy.key, stage), `${cycle}: ${enemy.key}:${stage.id}`);
        if (stage.sharedWith) assert.equal(page.state.enemies[`${cycle}:${enemy.key}:${stage.id}`], undefined);
        if (stage.marker === "counter") assert.equal(page.state.enemies[page.getEvolutionStageKey(enemy.key, stage)], 1);
      }
    }
    assert.ok(Object.keys(page.state.enemies).every((key) => !key.startsWith("nemesis:")), "主要敌人进度不能误填宿敌");
    official.evo.evo_prim1_track = [];
    page.state = page.normalizeState(jsaveImport.convert(official).record.users.default);
    const direct = primary[1].stages.find((stage) => !stage.sharedWith && stage.marker !== "spacer");
    assert.ok(page.isEvolutionStageActive(primary[1].key, direct));
  }
});

test("导入保留所有循环冒险进度，按 hub 名匹配，C1 教程正确落到三格轨道", () => {
  const page = recordPageContext();
  const adventures = jsaveTables.adventureHubs.map((hub) => ({
    adv_hub_name: hub.hub, adv_progress: Array(hub.adv_count + 2).fill(true),
  })).reverse();
  const result = jsaveImport.convertWithReport({ campaign_cycle: 4, adventures });
  const imported = result.sections.record.users.default.adventures;
  const expected = [];
  for (const [cycle, config] of Object.entries(page.cycles)) {
    config.adventures.forEach(([, , preset = "default"], index) => {
      if (preset === "ten-thousand") return; // 官方 App 没有这两条附加轨道。
      page.adventureSlots[preset].forEach((slot) => expected.push(`${cycle}-${index}-${slot.id}`));
    });
  }
  assert.deepEqual(Object.keys(imported).sort(), expected.sort());
  assert.deepEqual(Object.keys(imported).filter((key) => key.startsWith("c1-7-")).sort(),
    ["c1-7-alpha", "c1-7-mid1", "c1-7-omega"]);
  assert.match(result.sections.record.users.default.notes, /冒险进度无对应轨道.*oo12_advhub_01/);
});

test("宁芙中英文名称均能导入，无法识别的名称和使用状态保留在笔记", () => {
  const page = recordPageContext();
  for (const language of ["zh", "en", "id"]) {
    const cards = page.summons.nymphs;
    const result = jsaveImport.convert({ campaign_cycle: 4, smn_names: cards.map((card) => card[language]),
      smn_used: cards.map((_, index) => index % 2 === 0) });
    page.state = page.normalizeState(result.record.users.default);
    assert.deepEqual(Array.from(page.state.nymphCards), Array.from(cards, (card) => card.id));
    assert.deepEqual(Array.from(page.state.nymphUsedCards), Array.from(cards).filter((_, index) => index % 2 === 0).map((card) => card.id));
  }
  const result = jsaveImport.convert({ campaign_cycle: 4, smn_names: ["机械宁芙", "Knowledge Nymph", "自定义召唤", "自定义召唤"],
    smn_used: [true, false, true, false], gf_names: ["unknown godform"], gf_used: [true], campaign_notes: ["保留我的笔记"] });
  assert.deepEqual(result.record.users.default.nymphCards, ["machina", "knowledge"]);
  assert.deepEqual(result.record.users.default.nymphUsedCards, ["machina"]);
  assert.match(result.record.users.default.notes, /^保留我的笔记\n/);
  assert.match(result.record.users.default.notes, /自定义召唤（已使用）；自定义召唤（未使用）/);
  assert.match(result.record.users.default.notes, /unknown godform（已使用）/);
  assert.equal(result.record.users.default.cycleStats.c5.notes, result.record.users.default.notes);
});

test("实际 C5 存档在页面读取后保留第80天、115格冒险与中文宁芙", { skip: !jsavePath }, () => {
  const official = jsaveImport.parseJsave(fs.readFileSync(jsavePath)).official;
  const result = jsaveImport.convertWithReport(official);
  const page = recordPageContext();
  page.state = page.normalizeState(result.sections.record.users.default);
  page.renderCycleFields();
  assert.equal(page.state.day, "80");
  const knownHubs = new Set(jsaveTables.adventureHubs.filter((hub) => /^CYCLE_0[1-5]$/.test(hub.cycle)).map((hub) => hub.hub));
  const expectedMarks = official.adventures.filter((entry) => knownHubs.has(entry.adv_hub_name))
    .reduce((count, entry) => count + entry.adv_progress.filter(Boolean).length, 0);
  assert.equal(Object.keys(page.state.adventures).length, expectedMarks);
  assert.equal(expectedMarks, 115);
  assert.ok(page.state.nymphCards.includes("machina") && page.state.nymphCards.includes("knowledge"));
  result.stats.nymph_unmapped.forEach((name) => assert.ok(page.state.notes.includes(name), name));
});

// ---------------------------------------------------------------- 地图状态导入
//
// 官方 `maps[0][i]` 与 ATO 该轮地图的第 i 格按**下标对位**（官方格下标 → map/map-data.js
// 的 tileId，形如 `"057"`）。下面每个用例都自己从官方对象里现算期望值，不写死一长串 id ——
// 写死的那份只能证明"代码没变"，证明不了"和官方存档对得上"。

// 官方 maps[0] 的第 i 格 → ATO 该轮第 i 格的 tileId。
function officialTiles(parsed, cycleId) {
  const tiles = (parsed.official.maps || [])[0] || [];
  const ids = tileIdsOf(cycleId);
  return { tiles, ids };
}

function cycleStateOf(sections, cycleId) {
  return sections.map.users.default.cycles[cycleId];
}

test("地图导入：已探索格与官方 expl 逐格对照，expl=false 的格子绝不写进去", { skip: !jsavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(jsavePath));
  const cycleId = `c${parsed.official.campaign_cycle + 1}`;
  assert.equal(cycleId, "c5");
  const sections = jsaveImport.convert(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(sections, cycleId);
  const { tiles, ids } = officialTiles(parsed, cycleId);

  // 下标对位的前提：官方地图格数必须与 ATO 该轮地图格数一致（不一致时转换器整体不写，
  // 见下面「格数不一致」那条用例）。
  assert.equal(ids.length, tiles.length, "官方地图与 ATO c5 地图必须同为 80 格");

  const expectedExplored = [];
  const expectedNotExplored = [];
  tiles.forEach((tile, index) => {
    (tile.expl === true ? expectedExplored : expectedNotExplored).push(ids[index]);
  });
  // 本档（campaign_0005(4).jsave）官方 expl=true 的格子数就是 63。
  assert.equal(expectedExplored.length, 63, "本档官方 expl=true 的格数");
  assert.equal(expectedNotExplored.length, 80 - 63);

  // 数量与id 都要对上：逐个 id 断言，不是只看个数。
  assert.equal(Object.keys(cycleState.explored).length, expectedExplored.length);
  expectedExplored.forEach((tileId) => {
    assert.equal(cycleState.explored[tileId], true, `${tileId} 官方 expl=true，必须写成已探索`);
  });
  expectedNotExplored.forEach((tileId) => {
    assert.ok(!cycleState.explored[tileId], `${tileId} 官方 expl=false，绝不能写成已探索`);
  });
  assert.deepEqual(Object.keys(cycleState.explored).sort(), expectedExplored.slice().sort());
});

test("地图导入：revl → previewRevealed（只写未探索的那些），note → tileNotes", { skip: !jsavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(jsavePath));
  const cycleId = `c${parsed.official.campaign_cycle + 1}`;
  const sections = jsaveImport.convert(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(sections, cycleId);
  const { tiles, ids } = officialTiles(parsed, cycleId);

  const revealed = [];
  tiles.forEach((tile, index) => { if (tile.revl === true) revealed.push(ids[index]); });
  assert.equal(revealed.length, 7, "本档官方 revl=true 的格数");

  // 官方 revl 是**每格一个布尔**（7 格），ATO 的单值键 `latestRevealedTile` 表达不了，
  // 所以走集合型的 `previewRevealed`（"已揭示但还没探索"），只写 `revl && !expl` 的格子：
  //   * 已探索的 4 格（004/016/042/062）已经由 `explored` 覆盖，ATO 自己也会在探索时
  //     删掉 previewRevealed（map/app.js:611），写进去没有可见效果；
  //   * 未探索的 3 格（008/065/070，其中 070 就是仇敌所在格）保留"已揭示"状态，
  //     与真实 ATO 存档里"仇敌停在一张未探索的板块上时该板块进 previewRevealed"一致
  //     （实测 data/ato-campaign-111111.json 的 c4：explored={029}、previewRevealed={030}、
  //     tokens.AD="030"）。
  const expectedPreview = [];
  const alreadyExplored = [];
  tiles.forEach((tile, index) => {
    if (tile.revl !== true) return;
    (tile.expl === true ? alreadyExplored : expectedPreview).push(ids[index]);
  });
  assert.deepEqual(expectedPreview.slice().sort(), ["008", "065", "070"]);
  assert.deepEqual(alreadyExplored.slice().sort(), ["004", "016", "042", "062"]);
  assert.deepEqual(Object.keys(cycleState.previewRevealed).sort(), expectedPreview.slice().sort());
  expectedPreview.forEach((tileId) => {
    assert.equal(cycleState.previewRevealed[tileId], true, `${tileId} 官方 revl=true 且未探索`);
  });
  alreadyExplored.forEach((tileId) => {
    assert.ok(!cycleState.previewRevealed[tileId], `${tileId} 已探索，不必再写 previewRevealed`);
  });
  // 官方没有"哪一个才是最新"的顺序信息 → 不去编造 `latestRevealedTile`。
  assert.equal(cycleState.latestRevealedTile, undefined);

  // 格笔记：官方 note 只有 1 格非空，原样照写（键是 ATO 的 tileId）。
  const expectedNotes = {};
  tiles.forEach((tile, index) => {
    if (typeof tile.note === "string" && tile.note.trim()) expectedNotes[ids[index]] = tile.note;
  });
  assert.deepEqual(Object.keys(expectedNotes), ["026"]);
  assert.deepEqual(cycleState.tileNotes, expectedNotes);
  assert.equal(cycleState.tileNotes["026"], "通用指示物");
});

test("地图导入：toks 位 → markers（c5 位序按面板顺序 + ATO 同名 id），未映射的位只进诊断", { skip: !jsavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(jsavePath));
  const cycleId = `c${parsed.official.campaign_cycle + 1}`;
  const report = jsaveImport.convertWithReport(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(report.sections, cycleId);
  const { tiles, ids } = officialTiles(parsed, cycleId);

  const tokTiles = [];
  const addAdvrTiles = [];
  tiles.forEach((tile, index) => {
    if (Array.isArray(tile.toks) && tile.toks.some(Boolean)) tokTiles.push({ id: ids[index], toks: tile.toks });
    if (Array.isArray(tile.add_advr) && tile.add_advr.some(Boolean)) addAdvrTiles.push(ids[index]);
  });
  assert.deepEqual(tokTiles.map((item) => item.id), ["021", "026", "033", "051", "065", "066"]);
  assert.deepEqual(addAdvrTiles, ["014", "034"]);

  // 位序依据（三条独立证据，详见 assets/jsave-import.js 的 TOKS_BIT_TO_MARKER 注释）：
  //   ① 官方 App「Edit Tile」面板逐行顺序（c1–c5 各一张用户截图）；
  //   ② 字段槽位结构：`add_advr` 在 c5 恰好 2 位、其余循环是空数组，面板的 ARGO/ADVERSARY
  //      组后面恰好还有 NEMESIS / BLACK BEAK 两行；面板第三组去掉 UNDERWATER TILE
  //      （格子属性，ATO 没有对应指示物）后恰好 8 行 = c5 的 `toks` 位数；
  //   ③ ATO 注册表 `map/app.js:301` 里逐行有同名 id（标签见 asset-studio/app/catalog.py
  //      的 MAP_TOKEN_LABELS），且 c4 的面板 7 行 = 实测 c4 `toks` 7 位、c3 的面板 5 行
  //      = 实测 c3 `toks` 5 位（`campaign_0001_1.decoded.json` 的 c3 图）。
  // 硬交叉验证：`campaign_stats.city_tile = 21` 与「唯一一个位 0 为 true 的格子 = 021」
  // 是同一格 —— 位 0 就是面板里的 LAST VISITED CITY（两个独立来源互相印证）。
  assert.equal(parsed.official.campaign_stats.city_tile, 21);
  assert.equal(tokTiles.filter((item) => item.toks[0] === true).map((item) => item.id).join(","), "021");

  // 逐格逐一对照：位 → ATO id。
  const expected = {
    "021": { c5_ruin: true },                          // 位 3 = RUIN；位 0 = 城市（见下）
    "026": { c5_last_visited_underwater_city: true },  // 位 1
    "033": { c5_ruin: true },                          // 位 3
    "051": { c5_ruin: true },                          // 位 3
    "065": { hs: true },                               // 位 5 = HEMIOLIA SCOUT
    "066": { c5_ruin: true },                          // 位 3
  };
  assert.deepEqual(report.stats.map_detail.markers, expected);
  // 城市标记由 campaign_stats.city_tile 落位（021），与 toks 位 0 同格 → 合起来是
  // last_city + c5_ruin；位 0 自己**不**额外写 marker（理由见实现注释）。
  assert.deepEqual(cycleState.tokens.markers, {
    "021": { last_city: true, c5_ruin: true },
    "026": { c5_last_visited_underwater_city: true },
    "033": { c5_ruin: true },
    "051": { c5_ruin: true },
    "065": { hs: true },
    "066": { c5_ruin: true },
  });
  // 位 0 与 city_tile 同格 → 视作"已经由 city_tile 落位"，既不重复写 marker，也不算未映射
  // （toks_bit_written 只在**没落位**的位上留痕）。
  assert.deepEqual(report.stats.map_detail.toks_bit_written, {});
  assert.deepEqual(report.stats.map_detail.toks_bit0_conflict, []);

  // `toks` 全 false 的格子一个 marker 都不许有。
  tiles.forEach((tile, index) => {
    if (Array.isArray(tile.toks) && tile.toks.some(Boolean)) return;
    assert.equal(cycleState.tokens.markers[ids[index]], undefined,
      `${ids[index]} 的 toks 全 false，不该有 marker`);
  });

  // 官方 `reward_token` 在 5 份样例里**每格**都是默认值 "Hull"（含 has_reward_token=false 的
  // 格子），那是 `RewardTokenType` 枚举的第 0 项（Hull / Crew / Titan / ArgoKnowledge /
  // DreamofPharos / RRToken，见元数据转储），是"该格奖励类型"而不是"放了东西"；
  // has_* 全 false，所以也不该有任何落位。
  assert.equal(tiles.filter((tile) => tile.reward_token).length, 80);
  assert.equal(tiles.filter((tile) => tile.has_reward_token || tile.has_generic_token).length, 0);
  assert.deepEqual(Object.keys(cycleState.tokens.markers).filter((id) => {
    return Object.keys(cycleState.tokens.markers[id]).some((key) => /reward|generic|body|staff|taitan|knowledge|dof|rr/.test(key));
  }), []);

  // 仍然没落位的部分必须如实记进诊断：本档只剩 add_advr（面板里是 NEMESIS / BLACK BEAK，
  // 但「额外仇敌位 ↔ 指示物」还缺用户侧确认）。
  const unmapped = report.stats.map_detail.unmapped;
  assert.deepEqual(unmapped.map((item) => item.key), ["add_advr"]);
  assert.deepEqual(unmapped[0].tiles, addAdvrTiles);
  assert.match(unmapped[0].reason, /NEMESIS/);
  assert.deepEqual(report.stats.map_detail.tokens, { AG: "057", AD: "070" });
  assert.equal(report.stats.map_detail.explored, 63);
  assert.equal(report.stats.map_detail.preview_revealed, 3);
  assert.equal(report.stats.map_detail.tile_notes, 1);
  assert.equal(report.stats.map_detail.variants, 21);
});

test("地图导入：toks 位序表（c1–c4 都有面板+图标依据，位 0 一律不写）", () => {
  // c2 / c3 / c4 的面板行数与实测 `toks` 位数一致（c2 3+1 备用、c3=5、c4=7）；
  // c1 的用户截图确认**没有** HEMIOLIA SCOUT 行 → 5 行对应位 0–4（位 5 从未用到），
  // 三个专属 id 由用户按标记图标确认（c12=迷宫→LABYRINTHIAN TEMPLE、c11=公牛→CITY OF THE
  // BULL、c13=神庙/陵墓→SEPULCHER ACROPOLIS）。这里用"只按下标对位"的表形状，
  // 专门测**位序表**本身（网格换 id 由下面的真档用例覆盖）。
  const cases = [
    { cycleIndex: 0, cycleId: "c1", bits: [1, 2, 3, 4], ids: ["c12", "c11", "c13", "ENGIN"] },
    { cycleIndex: 1, cycleId: "c2", bits: [1, 2], ids: ["hs", "ENGIN"] },
    { cycleIndex: 2, cycleId: "c3", bits: [1, 2, 3, 4], ids: ["token_2", "hs", "ENGIN", "night_nymph"] },
    {
      cycleIndex: 3,
      cycleId: "c4",
      bits: [1, 2, 3, 4, 5, 6],
      ids: ["c4_city_of_squalor", "c4_cloud_ship", "last_oasis", "hs", "ENGIN", "night_nymph"],
    },
  ];
  cases.forEach(({ cycleIndex, cycleId, bits, ids }) => {
    const ids0 = tileIdsOf(cycleId);
    const mapTiles = { [cycleId]: positionalTiles(ids0) };
    const tiles = ids0.map(() => ({ toks: [] }));
    // 每格只用一位：第 i 格用第 i 位，命中一个 id。
    bits.forEach((bit, index) => {
      tiles[index] = { toks: Array(Math.max(...bits) + 1).fill(false) };
      tiles[index].toks[bit] = true;
    });
    const report = jsaveImport.convertWithReport(
      { campaign_cycle: cycleIndex, maps: [tiles], campaign_stats: {} }, { mapTiles });
    const markers = cycleStateOf(report.sections, cycleId).tokens.markers || {};
    bits.forEach((bit, index) => {
      assert.deepEqual(markers[ids0[index]], { [ids[index]]: true },
        `${cycleId} 的 toks[${bit}] 应当落到 ${ids[index]}`);
    });
    // 位 0（LAST VISITED CITY）不写：campaign_stats 没给 city_tile 时也不该凭空写。
    assert.equal(markers[ids0[0]] && markers[ids0[0]].last_city, undefined);
  });

  // c1 **现在有位序了**（用户确认图标对应），所以"没有依据的位不写"这一条改用 c1 的位 5
  // （面板只有 5 行 = 位 0–4，位 5 从未用到）来守：位 5 设成 true 时不许写 marker，
  // 且该格要进 unmapped。
  {
    const ids0 = tileIdsOf("c1");
    const mapTiles = { c1: positionalTiles(ids0) };
    const tiles = ids0.map(() => ({ toks: Array(6).fill(false) }));
    tiles[0].toks[5] = true;
    const report = jsaveImport.convertWithReport(
      { campaign_cycle: 0, maps: [tiles], campaign_stats: {} }, { mapTiles });
    const cycleState = cycleStateOf(report.sections, "c1");
    assert.equal(cycleState.tokens.markers, undefined, "c1 位 5 没有对应指示物，不该写 marker");
    assert.deepEqual(report.stats.map_detail.unmapped.map((item) => item.key), ["toks"]);
    assert.deepEqual(report.stats.map_detail.unmapped[0].tiles, [ids0[0]]);
  }
});

test("地图导入：多分片 + 网格换 id（c1 实测 32+80 两张分片，只有 80 那张能落位）", { skip: !c1SavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(c1SavePath));
  assert.equal(parsed.official.campaign_cycle, 0);
  assert.equal(parsed.official.maps.length, 2);
  assert.deepEqual(parsed.official.maps.map((map) => map.length), [32, 80]);
  const report = jsaveImport.convertWithReport(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(report.sections, "c1");
  const detail = report.stats.map_detail;

  // 80 格那张分片是 8×10 的网格（ATO 的数字板块只占第 4..13 列，所以网格起点列是 3）：
  // 官方下标 40/41/60 → 格 (4,3)/(4,4)/(6,3) → id 021/022/031，与
  // `campaign_stats.argo_tile/adversary_tile/city_tile` = 21/22/31 **三个锚点全部吻合**；
  // 用户截图上的 O21/O22/O23/O26/O27/O28/O31/O32/O33 也与下面的结果对上。
  assert.equal(detail.map_index, 1);
  assert.match(detail.map_how, /10 列，起点格 0,3/);
  assert.deepEqual(detail.anchors.slice().sort(), ["adversary=022", "argo=021", "city=031"]);
  assert.deepEqual(detail.skipped_maps, [0]);
  assert.deepEqual(Object.keys(cycleState.explored).sort(), ["021", "022", "023", "028", "031", "032", "033"]);
  assert.deepEqual(Object.keys(cycleState.previewRevealed).sort(), ["026", "027"]);
  assert.equal(cycleState.tokens.AG, "021");
  assert.equal(cycleState.tokens.AD, "022");
  // `toks` 位按 c1 面板顺序落位（位 0 = 城市，由 city_tile 落位；位 1–4 = 三个专属标记 +
  // ENGINE NYMPH）。三个褐色方块在截图上的 O28/O32/O33 与本档位 1/2/3 解出的
  // `032`（c12，迷宫神庙）/`033`（c11，公牛之城）/`028`（c13，陵墓卫城）**逐一吻合**。
  assert.deepEqual(cycleState.tokens.markers, {
    "023": { ENGIN: true },
    "028": { c13: true },
    "031": { last_city: true },
    "032": { c12: true },
    "033": { c11: true },
  });
  assert.deepEqual(detail.toks_bit_written, {});
  assert.deepEqual(detail.unmapped.map((item) => item.key), ["skipped_maps"]);
  assert.deepEqual(detail.unmapped[0].tiles, ["0"]);
  assert.equal(parsed.official.campaign_stats.city_tile, 31);
  // 位 0（城市位）与 city_tile 同格 → 没有冲突。
  assert.deepEqual(detail.toks_bit0_conflict, []);
});

test("地图导入：c2 实测（96=12×8 网格，5 格已探索；toks 位 0/1/2 的城市/侦察船/引擎宁芙）", { skip: !c2SavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(c2SavePath));
  assert.equal(parsed.official.campaign_cycle, 1);
  assert.equal(parsed.official.maps.length, 1);
  assert.equal(parsed.official.maps[0].length, 96);
  const report = jsaveImport.convertWithReport(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(report.sections, "c2");
  const detail = report.stats.map_detail;

  // ATO 的 c2 板块数只有 84（12×8 网格里缺 12 格），所以官方 96 格数组必须**按格换 id**：
  // 官方下标 72/88/89 → id 064/078/079 == `campaign_stats.argo_tile/city_tile/adversary_tile` ✓
  assert.match(detail.map_how, /8 列，起点格 0,0/);
  assert.deepEqual(detail.anchors.slice().sort(), ["adversary=079", "argo=064", "city=078"]);
  assert.deepEqual(Object.keys(cycleState.explored).sort(), ["064", "071", "072", "078", "079"]);
  assert.equal(cycleState.tokens.AG, "064");
  assert.equal(cycleState.tokens.AD, "079");
  assert.deepEqual(cycleState.tokens.markers, {
    "071": { hs: true },      // 位 1 = HEMIOLIA SCOUT（截图上的蓝底船）
    "072": { ENGIN: true },   // 位 2 = ENGINE NYMPH（截图上的暗色引擎宁芙）
    "078": { last_city: true }, // 位 0 = LAST VISITED CITY，由 city_tile 落位
  });
  assert.deepEqual(detail.missing_official_cells.length, 12);
  assert.deepEqual(detail.unmapped.map((item) => item.key), ["missing_cells"]);
  assert.deepEqual(detail.toks_bit0_conflict, []);
});


test("地图导入：c4 实测（9 列网格，11 格已探索；7 个 toks 位全部落到 7 个不同的格）", { skip: !c4SavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(c4SavePath));
  assert.equal(parsed.official.campaign_cycle, 3);
  const report = jsaveImport.convertWithReport(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(report.sections, "c4");
  const detail = report.stats.map_detail;

  // 官方 81 格数组；ATO 的 c4 表是 9×9 无空洞网格，但 **id 与网格顺序不一致**（id 021 在
  // 行优先 56），所以必须按锚点解出的网格换 id —— 三个锚点全部命中：
  //   下标 56 → id 021 = `argo_tile`；55 → 020 = `adversary_tile`；45（toks[0]）→ 028 = `city_tile`
  assert.match(detail.map_how, /9 列，起点格 0,0/);
  assert.deepEqual(detail.anchors.slice().sort(), ["adversary=020", "argo=021", "city=028"]);
  assert.deepEqual(Object.keys(cycleState.explored).sort(),
    ["020", "021", "028", "029", "030", "037", "038", "039", "046", "047", "048"]);
  assert.deepEqual(Object.keys(cycleState.previewRevealed), ["019"]);
  assert.equal(cycleState.tokens.AG, "021");
  assert.equal(cycleState.tokens.AD, "020");
  // 位序按 c4 面板：LAST VISITED CITY / CITY OF SQUALOR / CLOUD SHIP / LAST VISITED OASIS /
  // HEMIOLIA SCOUT / ENGINE NYMPH / NIGHT NYMPH —— 七位全部用到，落在七个不同的格上。
  assert.deepEqual(cycleState.tokens.markers, {
    "028": { last_city: true },
    "029": { c4_city_of_squalor: true },
    "030": { c4_cloud_ship: true },
    "037": { last_oasis: true },
    "038": { hs: true },
    "039": { ENGIN: true },
    "046": { night_nymph: true },
  });
  assert.deepEqual(detail.unmapped, []);
});

test("地图导入：c3 实测（4 张分片；按锚点解出 10 列网格，坐标有歧义的格跳过并记录）", { skip: !c3SavePath }, () => {
  const parsed = jsaveImport.parseJsave(fs.readFileSync(c3SavePath));
  assert.equal(parsed.official.campaign_cycle, 2);
  assert.deepEqual(parsed.official.maps.map((map) => map.length), [80, 80, 80, 9]);
  const report = jsaveImport.convertWithReport(parsed.official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(report.sections, "c3");
  const detail = report.stats.map_detail;

  // 三个锚点：下标 42 → 002 = argo_tile；43 → 005 = adversary_tile；52（toks[0]）→ 001 = city_tile
  assert.equal(detail.map_index, 0);
  assert.match(detail.map_how, /10 列，起点格 1,0/);
  assert.deepEqual(detail.anchors.slice().sort(), ["adversary=005", "argo=002", "city=001"]);
  assert.deepEqual(detail.skipped_maps, [1, 2, 3]);
  // ATO 的 c3 板块表有 70 处坐标重复（92 个板块只落在 22 个格上）→ 大部分格无法可靠换 id，
  // 只有**唯一占用**的格才落位（本档实测 5 格），其余进 missing_official_cells。
  assert.equal(cycleState.tokens.AG, "002");
  assert.equal(cycleState.tokens.AD, "005");
  assert.deepEqual(cycleState.tokens.markers, {
    "001": { last_city: true },
    "005": { night_nymph: true },
    "009": { ENGIN: true },
  });
  // 逐格断言"歧义格没有被强行取第一个 id"：这 5 格是唯一占用格，多一格都说明歧义处理失效。
  assert.deepEqual(Object.keys(cycleState.explored).sort(), ["001", "002", "005", "009", "014"]);
  assert.ok(detail.missing_official_cells.length > 0, "c3 的歧义格必须被记录");
  assert.deepEqual(detail.unmapped.map((item) => item.key), ["skipped_maps", "missing_cells"]);
});


test("地图导入：格数与网格都对不上 / 读不到格表 → 一个地图字段都不写", () => {
  const fakeTiles = Array.from({ length: 80 }, (unused, index) => ({
    expl: true, revl: true, argo: index === 0, toks: [true, false], note: "x",
  }));
  const official = { campaign_cycle: 4, maps: [fakeTiles], campaign_stats: {} };

  // 1) ATO 该轮板块列表被截成 79 个，网格也不是 8×10 → 对应关系说不清，整体不写。
  const shortReport = jsaveImport.convertWithReport(official, {
    mapTiles: { c5: positionalTiles(tileIdsOf("c5").slice(0, 79)) },
  });
  assert.deepEqual(Object.keys(cycleStateOf(shortReport.sections, "c5")), ["tokens"]);
  assert.deepEqual(cycleStateOf(shortReport.sections, "c5").tokens, {});
  assert.match(shortReport.stats.map_detail.note, /都对不上/);

  // 2) 读不到 map/map-data.js 的格表（tileId 换不成补零串）→ 同样不写。
  const noTableReport = jsaveImport.convertWithReport(official, { mapTiles: {} });
  assert.deepEqual(cycleStateOf(noTableReport.sections, "c5").tokens, {});
  assert.match(noTableReport.stats.map_detail.note, /读不到 map\/map-data\.js/);

  // 3) 两个分片都跟 c5 的板块数/网格（8×10）对不上 → 不写。分片本身是支持的：
  //    c5 的 8×10 网格会让"80 格分片"走网格路径，所以这里刻意用 79 格的分片。
  const oddTiles = fakeTiles.slice(0, 79);
  const twoMapsReport = jsaveImport.convertWithReport(
    { campaign_cycle: 4, maps: [oddTiles, oddTiles] }, { mapTiles: MAP_TILES });
  assert.deepEqual(Object.keys(cycleStateOf(twoMapsReport.sections, "c5")), ["tokens"]);
  assert.match(twoMapsReport.stats.map_detail.note, /都对不上/);

  // 4) 反向对照：分片格数与板块数一致时**确实**会写，否则上面三条负向断言可能是"反正都不写"。
  const ok = jsaveImport.convert(official, { mapTiles: MAP_TILES });
  const cycleState = cycleStateOf(ok, "c5");
  assert.equal(Object.keys(cycleState.explored).length, 80);
  assert.deepEqual(cycleState.previewRevealed, {}, "expl=true 的 revl 标志不进 previewRevealed");
  assert.equal(Object.keys(cycleState.tileNotes).length, 80);
  assert.equal(cycleState.tokens.AG, tileIdsOf("c5")[0]);
});

// ---------------------------------------------------------------- 主控台导入入口分流

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'" };

function extractInlineScript(source) {
  const marker = "const legacyStorageKey";
  const start = source.lastIndexOf("<script>", source.indexOf(marker));
  const end = source.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start, "index.html 的主内联脚本块");
  return source.slice(start + "<script>".length, end);
}

function extractFunction(source, name) {
  const match = source.match(new RegExp(
    `^( *)(?:async )?function ${name}\\([^]*?^\\1}`, "m"));
  assert.ok(match, `index.html 里找不到函数 ${name}`);
  return match[0];
}

const MAIN_SCRIPT = extractInlineScript(scoreSource);

// 把 importStateFile() 单独拉出来跑：统计它到底把哪些分区、以什么 expectedRevisions
// 交给了 importCampaignSections()，以及最终写进页面的 archive 是哪个循环。
function runImport(fileBytes, fileName) {
  const calls = [];
  const alerts = [];
  const confirms = [];
  const rendered = [];
  const reader = {};
  const context = vm.createContext({
    console,
    // 页面里的转换器是挂在 window 上的（index.html 用 window.ATO_JSAVE_IMPORT）。
    window: { ATO_JSAVE_IMPORT: jsaveImport, ATO_JSAVE_TABLES: jsaveTables },
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    clearTimeout,
    campaignSaveTimer: null,
    setTimeout,
    queueMicrotask,
    FileReader: function FileReader() { return reader; },
    ATO_JSAVE_IMPORT: jsaveImport,
    ATO_JSAVE_TABLES: jsaveTables,
    // applyImportedSections 的「覆盖笔记」判断用页面自己的 isPlainObject 读记录表分区
    // （下面的 vm.runInContext 会把真函数一起注进来），这里不用手写替身。
    // importStateFile / applyImportedSections 依赖的东西
    backupSectionIds: ["dashboard", "map", "record", "technology", "heroes", "aibp", "story"],
    normalizeArchive: (value) => ({
      activeProfileId: value?.activeProfileId || "default",
      profiles: value?.profiles || {},
    }),
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    currentCycle: () => ({ id: "c1", state: { day: "1" } }),
    flushCampaignSave: async () => true,
    // 服务端存档里没有 record 分区 → 当前战役没有笔记 → 覆盖警告不弹窗。
    loadFullCampaign: async () => ({ sectionRevisions: { dashboard: 3, record: 5 } }),
    importCampaignSections: async (sections, expectedRevisions) => {
      calls.push({ sections, expectedRevisions });
      return { ok: true, sections: { dashboard: 4 } };
    },
    renderDashboardArchive: (value) => { rendered.push(value); },
    campaignSyncChannel: { postMessage() {} },
    elements: { importInput: { value: "x" } },
  });
  context.window.alert = (message) => alerts.push(String(message));
  context.window.confirm = (message) => { confirms.push(String(message)); return true; };
  context.window.setTimeout = (callback) => { callback(); return 0; };
  vm.runInContext([
    extractFunction(MAIN_SCRIPT, "isPlainObject"),
    /^( *)(?:async )?function applyImportedSections\(/m.test(MAIN_SCRIPT)
      ? extractFunction(MAIN_SCRIPT, "applyImportedSections") : "",
    extractFunction(MAIN_SCRIPT, "importStateFile"),
  ].join("\n"), context);
  context.FileReaderInstance = reader;
  reader.result = null;
  reader.readAsArrayBuffer = () => {
    reader.result = fileBytes.buffer.slice(
      fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
    queueMicrotask(() => reader.onload());
  };
  context.__file = { name: fileName };
  vm.runInContext("importStateFile(__file)", context);

  // 导入成功后 applyImportedSections() 会把新的 archive 交给 renderDashboardArchive()。
  // 注意这里返回的是**取值函数**：调用 runImport() 时异步链还没跑完（vm 里 `let archive`
  // 的绑定在宿主侧也读不到），必须等 setImmediate 之后再调用来拿最终值。
  return { calls, alerts, confirms, getArchive: () => (rendered.length ? rendered[0] : null), ctx: context };
}

test("导入入口：.jsave 走转换器，expectedRevisions 语义与常规导入一致", async () => {
  const official = {
    campaign_cycle: 2,
    campaign_uid: 7,
    campaign_name: "fixture",
    campaign_stats: { story_card: 1, doom_card: 0, story_tokens: 2, doom_tokens: -1, inward: false },
    cargo_resources: [1],
    timeline_status: [true, true, false],
    argo_stats_vals: [],
    argo_stats_lims: [],
    matrix: [true],
  };
  const bytes = jsaveBytes(official);
  const expected = jsaveImport.convert(official);
  const { calls, alerts, confirms, getArchive } = runImport(bytes, "campaign_0005.jsave");

  // 等 FileReader 的 onload 里的 await 链跑完
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(alerts, ["导入完成。"]);
  // 服务端存档里没有 record 分区 = 当前战役没有笔记：覆盖警告不得打断导入。
  // （.jsave 转换出的笔记本身非空，所以这一条正好覆盖"有一边为空"的情形。）
  assert.deepEqual(confirms, [], "当前战役没有笔记时不该弹覆盖警告");
  assert.equal(calls.length, 1, "必须只发起一次整包导入");
  const [call] = calls;
  // dashboard/map/record/technology/heroes 从 .jsave 来；aibp/story 没有对应数据 → 不提交。
  assert.deepEqual(Object.keys(call.sections).sort(),
    ["dashboard", "heroes", "map", "record", "technology"]);
  assert.deepEqual(call.sections.record, expected.record, "record 分区必须原样送进合并路径");
  assert.deepEqual(call.sections.map, expected.map);
  // 顶层 dashboard 用的是归一化后的 archive（含全部循环），循环停在 .jsave 对应的那个。
  assert.equal(call.sections.dashboard.profiles.default.activeCycleId, "c3");
  assert.equal(call.sections.dashboard.profiles.default.cycles.c3.state.day,
    expected.dashboard.profiles.default.cycles.c3.state.day);
  assert.equal(call.sections.record.users.default.cycle, "c3");
  // 与常规导入完全同一条路径：expectedRevisions 就是服务器当前版本。
  // （vm 里造出来的对象与宿主的原型不同，所以比 JSON 文本而不是 deepEqual。）
  assert.equal(JSON.stringify(call.expectedRevisions),
    JSON.stringify({ dashboard: 3, map: 0, record: 5, technology: 0, heroes: 0 }));
  // 页面切到导入后的状态，且停在 .jsave 对应的循环。
  const archive = getArchive();
  assert.ok(archive, "archive 应当被赋值（renderDashboardArchive 必须被调用）");
  assert.equal(archive.profiles.default.activeCycleId, "c3");
});

test("导入入口：常规 ATO 状态包仍然照常工作（行为未变）", async () => {
  const payload = {
    app: "ATO Campaign Save Package",
    version: 3,
    activeProfileId: "default",
    profiles: {
      default: {
        id: "default",
        name: "默认用户",
        activeCycleId: "c2",
        cycles: { c2: { id: "c2", state: { day: "9" } } },
      },
    },
    sections: {
      dashboard: {
        activeProfileId: "default",
        profiles: {
          default: {
            id: "default",
            name: "默认用户",
            activeCycleId: "c2",
            cycles: { c2: { id: "c2", state: { day: "9" } } },
          },
        },
      },
      record: { users: { default: { cycle: "c2", day: "9" } } },
      map: { users: { default: { activeCycleId: "c2", cycles: {} } } },
      technology: { users: { default: { currentCycle: "cycle2", unlocked: ["last tome"] } } },
      heroes: { heroes: [], activeHeroId: "", graveyard: [] },
      aibp: null,
      story: null,
    },
  };
  const bytes = Buffer.from(encoder.encode(JSON.stringify(payload)), "utf8");
  const { calls, alerts } = runImport(bytes, "ato-full-save.json");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(alerts, ["导入完成。"]);
  assert.equal(calls.length, 1);
  // 完整状态包：null 的 aibp/story 也照旧提交（isFullBackup=true），与改动前一致。
  assert.equal(JSON.stringify(Object.keys(calls[0].sections).sort()),
    JSON.stringify(["aibp", "dashboard", "heroes", "map", "record", "story", "technology"]));
  assert.equal(JSON.stringify(calls[0].expectedRevisions),
    JSON.stringify({
      dashboard: 3, map: 0, record: 5, technology: 0, heroes: 0, aibp: 0, story: 0,
    }));
});

test("导入入口：无效 JSON、损坏档案和不完整官方存档在任何读写前拒绝", async () => {
  const invalid = [null, false, 42, "", [], {}, { unrelated: "not a save" },
    { app: "ATO Campaign Save Package", version: 3, sections: { heroes: {} } },
    { sections: [] }, { profiles: {} },
    { profiles: { p: { id: "p", cycles: { c5: { state: [] } } } } },
    { profiles: { p: { id: "another", state: { day: 1 } } } },
  ].map((value) => Buffer.from(JSON.stringify(value)));
  invalid.push(jsaveBytes({ campaign_cycle: 4, campaign_name: "only metadata" }));
  for (const bytes of invalid) {
    const run = runImport(bytes, "invalid.json");
    let reads = 0, flushes = 0;
    run.ctx.loadFullCampaign = async () => { reads++; throw new Error("不应读取服务端"); };
    run.ctx.flushCampaignSave = async () => { flushes++; return true; };
    run.ctx.archive = { untouched: true };
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.calls.length, 0);
    assert.equal(reads, 0);
    assert.equal(flushes, 0);
    assert.equal(run.ctx.archive.untouched, true);
    assert.equal(run.getArchive(), null);
    assert.match(run.alerts[0], /^导入失败：/);
    assert.equal(run.ctx.elements.importInput.value, "");
  }
});

test("导入入口：旧版状态、带 state 的旧档案和 profiles 档案仍可导入", async () => {
  for (const payload of [{ day: "T2", completed: {} }, { name: "旧档", state: { day: 6 } },
    { activeProfileId: "p", profiles: { p: { id: "p", state: { day: 6 } } } }]) {
    const run = runImport(Buffer.from(JSON.stringify(payload)), "legacy.json");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.calls.length, 1);
    assert.deepEqual(run.alerts, ["导入完成。"]);
  }
});

test("导入入口：坏文件给人话提示，不抛原始异常", async () => {
  const { alerts } = runImport(Buffer.from('{"not": "a save"', "utf8"), "broken.json");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^导入失败：/);
  assert.match(alerts[0], /整份存档没有写入/);
});

test("导入入口：.jsave 头 + 坏 JSON 提示「这看起来不是官方存档」", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0x81, 0xae, 0x05]),
    Buffer.from('{"campaign_cycle": 4, "cargo', "utf8"),
  ]);
  const { alerts } = runImport(bytes, "bad.jsave");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^导入失败：/);
});

test("导入对话框接受 .jsave 且转换器脚本已挂进页面", () => {
  // 断言用 indexOf 而不是正则：script 标签里带 `/` 和 `?`，正则写起来容易踩坑
  // （早先写过一个永远不命中的正则，白红了一轮）。
  const has = (needle) => assert.ok(scoreSource.includes(needle), `index.html 里缺少：${needle}`);
  has('id="importInput" type="file" accept="application/json,.json,.jsave,');
  has('<script src="./assets/jsave-tables.js');
  has('<script src="./assets/jsave-import.js');
  assert.match(scoreSource, /importButton[^>]*title="[^"]*\.jsave/);
  has("window.ATO_JSAVE_IMPORT");
  // 转换器读表，tables 必须先于 import 加载。
  assert.ok(scoreSource.indexOf("<script src=\"./assets/jsave-tables.js")
    < scoreSource.indexOf("<script src=\"./assets/jsave-import.js"),
    "jsave-tables.js 必须先于 jsave-import.js 加载");
  // 现有 JSON 导入路径的关键调用一字未改。
  has('imported.app === "ATO Campaign Save Package" && Number(imported.version) >= 3');
  has("await importCampaignSections(");
  has("reader.readAsArrayBuffer(file)");
});
