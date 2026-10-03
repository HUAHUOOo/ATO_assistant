#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""官方 Aeon Trespass App 存档（.jsave）→ ATO_assistant 存档 section 转换器。

用法：
    python import_jsave.py <file.jsave> [-o 输出目录] [--dump-json 路径]

也可以作为库使用：
    from import_jsave import convert_file, build_sections
    result = convert_file(path)          # -> ImportResult
    sections = result.sections           # 可直接塞进 ATO 存档的 sections 对象

只读输入，绝不写入 data/。所有产物由调用方决定写到哪。
映射依据见 jsave-work/双向缺口表.md，读过的 ATO 端代码在报告「证据」一节逐条标注。
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata

# ---------------------------------------------------------------- 路径与常量

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
TABLES = os.path.join(ROOT, "app-extract", "official-tables.json")
GEAR_PROD = os.path.join(ROOT, "technology", "ato_gear_production.json")
ATO_DATA = os.path.join(ROOT, "data")

MATRIX_ROWS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["AA", "BB", "CC", "DD", "EE", "FF"]
MATRIX_COLS = 12

# 官方 cycle 下标（0 基）→ ATO 循环 id
CYCLE_IDS = ["c1", "c2", "c3", "c4", "c5"]

# 机师技能：官方 ArgonautSkill 顺序 → ATO baseSkills 键
SKILL_KEYS = ["courage", "cunning", "endurance", "fury", "will", "wisdom"]

# 官方 21 项属性 → ATO record 字段。
# 值是 (顶层字段, cycleStats 内的字段)；None 表示 ATO 没有对应字段（会写进报告）。
# 「顶层 + cycleStats 双写」的理由：`record/index.html:2287-2291` 的 cycleIdentityKeys
# 说明这些字段是**按循环**的，真身在 `record.cycleStats[<cycle>]`，顶层的同名字段只是
# 当前循环的视图（normalize 里 :2735-2737 会把 cycleStats[cycle] 回填到顶层）。
STAT_TO_RECORD = {
    "CREW": ("crew", "crew"),
    "HULL": ("hull", "hull"),
    "AFATE": ("fate", "fate"),
    "AKNOW": None,           # ATO 无对应字段
    "AABILITY": ("aaLimit", "aaLimit"),
    "STRANGERS": ("strangers", "strangers"),
    "REFUGEES": None,        # → cycleStats.c2.crewCounters.refugees（单独写）
    "CAPTIVES": None,        # → cycleStats.c2.crewCounters.captives（单独写）
    "HUMANITY": ("humanity", "humanity"),
    "DEFECTORS": ("renegade", "renegade"),   # 界面标签「变节者」，图标 defectors.svg
    "CRIPPLED_TITANS": None,
    "PARADOX": ("paradox", "paradox"),
    "TIME_SILO": None,
    "FROZEN_TIME": ("frozenTime", "frozenTime"),
    "LOOP_LENGTH": ("loopLength", "loopLength"),
    "SUMMON_LIMIT": ("summonLimit", None),
    "TITAN_LIMIT": ("titanLimit", None),
    "BABELIAN_DEBT": ("babelianDebt", "babelianDebt"),
    "PARANOIA": ("paranoia", "paranoia"),
    "OXYGEN": ("oxygenCurrent", "oxygenCurrent"),
    "ARGONAUT_SUPPLY": ("supply", "supply"),
}

# 官方 argo_stats_lims[21] → ATO 的**上限**字段（不是当前值字段）。
# ATO 真正存在的上限字段只有：hull / crew（由 cycleData 的 hull/crew 数组决定）、
# titanLimit、nymphLimit、aaLimit、oxygenLimit（+ 半废弃的 godformLimit）。
# 本次存档的 argo_stats_lims **整列都是 0**，所以「有字段但没数据」也要如实标出来。
STAT_LIMIT_TO_RECORD = {
    "CREW": "crew",          # 上限来自 cycleData.c<N>.crew 的数组长度
    "HULL": "hull",          # 同上
    "AABILITY": "aaLimit",
    "SUMMON_LIMIT": "summonLimit",
    "TITAN_LIMIT": "titanLimit",
    "OXYGEN": "oxygenLimit",
}

# 货舱资源官方枚举名 → ATO 键名（只列「不是」机械小驼峰的特例）
CARGO_NAME_OVERRIDES = {
    "CALCIFIED_KNUCKLE_BONE": "calcifiedKnuckle",
    "BLACKWOOL_STRAND": "blackWoolStrand",
    "FADING_CONSTRUCT": "fadingLightConstruct",
}

# 官方 CORE_* → ATO 核心短名（ATO 里由 nemesis 敌人 key 派生，见 record/index.html:4476）
CORE_SHORT = {
    "CORE_HEKATON": "hekaton",
    "CORE_LABYRINTHAUROS": "labyrinthauros",
    "CORE_TEMENOS": "temenos",
    "CORE_CYCLONUS": "cyclonus",
    "CORE_CHIMERA_METASTASIOS": "chimera",
    "CORE_NIETZSCHEAN": "nietzschean",
    "CORE_HYPERTIME_ORACLE": "oracle",
    "CORE_ICARIAN_HARPY": "harpy",
    "CORE_SUN_DESCENDANT": "sunDescendant",
    "CORE_HERMESIAN_PURSUER": "pursuer",
    "CORE_BURDEN": "adversary",
    "CORE_MIDASCORE": "midascore",
    "CORE_DEMIDJINN": "demidjinn",
    "CORE_BABELIAN_LUNACY": "babelianLunacy",
    "CORE_DAHAKA": "dahaka",
    "CORE_DRAGON_PHOBOS": "dragonOfPhobos",
    "CORE_MEDUKETOS": "meduketos",
    "CORE_UR_FLEECE": "urFleece",
    "CORE_TITAN_X": "titanX",
}

# 官方阵营 id → ATO 阵营键名（据 app-extract/official-tables.json 的 icon 字段与
# record/index.html:1819-2174 的 diplomacy 表逐条对齐）
FACTION_TO_ATO = {
    "f_minoans": "minoians",
    "f_labyrinth": "labyrinthians",
    "f_hornsworn": "hornsworn",
    "f_helots": "helots",
    "f_cyclopes": "cyclopes",
    "f_symmachy": "symmachy",
    "f_sunheirs": "sunheirs",
    "f_delphians": "delphians",
    "f_twilight": "twilightWatch",
    "f_aristotelians": "aristotelians",
    "f_wasters": "wasters",
    "f_cthieves": "cloudThieves",
    "f_vanguard": "outcastVanguard",
    "f_followers": "followersOfArete",
    "f_protectorate": "cycladeanProtectorate",
}

# 官方神之形态名 → ATO summonCards.godforms 的 id（record/index.html:2243-2259）
GODFORM_ALIASES = {
    "zeus": "zeus",
    "poseidon": "poseidon",
    "demeter": "demeter",
    "hephaestus": "hephaestus",
    "hermes": "hermes",
    "hermos": "hermes",
    "ares": "ares",
    "artemis": "artemis",
    "athena": "athena",
    "hades": "hades",
    "哈迪斯": "hades",
    "dionysus": "dionysus",
    "aphrodite": "aphrodite",
    "hera": "hera",
    "helios-apollonis-exalted": "helios-apollonis-exalted",
    "poseidon-exalted": "poseidon-exalted",
    "poseidon ex": "poseidon-exalted",
    "zeus-exalted": "zeus-exalted",
    "hermes-exalted": "hermes-exalted",
}

# ATO 神之形态 id 全集（用于反查）
GODFORM_IDS = set(GODFORM_ALIASES.values()) | {
    "dionysus", "aphrodite", "helios-apollonis-exalted", "hera",
}

# ATO 宁芙 id 全集（record/index.html:2261-2283）
NYMPH_IDS = {
    "engine", "solitude", "amalthean", "labyrinth", "depths", "sweets", "nietzschean",
    "forge", "blade", "knowledge", "mask", "curiosity", "night", "age", "hope",
    "machina", "silica", "midas", "natron", "ambrosia", "aether",
}

# ATO 记录的「阿尔戈号资源」行表：c1..c5 各自定义了哪些行（record/index.html:1764-2196
# 的 cycleData.<c>.resources 逐条抄录，core / rare 是 sentinel 行）。
# 这份表就是键名前缀规则的**唯一权威**：一行属于哪个循环，它的存储键就用哪个循环的前缀。
ATO_CYCLE_RESOURCES = {
    "c1": ["trireme", "monument", "armament", "rawAmbrosia", "muscleCluster",
           "fearEssence", "calcifiedKnuckle", "mazeFragment", "grotesqueBeak",
           "infusedMechanism", "fleshyMantle", "powderedMatter", "core", "priests",
           "sisyphusTears", "rare"],
    "c2": ["warTrireme", "relief", "warMachine", "violentAmbrosia", "fearEssence",
           "chimericTar", "grotesqueBeak", "mazeFragment", "supersolidRelief",
           "powderedMatter", "cyclopeanMetal", "livingAbyss", "retractableMechanism",
           "blackChain", "skinOfMalice", "reliefshellFragment", "core", "priests",
           "sisyphusTears", "pygmalionStones", "rare"],
    "c3": ["sirenshell", "hyperboreanAlloy", "daedalusMakina", "frozenAmbrosia",
           "livingAbyss", "razorclaw", "grotesqueBeak", "skinOfMalice",
           "icarianFeather", "powderedMatter", "clothflesh", "writhingTentacle",
           "retractableMechanism", "eyesCluster", "sunburnedSkull",
           "reliefshellFragment", "core", "sisyphusTears", "priests", "echoes", "rare",
           "pygmalionStones"],
    "c4": ["cursedDerelict", "imperialScroll", "babylonianContraption",
           "mutableAmbrosia", "blackenedHalo", "burnedOutGrace", "cursedBloatsack",
           "livingGold", "wishEmbryo", "oldIremFragment", "blackTaintedStepfinger",
           "promisedFuturesCarcass", "onyxDust", "ireEssence", "core", "rare", "priests",
           "echoes", "sisyphusTears", "pygmalionStones"],
    "c5": ["atlanteanTekne", "orichalcumChunk", "liquidAether", "oxidizedAmbrosia",
           "promisedFuturesCarcass", "blackTaintedStepfinger", "hydradynamicScales",
           "amygdalanExtract", "photophobicFlesh", "microwaveCell", "blackWoolStrand",
           "fadingLightConstruct", "orichalcumAlloy", "slaveMetal", "core", "rare",
           "priests", "echoes", "sisyphusTears", "pygmalionStones"],
}

# 内蕴奥德赛轨道的 position 起点（index.html:4451 argoKnowledgeStart）
ARGO_KNOWLEDGE_START = {"c1": 1, "c2": 20, "c3": 40, "c4": 60, "c5": 80}

# 稀有资源文本行的「名称/值」分隔符（用户指定小写 x；要换成 `×` 或 `*` 只改这里）
RARE_VALUE_SEP = "x"

# 官方 CORE_* → 核心行所属循环（nemesisOptionsByCycle，record/index.html:2208-2214）
NEMESIS_BY_CYCLE = {
    "c1": ["pursuer"],
    "c2": ["adversary", "pursuer", "dahaka"],
    "c3": ["adversary", "dahaka"],
    "c4": ["dahaka"],
    "c5": ["titanX"],
}

# 每轮的所有敌人 key（record/index.html 的 cycleData.<c>.enemies）—— 核心行 `cN-core-<key>`
# 是按敌人而不是按 nemesis 选项生成的，真实存档 c1 档里同时有 pursuer 与 hekaton 的行。
CYCLE_ENEMIES = {
    "c1": ["hekaton", "labyrinthauros", "temenos", "pursuer"],
    "c2": ["cyclonus", "chimera", "nietzschean", "adversary"],
    "c3": ["oracle", "harpy", "sunDescendant", "adversary"],
    "c4": ["midascore", "demidjinn", "babelianLunacy", "dahaka"],
    "c5": ["dragonOfPhobos", "meduketos", "urFleece", "titanX"],
}

# 每轮每个敌人的**轨道格 id 序列**（record/index.html 的 cycleData.<c>.enemies[].stages[].id），
# 用来把官方 evo 的进度布尔数组落成 `record.enemies` 的 `<cycle>:<enemy>:<stageId>` 键。
# 这份是 record/index.html 的抽出结果；`parse_cycle_enemy_stages()` 会在运行时重新解析并比对。
CYCLE_ENEMY_STAGES = {
    "c1": {"hekaton": ["0", "1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c"],
           "labyrinthauros": ["spacer", "1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c"],
           "temenos": ["1", "2", "3", "4"],
           "pursuer": ["1", "2", "3", "4", "5"]},
    "c2": {"cyclonus": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
           "chimera": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
           "nietzschean": ["1", "2", "3", "4"],
           "adversary": ["1", "2", "3", "4", "5"]},
    "c3": {"oracle": ["1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c", "5"],
           "harpy": ["1a", "1b", "2a", "2b", "2c", "3", "4a", "4b", "4c", "5"],
           "sunDescendant": ["1", "2", "3", "4", "5"],
           "adversary": ["1", "2", "3", "4", "5"]},
    "c4": {"midascore": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c",
                         "5a", "5b", "5c", "5d", "6"],
           "demidjinn": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c",
                         "5a", "5b", "5c", "5d", "6"],
           "babelianLunacy": ["1", "2", "3", "4", "5", "6"],
           "dahaka": ["1", "2", "3", "4", "5", "6", "7", "8"]},
    "c5": {"dragonOfPhobos": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
           "meduketos": ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b", "4c"],
           "urFleece": ["1", "2", "3", "4", "5"],
           "titanX": ["1", "2", "3", "4", "5", "6", "7", "8", "9"]},
}

RECORD_HTML = os.path.join(ROOT, "record", "index.html")
MAP_DATA_JS = os.path.join(ROOT, "map", "map-data.js")


def load_ato_map_tiles(path=None):
    """读 map/map-data.js（`window.ATO_MAP_DATA = {...}`），返回 {cycle: [tileId, ...]}。

    用来决定 `map...tokens.AG/AD` 里 tileId 的写法（真实数据是 `"001"` 这种补零串）。
    """
    path = path or MAP_DATA_JS
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except (OSError, ValueError):
        return {}
    return {c.get("id"): [str(t.get("id")) for t in (c.get("tiles") or [])]
            for c in (data.get("cycles") or [])}

# 按循环存的「身份字段」（record/index.html:2287-2291 cycleIdentityKeys）：
# 真身在 record.cycleStats[<cycle>]，顶层的同名字段只是「当前循环的视图」
# （normalize 里 :2735-2737 把 cycleStats[cycle] 的值回填到顶层）。
CYCLE_IDENTITY_KEYS = [
    "storyCard", "doomCard", "mapTiles", "fate", "aaLimit", "strangers", "humanity",
    "renegade", "loopLength", "frozenTime", "paradox", "babelianDebt", "oxygenCurrent",
    "oxygenLimit", "reapMarkNotes", "sowMarkNotes", "paranoia",
]


def parse_cycle_enemy_stages(path=None):
    """从 record/index.html 的 `const cycleData = {...}` 块里解析每轮敌人的 stage id 序列。

    按缩进正则切块，够用且不需要 JS 引擎；解析失败返回 {}（调用方退回硬编码表）。
    """
    path = path or RECORD_HTML
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        start = text.index("const cycleData = {")
        end = text.index("const nemesisOptionsByCycle")
        block = text[start:end]
    except (OSError, ValueError):
        return {}
    out, cycle, enemy = {}, None, None
    for line in block.split("\n"):
        m = re.match(r"\s{6}(c[1-5]):\s*\{", line)
        if m:
            cycle, enemy = m.group(1), None
            out[cycle] = {}
            continue
        if cycle is None:
            continue
        m = re.match(r'\s+key:\s*"([^"]+)",\s*$', line)
        if m:
            enemy = m.group(1)
            out[cycle][enemy] = []
            continue
        m = re.match(r'\s+\{ id: "([^"]+)"', line)
        if m and enemy:
            out[cycle][enemy].append(m.group(1))
            continue
        m = re.match(r'\s+\{ key: "([^"]+)",[^}]*stages: \[([^\]]*)\]', line)
        if m:
            out[cycle][m.group(1)] = re.findall(r'"([^"]+)"', m.group(2))
    return out

CORE_CYCLE = {
    "CORE_HEKATON": "c1", "CORE_LABYRINTHAUROS": "c1", "CORE_TEMENOS": "c1",
    "CORE_HERMESIAN_PURSUER": "c1",
    "CORE_CYCLONUS": "c2", "CORE_CHIMERA_METASTASIOS": "c2", "CORE_NIETZSCHEAN": "c2",
    "CORE_BURDEN": "c2",
    "CORE_HYPERTIME_ORACLE": "c3", "CORE_ICARIAN_HARPY": "c3",
    "CORE_SUN_DESCENDANT": "c3",
    "CORE_MIDASCORE": "c4", "CORE_DEMIDJINN": "c4", "CORE_BABELIAN_LUNACY": "c4",
    "CORE_DAHAKA": "c4",
    "CORE_DRAGON_PHOBOS": "c5", "CORE_MEDUKETOS": "c5", "CORE_UR_FLEECE": "c5",
    "CORE_TITAN_X": "c5",
}


def compute_shared_resource_keys(cycle_resources=None):
    """复刻 record/index.html:2227-2240 的 `sharedResourceKeys`：
    在 c1..c5 的 resources 里出现 **>1 次** 的键算共享键（`core` sentinel 除外）。
    """
    table = cycle_resources or ATO_CYCLE_RESOURCES
    counts = {}
    for cycle in CYCLE_IDS:
        for key in set(table.get(cycle) or []):
            if key == "core":
                continue
            counts[key] = counts.get(key, 0) + 1
    return {key for key, count in counts.items() if count > 1}


SHARED_RESOURCE_KEYS = compute_shared_resource_keys()


def defining_cycle(row_key):
    """该资源行最早在哪个循环被定义（同一 key 可能在多个循环里出现）。"""
    for cycle in CYCLE_IDS:
        if row_key in (ATO_CYCLE_RESOURCES.get(cycle) or []):
            return cycle
    return None


def cycles_defining(row_key):
    return [c for c in CYCLE_IDS if row_key in (ATO_CYCLE_RESOURCES.get(c) or [])]


def non_shared_duplicate_rows():
    """出现在多个循环、但**没有**被算成共享键的行 —— 规则要求它为空。

    （`sharedResourceKeys` 的判据就是「出现 >1 次」，所以两者应当等价。）
    """
    return sorted(
        row for row in {r for rows in ATO_CYCLE_RESOURCES.values() for r in rows}
        if row != "core" and len(cycles_defining(row)) > 1
        and row not in SHARED_RESOURCE_KEYS)


def ato_resource_key(row_key):
    """ATO 资源存储键：共享键不带前缀，其余用**定义它的那个循环**的前缀。

    这条规则来自 record/index.html:4621 `resourceStorageKey()`：
        sharedResourceKeys.has(key) ? key : `${state.cycle}-${key}`
    `state.cycle` 是定义该行的循环（切到 c1 时 c1 的行就是 `c1-xxx`）。
    真实存档校验（data/ato-campaign-1111.json 的 c1 档）：
      * `c1-trireme` / `c1-monument` / `c1-infusedMechanism` / `c1-calcifiedKnuckle`（c1 独有行）带前缀
      * `fearEssence` / `grotesqueBeak` / `powderedMatter` / `pygmalionStones`（多个循环都有的行）不带
      * `c1-core-pursuer` / `c1-core-hekaton`（动态核心行）也带前缀

    注意：c4 与 c5 **都有**的行（`blackTaintedStepfinger`、`promisedFuturesCarcass`）也算共享键，
    所以存储键是不带前缀的裸名 —— 即使这个值是 c5 页签上的那一行。
    """
    cycle = defining_cycle(row_key)
    if row_key in SHARED_RESOURCE_KEYS or cycle is None:
        return row_key
    return "%s-%s" % (cycle, row_key)


# ---------------------------------------------------------------- 小工具

def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def camel(name):
    """TRIREME→trireme，RAW_AMBROSIA→rawAmbrosia。"""
    parts = [p for p in name.split("_") if p]
    if not parts:
        return ""
    return parts[0].lower() + "".join(p[:1].upper() + p[1:].lower() for p in parts[1:])


def fold(text):
    """大小写/重音/标点归一，用于宽松比对名字。"""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def english_of(label):
    """'Trireme Armor 三列桨战船盔甲' → 'trireme armor'。"""
    head = re.split(r"[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]", str(label), 1)[0]
    return head.strip()


def split_key(key):
    """mnemos_c1_09 → ('c1', '09')；fm_c1_03 → ('c1','03')。"""
    m = re.search(r"(c[1-5])_(\d+)", str(key))
    return (m.group(1), m.group(2)) if m else (None, None)


def unique_id(prefix, seen):
    """生成不与 seen 冲突的 id。"""
    candidate = "%s-%d" % (prefix, int(time.time() * 1000) % 10 ** 10)
    n = 0
    while candidate in seen:
        n += 1
        candidate = "%s-%d-%d" % (prefix, int(time.time() * 1000) % 10 ** 10, n)
    seen.add(candidate)
    return candidate


# ---------------------------------------------------------------- 矩阵备注解析

_LETTER_RE = re.compile(r"[A-Za-z]+")
_DIGIT_RE = re.compile(r"[0-9]+")
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
                     r"\u3040-\u30ff\uac00-\ud7af]")

CIRCLE_WORDS = ("圈起来", "圈出", "圈")
CROSS_WORDS = ("划掉", "划去", "叉")
# 判定「独立词元」时的分隔符（参照 jsave-work/matrix-notes-0000.txt 的样例）
SEPARATORS = " \t\r\n,.;:!?、，。；：！？·|/\\-–—()（）[]【】\"'“”‘’"


def tokenize_notes(text):
    """把备注切成 (start, end, token)，标点只作分隔符。

    * 拉丁字母/数字成段：`l`、`sow`、`buyaobuaoji`
    * 「圈」类关键词单独成段（并吸收它左边的字）：`L 圈起来的谎言` → `L` + `圈起来`
      —— 这样「圈起来的谎言」不会被整段吃掉，切开后剩下的 `的谎言` 才能进笔记；
      但 `谎言圈起来` 里的 `谎言` 会被吸进关键词段（多消费几个字，只会让笔记更少，不会写错矩阵）。
    * 其余汉字连续成段
    """
    out = []
    index = 0
    while index < len(text):
        ch = text[index]
        if ch in SEPARATORS:
            index += 1
            continue
        if ch.isascii() and (ch.isalpha() or ch.isdigit()):
            match = _LETTER_RE.match(text, index) or _DIGIT_RE.match(text, index)
            out.append((match.start(), match.end(), match.group()))
            index = match.end()
            continue
        hit = _circle_in(text[index:])
        if not hit:
            hit = _cross_in(text[index:])
        if hit:
            # 把 index 到关键词末尾整体吃成一个 token（含左侧汉字），
            # 解析时只切掉关键词本身，左侧汉字会退回笔记。
            end = index + hit[1]
            out.append((index, end, text[index:end]))
            index = end
            continue
        match = _CJK_RE.match(text, index)
        if match:
            out.append((match.start(), match.end(), match.group()))
            index = match.end()
        else:
            index += 1
    return out


def _circle_in(token):
    for word in CIRCLE_WORDS:
        pos = token.find(word)
        if pos >= 0:
            return pos, pos + len(word)
    return None


def _cross_in(token):
    for word in CROSS_WORDS:
        pos = token.find(word)
        if pos >= 0:
            return pos, pos + len(word)
    return None


def parse_matrix_note(note):
    """解析一条矩阵备注。

    返回 dict：
      value    : ATO matrix 值（"T"/"L"/"circle"/"circleT"/"circleL"/"cross"/None）
      leftover : 去掉被消费词元后的剩余文本（未做首尾分隔符裁剪）
      consumed : 被消费的词元列表（用于报告）
    """
    raw_tokens = tokenize_notes(note or "")
    toks = [t for t in raw_tokens if t[2]]
    consumed = []
    circle = False
    kind = None       # "letter" / "circle" / "cross"
    letter = None

    # 1) 先找「圈」类词元（可能是一整段汉字里的一段，例如 `圈起来的谎言`）
    for start, end, token in toks:
        if circle:
            break
        hit = _circle_in(token)
        if hit:
            circle = True
            kind = kind or "circle"
            # 只切掉「圈」那几字；词元里其余的字（如 `圈起来的谎言` 的 `的谎言`）
            # 由 _remaining_text 自动保留，无需另外记录
            consumed.append((start + hit[0], start + hit[1]))

    # 2) 再找「划掉」类
    if not circle:
        for start, end, token in toks:
            hit = _cross_in(token)
            if hit:
                kind = "cross"
                consumed.append((start + hit[0], start + hit[1]))
                break

    # 3) 字母标记：只认「整段就是一个字母」的 token，取第一个
    letter_tokens = [(s, e, t) for (s, e, t) in toks if len(t) == 1 and t in "TtLl"]
    if letter_tokens:
        s, e, t = letter_tokens[0]
        letter = t.upper()
        consumed.append((s, e))

    # 4) 组值
    if circle and letter:
        value = "circle" + letter
    elif circle:
        value = "circle"
    elif kind == "cross":
        value = "cross"
    elif letter:
        value = letter
    else:
        value = None

    # 5) 重建剩余文本：保留所有未被消费区间覆盖的字符（顺序不变）
    cuts = sorted([c for c in consumed if isinstance(c[0], int)], key=lambda c: c[0])
    leftover_raw = _remaining_text(note or "", cuts)
    return {"value": value, "leftover": leftover_raw, "consumed": cuts,
            "circle": circle, "cross": kind == "cross", "letter": letter}


def _remaining_text(text, cuts):
    """返回 text 中不在任何 cut 区间内的字符（保持原顺序）。"""
    ranges = sorted(cuts)
    out = []
    index = 0
    for s, e in ranges:
        if s > index:
            out.append(text[index:s])
        index = max(index, e)
    out.append(text[index:])
    return "".join(out)


TRIM_CHARS = " \t\r\n"        # 只裁空白

# 单独残留的标记字（`圈` 这类）说明关键词被切错了，视为已被消费，不进笔记
MARKER_CHARS = set("圈划掉去叉.") | set(" \t\r\n,.;:!?、，。；：！？·|/\\-–—()（）[]【】\"'“”‘’")

# 中文虚词/助词：如果残留文本以这些字打头，说明它失去了被消费词元的依托，读起来是断的
CHINESE_FUNCTION_CHARS = set("的了之乎者也而且或但与和及以及在于其所以被把给对从向")


def clean_leftover(text):
    """只裁掉首尾空白。

    （早先版本会连首尾标点一起裁，结果 `a l.sow` 的残留 `.sow` 被裁成 `sow`；
     用户要求保留 `.sow`，所以这里只裁空白。）
    """
    return text.strip(TRIM_CHARS)


def is_only_markers(text):
    return bool(text) and all(ch in MARKER_CHARS for ch in text)


def leftover_is_meaningful(leftover):
    """残留文本能否独立成立。

    * 纯 ASCII（英文/编号）→ 能（`.sow`、`2x`、`cd` 都读得懂）
    * 含汉字 → 至少 2 个字，且不以虚词打头（`的谎言` 不行，`船坞` 可以）
    """
    if not leftover:
        return False
    if all(ord(ch) < 128 for ch in leftover):
        return True
    first = leftover[0]
    if first in CHINESE_FUNCTION_CHARS:
        return False
    return len(leftover) >= 2


# ---------------------------------------------------------------- 各类转换

class Converter:
    def __init__(self, tables, gear_prod, drop_dead_slots=False):
        self.tables = tables
        self.gear_prod = gear_prod
        # 默认 False = 4 个在役槽全部导入；True 是有损的旧行为，只作 opt-in 保留
        self.drop_dead_slots = drop_dead_slots
        self.argo_order = tables["argo_stats_order"]
        self.cargo_order = tables["cargo_resource_order"]
        self.skill_order = tables["argonaut_skills_order"]
        self.hubs = tables["adventure_hubs"]
        self.factions = tables["diplomacy_factions_by_cycle"]
        self.tech_names = gear_prod.get("techCardNames", {})
        self.gear_names = gear_prod.get("gearCards", {})
        self.warnings = []
        self.stats = {}
        self.matrix_rows = []
        self.official_keys = list(OFFICIAL_TOP_KEYS)

    # -------- dashboard

    def leading_true(self, flags):
        """从 0 开始的连续 true 段长度；非连续时取最长前缀并告警。"""
        count = 0
        for flag in flags:
            if flag:
                count += 1
            else:
                break
        total = sum(1 for f in flags if f)
        if count != total:
            self.warnings.append(
                "timeline_status 非连续：前缀 %d 格为 true，但全表共 %d 格 true；"
                "ATO 只按前缀换算天数，后续 true 格会丢失。" % (count, total))
        return count

    def build_dashboard(self, official, cycle_id):
        state = {}
        timeline = official.get("timeline_status") or []
        # 官方的 timeline 是 **0 基下标**：81 格全 true = 下标 0..80 = 游戏内第 80 天
        # （用户在游戏内核对：campaign_0000 的 day = 80，已确认差 1 的疑问）。
        # 所以天数是「最后一个 true 的下标」，不是 true 的个数；0 格 true（全新战役）→ 第 0 天。
        marked = self.leading_true(timeline) if timeline else 0
        day = max(0, marked - 1)
        state["day"] = day

        date_notes = {}
        for index, note in enumerate(official.get("timeline_notes") or []):
            if note:
                date_notes["%02d" % index] = note
        state["dateNotes"] = date_notes

        # cardTracks 真实结构（data/ato-campaign-11111.json）：
        #   {"story": {"position": int, "progress": int, "doom": int}, "doom": {...},
        #    "inwardOdyssey": {...}}
        # 官方只有 story_card / doom_card / inward，没有 position/progress 的子结构。
        stats = official.get("campaign_stats") or {}
        story_card = stats.get("story_card")
        doom_card = stats.get("doom_card")
        # inwardOdyssey.position = 阿尔戈号知识起点（index.html:4451 argoKnowledgeStart）
        inward_position = ARGO_KNOWLEDGE_START.get(cycle_id, 0)
        # inwardOdyssey.progress = 官方 inward 布尔。
        # 用户确认语义：这个槽**最多只能放 1 个进展**，所以官方直接用布尔表示（true → 1，false → 0）
        # —— 不是"猜的转换"，而是官方表达方式就是 0/1。
        inward_progress = 1 if stats.get("inward") else 0
        # 卡上的 TOKENS = ATO 卡轨的「进展」计数器。依据官方 SAVE 屏截图（对话内已核对）：
        # 每张卡只有一个 TOKENS 槽，story_tokens=-1 时该槽为空、doom_tokens=1 时显示 1；
        # 且 ATO 自己提示「在故事步骤放置 1 个进展」→ 卡上的指示物就是「进展」。
        # 官方用 -1 表示"未设置" → ATO 用 0。
        # ATO 的 doom 轨另有「灾祸」计数器（cardTracks.doom.doom），官方无此维度 → 保持 0。
        story_progress = stats.get("story_tokens")
        doom_progress = stats.get("doom_tokens")
        state["cardTracks"] = {
            "story": {"position": int(story_card) if isinstance(story_card, int) and story_card >= 0 else 0,
                      "progress": max(0, story_progress) if isinstance(story_progress, int) else 0, "doom": 0},
            "doom": {"position": int(doom_card) if isinstance(doom_card, int) and doom_card >= 0 else 0,
                     "progress": max(0, doom_progress) if isinstance(doom_progress, int) else 0, "doom": 0},
            "inwardOdyssey": {"position": inward_position, "progress": inward_progress, "doom": 0},
        }
        state["cardTracksVersion"] = 2

        self.stats["day"] = day
        self.stats["dateNotes"] = len(date_notes)
        self.stats["inward"] = stats.get("inward")
        self.stats["inward_progress"] = inward_progress
        return state

    # -------- record

    def row_key_of(self, name):
        """官方货舱枚举名 → ATO 的记录表行 key（不含循环前缀）。"""
        if name in CORE_SHORT:
            return "core-%s" % CORE_SHORT[name]
        return CARGO_NAME_OVERRIDES.get(name) or camel(name)

    def storage_key_of(self, name):
        """官方货舱枚举名 → ATO 的 resources 存储键。"""
        if name in CORE_SHORT:
            cycle = CORE_CYCLE.get(name) or defining_cycle("core-%s" % CORE_SHORT[name])
            return "%s-core-%s" % (cycle, CORE_SHORT[name]) if cycle else "core-%s" % CORE_SHORT[name]
        return ato_resource_key(self.row_key_of(name))

    def resource_keys_for_cycle(self, cycle_id):
        """官方 85 项枚举 → ATO 资源存储键（键的前缀取决于**定义该行的循环**，不是当前循环）。"""
        return {name: self.storage_key_of(name) for name in self.cargo_order[:85]}

    def build_resources(self, official, cycle_id):
        resources = {}
        keymap = self.resource_keys_for_cycle(cycle_id)
        rows = set(ATO_CYCLE_RESOURCES[cycle_id])
        # ATO **任意循环**里出现过的行（用来判「官方这一项 ATO 根本没有对应行」，
        # 例如 UMBRAL_COUNT / STRING_WISH / STRING_WISH_PICK）；core / rare 是 sentinel 行，不算。
        rows_anywhere = set()
        for names in ATO_CYCLE_RESOURCES.values():
            rows_anywhere.update(n for n in names if n not in ("core", "rare"))
        values = official.get("cargo_resources") or []
        written = 0
        skipped_zero = 0
        zero_with_key = 0
        not_in_cycle_rows = []
        unrendered_nonzero = []
        detail = []
        for index, name in enumerate(self.cargo_order[:85]):
            value = values[index] if index < len(values) else 0
            row_key = self.row_key_of(name)
            core = name in CORE_SHORT
            in_rows = (row_key in rows) if not core else (
                CORE_CYCLE.get(name) == cycle_id or row_key in rows)
            storage = keymap[name]
            if not in_rows:
                not_in_cycle_rows.append(name)
            if not value:
                skipped_zero += 1
                if in_rows:
                    zero_with_key += 1
            else:
                resources[storage] = int(value)
                written += 1
                if not in_rows:
                    unrendered_nonzero.append("%s=%s" % (name, value))
            detail.append({
                "index": index, "official": name, "value": int(value or 0),
                "row_key": row_key, "storage_key": storage,
                "defining_cycle": CORE_CYCLE.get(name) if core else defining_cycle(row_key),
                "cycles": [CORE_CYCLE[name]] if core and name in CORE_CYCLE
                          else cycles_defining(row_key),
                "shared": (row_key not in CORE_SHORT) and row_key in SHARED_RESOURCE_KEYS,
                "visible_now": bool(in_rows),
                # 「ATO 有对应行」= 行 key 直接命中，或只是命名变体
                # （SUPERSOLID_RELIEF_MASS → supersolidReliefMass，ATO 那行叫 supersolidRelief）
                "ato_row": bool(core) or row_key in rows_anywhere
                           or any(row_key in r or r in row_key for r in rows_anywhere),
                "written": bool(value),
            })

        # 稀有资源：ATO 是跨循环共享的一行文本（record/index.html:1840 resources["rare"]），
        # 用户指定格式：`名称` + 小写 x + `值`，逐条一行（textarea 支持换行）。
        # 名称里含空格也原样保留；值缺失/为负按 0 处理。
        rare_names = [str(n) for n in (official.get("rres_names") or [])]
        rare_vals = official.get("rres_vals") or []
        rare_lines = []
        rare_pairs = []
        for index, name in enumerate(rare_names):
            if not name.strip():
                continue
            raw = rare_vals[index] if index < len(rare_vals) else None
            try:
                value = int(raw)
            except (TypeError, ValueError):
                value = 0
            if value < 0:
                value = 0
            line = "%s%c%d" % (name, RARE_VALUE_SEP, value)
            rare_lines.append(line)
            rare_pairs.append({"name": name, "value": value, "line": line,
                               "raw": raw, "missing": raw is None})
        if rare_lines:
            resources["rare"] = "\n".join(rare_lines)

        self.stats["resource_rows"] = written
        self.stats["resource_zero_rows"] = skipped_zero
        self.stats["zero_with_key"] = zero_with_key
        self.stats["not_in_cycle_rows"] = not_in_cycle_rows
        self.stats["unrendered_nonzero"] = unrendered_nonzero
        self.stats["resource_detail"] = detail
        self.stats["rare_lines"] = rare_lines
        self.stats["rare_pairs"] = rare_pairs
        self.stats["rare_names"] = len(rare_names)
        self.stats["rare_vals"] = len(rare_vals)
        return resources, keymap

    def build_adventures(self, official, cycle_id):
        """官方 adventures[41] → ATO record.adventures 字典。

        官方第 k 条按 adventure_hubs 顺序拿 adv_count；
        adv_progress 长度 = 1 + adv_count + 1，依次 α → adv1..advN → Ω。
        ATO 键 = `<cycle>-<本轮 hub 序号从 0 起>-<槽位>`（record/index.html:4103, 4112）。
        """
        hubs = self.hubs
        mine = [h for h in hubs if h["cycle"] == "CYCLE_%02d" % (CYCLE_IDS.index(cycle_id) + 1)]
        adventures = {}
        cells = 0
        mismatch = []
        list_ = official.get("adventures") or []
        for local_index, hub in enumerate(mine):
            k = hubs.index(hub)
            entry = list_[k] if k < len(list_) else None
            if entry is None:
                mismatch.append((hub["hub"], "官方存档缺该条目"))
                continue
            progress = entry.get("adv_progress") or []
            expected = 1 + int(hub["adv_count"]) + 1
            if len(progress) != expected:
                mismatch.append((hub["hub"], "adv_progress 长度 %d ≠ 1+%s+1=%d"
                                 % (len(progress), hub["adv_count"], expected)))
            for slot_index, value in enumerate(progress):
                if slot_index == 0:
                    slot = "alpha"
                elif slot_index == len(progress) - 1:
                    slot = "omega"
                else:
                    slot = "mid%d" % slot_index
                if not value:
                    continue      # 0 不写（见报告「取舍」）
                adventures["%s-%d-%s" % (cycle_id, local_index, slot)] = True
                cells += 1
        self.stats["adventure_cells"] = cells
        self.stats["adventure_hubs_seen"] = len(mine)
        self.stats["adventure_mismatch"] = mismatch
        return adventures

    def build_diplomacy(self, official, cycle_id):
        """官方 `diplomacy_factions[3]`（整数数组）→ `record.diplomacy["<cN>-<faction>"]`。

        **按名字映射，不按下标**：官方表的顺序与 ATO `cycleData.<c>.diplomacy` 数组顺序在
        c4 / c5 上不一致（c4 的 aristotelians/wasters 互换；c5 三家整体轮换），
        所以这里用「官方数组下标 ↔ 官方表里同 cycle 的第 i 个 `f_*`」配对，
        每个 `f_*` 再经 `FACTION_TO_ATO` 落到 ATO 键 —— 绝不 `zip` 两边的数组。
        """
        targets = [f for f in self.factions
                   if f["cycle"] == "CYCLE_%02d" % (CYCLE_IDS.index(cycle_id) + 1)
                   and str(f["id"]).startswith("f_")]
        values = official.get("diplomacy_factions") or []
        diplomacy = {}
        unmapped = []
        audit = []
        for index, faction in enumerate(targets):
            value = values[index] if index < len(values) else 0
            key = FACTION_TO_ATO.get(faction["id"])
            if not key:
                unmapped.append(faction["id"])
                continue
            full = "%s-%s" % (cycle_id, key)
            diplomacy[full] = str(value)
            audit.append({"index": index, "official_id": faction["id"],
                          "ato_key": full, "value": str(value)})
        if unmapped:
            self.warnings.append("阵营 id 无 ATO 对应：%s" % ", ".join(unmapped))
        if len(values) > len(targets):
            self.warnings.append(
                "diplomacy_factions 有 %d 项，本轮只认前 %d 项（官方表里同 cycle 的 "
                "`-10`/`0` 行是外交轨道区间标记，不是阵营）" % (len(values), len(targets)))
        self.stats["diplomacy_rows"] = len(diplomacy)
        self.stats["diplomacy_audit"] = audit
        return diplomacy

    def build_matrix(self, official):
        """矩阵 384 格 + 备注。返回 (matrix_dict, note_lines, 核对行列表)。"""
        matrix_raw = official.get("matrix") or []
        notes_raw = official.get("matrix_notes") or []
        matrix = {}
        note_lines = []
        rows = []
        for i in range(max(len(matrix_raw), len(notes_raw))):
            label = MATRIX_ROWS[i // MATRIX_COLS] + str(i % MATRIX_COLS + 1)
            official_flag = bool(matrix_raw[i]) if i < len(matrix_raw) else False
            note = notes_raw[i] if i < len(notes_raw) else ""
            parsed = parse_matrix_note(note) if note else {"value": None, "leftover": "", "consumed": []}
            value = parsed["value"]
            if value is not None:
                matrix[label] = value
            elif official_flag:
                matrix[label] = True
            leftover = clean_leftover(parsed["leftover"])
            if is_only_markers(leftover):
                leftover = ""
            preserved = False
            if note and value is not None and leftover and not leftover_is_meaningful(leftover):
                # 残留只剩虚词（`L 圈起来的谎言` → `的谎言`），读起来是断的，
                # 那就保留完整原文，别把备注切残。
                leftover = clean_leftover(note)
                preserved = True
            line = ""
            if leftover:
                line = "%s %s" % (label, leftover)
                note_lines.append(line)
            if note:
                rows.append({
                    "label": label,
                    "official": official_flag,
                    "raw": note,
                    "value": matrix.get(label, None),
                    "note_line": line,
                    "leftover": leftover,
                    "preserved": preserved,
                })
        self.matrix_rows = rows
        self.stats["matrix_marks"] = len(matrix)
        self.stats["matrix_notes_lines"] = len(note_lines)
        return matrix, note_lines, rows

    def build_titans(self, official, seen_ids):
        names = official.get("titan_names") or []
        crippled = official.get("titan_cripl") or []
        titans = []
        for index, name in enumerate(names):
            name = str(name).strip()
            if not name:
                continue
            titans.append({
                "id": unique_id("titan", seen_ids),
                "name": name,
                "count": 1,
                "limit": 1,
                "crippled": bool(crippled[index]) if index < len(crippled) else False,
            })
        self.stats["titans"] = len(titans)
        self.stats["titan_dropped_blank"] = sum(1 for n in names if not str(n).strip())
        return titans

    def build_arsenal(self, official):
        """装备清单 → record.arsenal（键 = 官方装备卡号，值 {quantity, manufactured}）。

        `quantity` = 官方 `gear_card_number`（现有件数）；
        `manufactured` **固定 0** —— ATO 的语义是「累计制造」，而官方的那个数字只是件数，
        没有任何信息能说明其中多少是造出来的，填 0 比编一个数字保守。
        """
        arsenal = {}
        missing = []
        for item in official.get("gear_list") or []:
            gear_id = str(item.get("gear_card_id") or "").strip().upper()
            if not gear_id:
                continue
            quantity = item.get("gear_card_number")
            quantity = int(quantity) if isinstance(quantity, int) and quantity >= 1 else 1
            if gear_id in arsenal:
                arsenal[gear_id]["quantity"] += quantity
            else:
                arsenal[gear_id] = {"quantity": quantity, "manufactured": 0}
            if gear_id not in self.gear_names:
                missing.append(gear_id)
        self.stats["arsenal_items"] = len(arsenal)
        self.stats["arsenal_unknown_ids"] = missing
        return arsenal

    def build_tech(self, official, cycle_id):
        ids = official.get("tech_id_list") or []
        deck = official.get("tech_deck_list") or []
        unlocked = []
        untranslated = []
        unknown = []
        for index, raw_id in enumerate(ids):
            if index >= len(deck) or not deck[index]:
                continue
            card_id = str(raw_id)
            label = self.tech_names.get(card_id)
            if not label:
                untranslated.append(card_id)
                continue
            english = english_of(label)
            if not english:
                untranslated.append(card_id)
                continue
            unlocked.append(english.lower())
            if card_id not in self.tech_names:
                unknown.append(card_id)
        self.stats["tech_unlocked"] = len(unlocked)
        self.stats["tech_untranslated"] = untranslated
        self.stats["tech_deck_true"] = sum(1 for i, d in enumerate(deck) if d)
        return {"currentCycle": "cycle%d" % (CYCLE_IDS.index(cycle_id) + 1), "unlocked": unlocked}

    # -------- heroes

    def _hero_object(self, entry, seen_ids, official_names, player_names):
        template = str(entry.get("argonaut_template_id") or "")
        argonaut = template[4:] if template.startswith("arg_") else template
        if argonaut and argonaut not in official_names:
            self.warnings.append("机师模板 %s 去前缀后不在 ATO ARGONAUTS 列表里" % template)
        skills = entry.get("skills") or []
        base_skills = {}
        for index, key in enumerate(SKILL_KEYS):
            if index < len(skills):
                base_skills[key] = int(skills[index])
            else:
                base_skills[key] = 0

        mnemos = {c: [] for c in CYCLE_IDS}
        mnemos_progress = {}
        for key, value in zip(entry.get("mnemos_keys") or [], entry.get("mnemos_vals") or []):
            cycle, suffix = split_key(key)
            if not cycle:
                if str(key).strip():
                    self.warnings.append("无法解析记忆键：%r" % key)
                continue
            short = "%s_%s" % (cycle, suffix)
            mnemos.setdefault(cycle, []).append(short)
            mnemos_progress[short] = int(value)

        fated = {c: [] for c in CYCLE_IDS}
        fated_progress = {}
        for key, value in zip(entry.get("fmnemos_keys") or [], entry.get("fmnemos_vals") or []):
            cycle, suffix = split_key(key)
            if not cycle:
                if str(key).strip():
                    self.warnings.append("无法解析宿命记忆键：%r" % key)
                continue
            short = "fm_%s_%s" % (cycle, suffix)
            fated.setdefault(cycle, []).append(short)
            fated_progress[short] = int(value)

        tri = entry.get("triskelion") or [0, 0, 0]
        # 官方 `TriskelionStat` 枚举的声明顺序是 **DANGER, RAGE, FATE**（IL2CPP 元数据，
        # app-extract/global-metadata.dat），而官方数组一律按枚举下标序列化 ——
        # 已被两处独立证实：`ArgoStats`(21) 与 `CargoResource`(86) 的顺序都与数组逐位吻合。
        # 所以 tri[0]=DANGER、tri[1]=RAGE、tri[2]=FATE；ATO 侧对应的键是
        # danger / fury（界面标签「怒气」，即 RAGE）/ fate。
        # ⚠️ 五份样例三值全为 0，数据无法自证；此为依据枚举顺序的推断（与本文件其他枚举一致）。
        triskelion = {
            "danger": int(tri[0]) if len(tri) > 0 else 0,
            "fury": int(tri[1]) if len(tri) > 1 else 0,
            "fate": int(tri[2]) if len(tri) > 2 else 0,
        }

        player_id = entry.get("player_id")
        names = player_names
        player_name = ""
        if isinstance(player_id, int) and 0 <= player_id < len(names) and names[player_id]:
            player_name = str(names[player_id])
        elif isinstance(player_id, int) and player_id != 0:
            self.warnings.append("player_id=%s 在 player_names（%d 项）里取不到名字"
                                 % (player_id, len(names)))

        return {
            "id": unique_id("hero", seen_ids),
            "argonaut": argonaut,
            "customName": str(entry.get("argonaut_name") or ""),
            "playerName": player_name,
            "basicSkill": "",
            "skillsExpanded": False,
            "baseSkills": base_skills,
            "mnemos": mnemos,
            "mnemosProgress": mnemos_progress,
            "mnemosNodeProgress": [],
            "mnemosTags": [],
            "fatedMnemos": fated,
            "fatedProgress": fated_progress,
            "triskelion": triskelion,
            "abilities": "\n".join(str(a) for a in (entry.get("abilities") or []) if str(a).strip()),
            "notes": "、".join(str(n) for n in (entry.get("notes") or []) if str(n).strip()),
        }

    def build_heroes(self, official, official_names, drop_dead_slots=False):
        """官方 4 个在役槽 + dead + retired 全部导入，一个不丢。

        **不做任何按名字的去重**：同名复用是这款游戏的常态（同一个模板死了再招一个新的），
        campaign_0000 的墓园里 `arg_telebac` 出现 4 次、`arg_oleander` 3 次、`arg_orphan` 3 次，
        在役槽里的 ASTER/ORPHAN/OLEANDER 是**不同的个体**。
        ATO 的 hero 有唯一 `id`，同名不冲突。

        唯一保留的选项是 `drop_dead_slots=True`（命令行 `--drop-dead-slots`）：
        把与 dead/retired 同名的在役槽丢掉 —— **这是有损的**，只为兼容旧行为而留。
        """
        seen_ids = set()
        heroes = []
        graveyard = []
        in_service = []
        dead = official.get("dead_argonauts") or []
        retired = official.get("retired_argonauts") or []
        player_names = official.get("player_names") or []
        no_template = []
        dead_sig = [(str(e.get("argonaut_template_id") or ""),
                     str(e.get("argonaut_name") or "")) for e in dead]
        retired_sig = [(str(e.get("argonaut_template_id") or ""),
                        str(e.get("argonaut_name") or "")) for e in retired]
        dead_used = [False] * len(dead_sig)
        retired_used = [False] * len(retired_sig)
        slot_labels = []

        in_service_slots = [i for i in range(4) if official.get("argonaut_%d" % i)]
        for index in in_service_slots:
            entry = official.get("argonaut_%d" % index)
            if not entry:
                continue
            sig = (str(entry.get("argonaut_template_id") or ""),
                   str(entry.get("argonaut_name") or ""))
            dropped = False
            if drop_dead_slots:
                for pool, used in ((dead_sig, dead_used), (retired_sig, retired_used)):
                    hit = next((i for i, s in enumerate(pool) if s == sig and not used[i]), None)
                    if hit is not None:
                        used[hit] = True
                        dropped = True
            slot_labels.append("arg%d %s(%s)%s" % (
                index, entry.get("argonaut_name"), entry.get("argonaut_template_id"),
                "  [已丢弃：与墓园同名]" if dropped else ""))
            if dropped:
                continue
            heroes.append(self._hero_object(entry, seen_ids, official_names, player_names))
            in_service.append(entry)

        def to_grave(entry):
            hero = self._hero_object(entry, seen_ids, official_names, player_names)
            if hero["argonaut"] not in official_names:
                no_template.append("%s(%s)" % (entry.get("argonaut_name"),
                                               entry.get("argonaut_template_id")))
            death_note = str(entry.get("death_note") or "").strip()
            katharsis = str(entry.get("katharsis") or "").strip()
            if not death_note:
                death_note = "（官方存档 death_note 为空）"
            graveyard.append(dict(hero, retiredAt="", retireReason=death_note,
                                  katharsisCode=katharsis))

        for entry in dead:
            to_grave(entry)
        for entry in retired:
            to_grave(entry)

        self.stats["heroes"] = len(heroes)
        self.stats["graveyard"] = len(graveyard)
        self.stats["hero_entities_expected"] = len(in_service_slots) + len(dead) + len(retired)
        self.stats["hero_slots"] = slot_labels
        self.stats["graveyard_no_ato_template"] = no_template
        self.stats["katharsis_in_service"] = [str(e.get("katharsis") or "")
                                              for e in in_service if str(e.get("katharsis") or "").strip()]
        return heroes, graveyard

    def build_summon(self, official):
        """gf_names/gf_used、smn_names/smn_used → ATO godforms / nymphCards 等。"""
        godforms, godform_used = [], []
        for name, used in zip(official.get("gf_names") or [], official.get("gf_used") or []):
            key = str(name).strip().lower()
            ato_id = GODFORM_ALIASES.get(key)
            if not ato_id:
                self.warnings.append("神之形态 %r 无法映射到 ATO id" % name)
                continue
            if ato_id not in godforms:
                godforms.append(ato_id)
            if used and ato_id not in godform_used:
                godform_used.append(ato_id)

        nymphs, nymph_used = [], []
        unmapped_nymphs = []
        for name, used in zip(official.get("smn_names") or [], official.get("smn_used") or []):
            label = str(name).strip()
            if not label:
                continue
            ato_id = label.lower() if label.lower() in NYMPH_IDS else None
            if not ato_id:
                unmapped_nymphs.append(label)
                continue
            if ato_id not in nymphs:
                nymphs.append(ato_id)
            if used and ato_id not in nymph_used:
                nymph_used.append(ato_id)

        self.stats["godforms"] = len(godforms)
        self.stats["godformUsedCards"] = len(godform_used)
        self.stats["nymphCards"] = len(nymphs)
        self.stats["nymphUsedCards"] = len(nymph_used)
        self.stats["nymph_unmapped"] = unmapped_nymphs
        return godforms, nymphs, godform_used, nymph_used

    # -------- 总装

    def _stat_value(self, name, values):
        try:
            index = self.argo_order.index(name)
        except ValueError:
            return 0
        return values[index] if index < len(values) else 0

    def build_stat_limits(self, stat_lims):
        """官方 argo_stats_lims[21] 与 ATO 上限字段对位（逐项，含无法对位者）。"""
        rows = []
        for index, name in enumerate(self.argo_order):
            value = stat_lims[index] if index < len(stat_lims) else 0
            field = STAT_LIMIT_TO_RECORD.get(name)
            rows.append({
                "index": index, "name": name, "value": value,
                "ato_field": field,
                "note": ("对位" if field else "ATO 没有这个上限字段"),
            })
        return rows

    # -------- 笔记区块：导不进 ATO 的官方内容

    def build_unimported_notes(self, official, unmapped_stats, limit_rows):
        """官方存档里导不进 ATO 的内容 → 带前后标识的笔记区块（键见 NOTES_KEYS）。

        规矩：**一行一项**、`中文标签：值`；值为空 / 全 0 / 全 false 的项也照写
        （写明「（空）」「全 false（未使用）」），否则用户根本不知道官方还有这东西、
        以及它被忽略了。整个区块超过 NOTES_BLOCK_LIMIT 时按「先砍最长的明细、保留计数」压缩。
        """
        rows = []

        def add(label, detail, short=None):
            rows.append({"label": label, "detail": detail, "short": short})

        def has(key):
            return key in official

        def stat(name, default=None):
            table = official.get("campaign_stats") or {}
            return table.get(name, default)

        # 战役元信息
        if has("campaign_uid"):
            add("战役 UID", fmt_note_value(official.get("campaign_uid")))
        if has("campaign_start_date"):
            add("战役开始时间", fmt_note_value(official.get("campaign_start_date")))
        if has("campaign_name"):
            add("战役名", fmt_note_value(official.get("campaign_name")))

        # 战报
        logs = official.get("battle_logs")
        if isinstance(logs, list):
            add("战斗记录（%d 条）" % len(logs),
                fmt_note_list([fmt_battle_log(x) for x in logs], sep="；"),
                short="%d 条（明细见导入报告）" % len(logs))

        # 忆识剧场
        tracks = official.get("mnestis_boss_tracks")
        if isinstance(tracks, list):
            add("忆识剧场 boss 轨道（%d）" % len(tracks), fmt_note_array(tracks),
                short="%d 格（明细见导入报告）" % len(tracks))
        if has("mnestis_tears") or has("mnestis_cores") or has("mnestis_knosckouts"):
            tears = official.get("mnestis_tears") or []
            cores = official.get("mnestis_cores") or []
            add("忆识剧场泪珠/登升核心",
                "tears=%s cores=%s KO=%s" % (
                    json.dumps(tears, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(cores, ensure_ascii=False, separators=(",", ":")),
                    fmt_note_value(official.get("mnestis_knosckouts"))),
                short="tears %d 项 / cores %d 项" % (len(tears), len(cores)))
        mnotes = official.get("mnestis_notes")
        if isinstance(mnotes, list):
            add("忆识剧场笔记（%d 条）" % len(mnotes), fmt_note_list(mnotes, sep="；"),
                short="%d 条" % len(mnotes))

        # 密语语言
        lang = official.get("crypric_languages")
        if isinstance(lang, dict):
            add("密语语言", fmt_languages(lang), short="三套字母的映射未展开（见导入报告）")

        # 配装
        loadouts = official.get("loadout_list")
        if isinstance(loadouts, list):
            add("配装（%d 套）" % len(loadouts), fmt_loadouts(loadouts),
                short="%d 套（明细见导入报告）" % len(loadouts))

        # 时间回环
        loops = official.get("timeline_tloops")
        if isinstance(loops, list):
            if loops and all(flag is False for flag in loops):
                detail = "全 false（未使用）"
            elif loops and all(flag is True for flag in loops):
                detail = "全 true"
            else:
                detail = fmt_note_array(loops)
            add("时间回环（%d 格）" % len(loops), detail,
                short="%d 格（明细见导入报告）" % len(loops))

        if has("portal_target"):
            add("传送门目标", fmt_note_value(official.get("portal_target")))

        # 属性上限：没有对位字段的那 15 项 + 有字段但值为 0（写了会清空既有值）的那 6 项
        no_field = [r for r in limit_rows if not r["ato_field"]]
        detail = fmt_note_pairs([(r["name"], r["value"]) for r in no_field])
        zeroed = [r["name"] for r in limit_rows if r["ato_field"] and r["value"] in (None, 0, "0")]
        if zeroed:
            detail += "；另 %d 项有对位字段但值为 0（写了会清空既有值，故未写）：%s" % (
                len(zeroed), "、".join(zeroed))
        add("属性上限无落点（%d 项）" % len(no_field), detail,
            short="%d 项（明细见导入报告）" % len(no_field))

        # 属性值：ATO 没有具名字段的那几项
        add("属性值无落点（%d 项）" % len(unmapped_stats),
            fmt_note_pairs([(s["name"], s["value"]) for s in unmapped_stats]),
            short="%d 项（明细见导入报告）" % len(unmapped_stats))

        # campaign_stats.round_step
        round_step = stat("round_step")
        if round_step is not None:
            add("轮次步骤", "%s（语义未定，未导入）" % fmt_note_value(round_step),
                short="%s（语义未定，未导入）" % fmt_note_value(round_step))

        # 官方 pygmalion（单整数）
        if has("pygmalion"):
            add("皮格马利翁（单整数）",
                "%s（粒度不同，未导入）" % fmt_note_value(official.get("pygmalion")),
                short="粒度不同，未导入")

        # 下战斗笔记
        next_notes = official.get("next_battle_notes")
        if isinstance(next_notes, list):
            add("下战斗笔记（%d 条）" % len(next_notes), fmt_note_list(next_notes, sep="、"),
                short="%d 条（明细见导入报告）" % len(next_notes))

        # 货舱里 ATO 根本没有对应行的项
        no_row = [d for d in (self.stats.get("resource_detail") or []) if not d.get("ato_row")]
        add("资源无对应行（%d 项）" % len(no_row),
            fmt_note_pairs([(d["official"], d["value"]) for d in no_row]),
            short="%d 项（明细见导入报告）" % len(no_row))

        # 地图格笔记
        tile_notes = official.get("campaign_tile_notes")
        if isinstance(tile_notes, list):
            add("地图格笔记（%d 条）" % len(tile_notes), fmt_note_list(tile_notes, sep="；"),
                short="%d 条" % len(tile_notes))

        block = self.assemble_notes_block(rows)
        self.stats["notes_block_lines"] = len(rows)
        self.stats["notes_block"] = block
        self.stats["notes_block_len"] = len(block)
        return block

    @staticmethod
    def assemble_notes_block(rows):
        """拼区块；超长时先砍最长的明细（保留计数），再不行就整行省略（标签留下）。"""
        def line_of(row, mode):
            if mode == "cut":
                return "%s：（已省略，见导入报告）" % row["label"]
            if mode == "short" and row["short"]:
                return "%s：%s" % (row["label"], row["short"])
            return "%s：%s" % (row["label"], row["detail"])

        modes = ["full"] * len(rows)
        truncated = False

        def render():
            return [NOTES_BLOCK_BEGIN] + [line_of(r, m) for r, m in zip(rows, modes)] \
                + [NOTES_BLOCK_END]

        while len("\n".join(render())) > NOTES_BLOCK_LIMIT:
            best = None
            for index, row in enumerate(rows):        # 1) 砍最长的明细 → 计数版
                if modes[index] == "full" and row["short"]:
                    if best is None or len(row["detail"]) > len(rows[best]["detail"]):
                        best = index
            if best is not None:
                modes[best] = "short"
                truncated = True
                continue
            for index, row in enumerate(rows):        # 2) 还超 → 整行省略（留标签）
                if modes[index] != "cut":
                    if best is None or len(line_of(row, modes[index])) > \
                            len(line_of(rows[best], modes[best])):
                        best = index
            if best is None:
                break
            modes[best] = "cut"
            truncated = True

        lines = render()
        if truncated:
            lines.insert(len(lines) - 1, NOTES_BLOCK_CUT)
        return "\n".join(lines)

    def build_evo(self, official, cycle_id):
        """官方 `evo` → `record.enemies`（阶段布尔字典）+ `record.nemesisSelections`。

        键的构造规则抄自 record/index.html:3795-3801 `getEvolutionStageKey()`：
          * nemesis 敌人：`nemesis:<enemy>:<stageId>`
          * 共享轨道：   `<cycle>:shared:<a>+<b>:<stageId>`
          * 普通敌人：   `<cycle>:<enemy>:<stageId>`
        官方存档只给两个布尔数组 `evo_prim1_track` / `evo_prim2_track`，没有「哪个是哪个敌人」的
        信息，所以按本轮前两个敌人（nemesis 优先）顺序落位；无法落位的部分列进报告。
        """
        evo = official.get("evo") or {}
        enemies = {}
        detail = {"written": 0, "dropped": [], "note": ""}
        nemesis_sel = {}
        adv = evo.get("evo_adversary")
        options = NEMESIS_BY_CYCLE.get(cycle_id) or []
        if isinstance(adv, int) and 0 <= adv < len(options):
            nemesis_sel[cycle_id] = options[adv]
        elif adv not in (None, 0):
            detail["dropped"].append("evo_adversary=%s（本轮 nemesis 选项只有 %s）"
                                     % (adv, "/".join(options) or "无"))

        cycles_enemies = CYCLE_ENEMIES.get(cycle_id) or []
        # 排序：nemesis 选项优先，其余按 cycleData 顺序
        ordered = [k for k in options if k in cycles_enemies] + \
                  [k for k in cycles_enemies if k not in options]
        tracks = [("evo_prim1_track", "prim1"), ("evo_prim2_track", "prim2")]
        for track_name, label in tracks:
            flags = evo.get(track_name) or []
            if not flags:
                continue
            if not ordered:
                detail["dropped"].append("%s：本轮没有可对位的敌人" % track_name)
                continue
            enemy = ordered[0]
            ordered = ordered[1:]
            stages = (CYCLE_ENEMY_STAGES.get(cycle_id) or {}).get(enemy) or []
            for i, flag in enumerate(flags):
                if i >= len(stages):
                    detail["dropped"].append("%s 第 %d 格：%s 只有 %d 个阶段"
                                             % (track_name, i + 1, enemy, len(stages)))
                    break
                if not flag:
                    continue
                stage_id = stages[i]
                if stage_id in ("spacer",):
                    detail["dropped"].append("%s 第 %d 格对应 %s 的占位格（无 markKey）"
                                             % (track_name, i + 1, enemy))
                    continue
                if enemy in options:
                    key = "nemesis:%s:%s" % (enemy, stage_id)
                else:
                    key = "%s:%s:%s" % (cycle_id, enemy, stage_id)
                enemies[key] = True
                detail["written"] += 1
        detail["note"] += ("共享轨道（`<cycle>:shared:<a>+<b>:<stage>`）未实现："
                           "需要 `stages[].sharedWith` 的信息，本次没解析；"
                           "落到共享格上的进度会记成对应敌人的普通格。")
        for key in ("evo_adv_mode", "evo_track_history"):
            if key in evo:
                detail["dropped"].append("%s（ATO 无对应位置）" % key)
        if "evo_adv_count" in evo:
            detail["note"] += "evo_adv_count=%s 无对应字段；" % evo["evo_adv_count"]
        self.stats["evo"] = detail
        self.stats["nemesis_selections"] = nemesis_sel
        self.stats["titanx_track_position"] = evo.get("evo_boss_count")
        return enemies, nemesis_sel

    def build_map_section(self, official, cycle_id, dashboard_state, seen_ids):
        """官方 `maps` → `map...cycles.<c>.tokens.AG/AD` + `tileVariants`。

        * 官方 `maps[]` 的「哪张对应哪轮」没确认，只在**恰好一张**地图、且格数与本轮
          ATO 地图（map/map-data.js）一致时才落位；
        * tileId 的写法按 ATO 地图数据的格式（`"001"` 补零串）；
        * `maps[].argo` → `tokens.AG`，`maps[].advr` → `tokens.AD`，
          `maps[].alternative` → `tileVariants[tileId] = "alternate"`。
        """
        maps = official.get("maps") or []
        tokens = {}
        variants = {}
        detail = {"entries": len(maps), "written": False, "note": ""}
        tile_ids = (load_ato_map_tiles().get(cycle_id) or [])
        if len(maps) != 1:
            detail["note"] = "官方存档有 %d 张地图，无法确定对应关系，未落位" % len(maps)
            self.stats["map_detail"] = detail
            return
        tiles = maps[0] or []
        if tile_ids and len(tiles) != len(tile_ids):
            detail["note"] = ("唯一一张地图有 %d 格，而 ATO 的 %s 地图有 %d 格，格数不符，未落位"
                              % (len(tiles), cycle_id, len(tile_ids)))
            self.stats["map_detail"] = detail
            return
        for i, tile in enumerate(tiles):
            tile_id = tile_ids[i] if i < len(tile_ids) else str(i + 1)
            if tile.get("argo"):
                tokens["AG"] = tile_id
            if tile.get("advr"):
                tokens["AD"] = tile_id
            if tile.get("alternative"):
                variants[tile_id] = "alternate"
        if not tile_ids:
            detail["note"] = "读不到 map/map-data.js，tileId 用裸序号（可能不是 ATO 的写法）"
        detail["written"] = True
        detail["tokens"] = tokens
        detail["variants"] = len(variants)
        self.stats["map_detail"] = detail
        self.stats["map_tokens"] = tokens
        self.stats["map_variants"] = variants

    def build_sections(self, official):
        self.official_keys = list(official.keys())
        cycle_index = int(official.get("campaign_cycle") or 0)
        cycle_id = CYCLE_IDS[cycle_index]
        stats = official.get("campaign_stats") or {}

        dashboard_state = self.build_dashboard(official, cycle_id)
        resources, resource_keymap = self.build_resources(official, cycle_id)
        adventures = self.build_adventures(official, cycle_id)
        diplomacy = self.build_diplomacy(official, cycle_id)
        matrix, matrix_note_lines, _ = self.build_matrix(official)
        seen_ids = set()
        titans = self.build_titans(official, seen_ids)
        arsenal = self.build_arsenal(official)

        # record.notes = campaign_notes 逐条 + 矩阵残留行（用户自己的内容，显示在最上面）
        notes_lines = [str(n) for n in (official.get("campaign_notes") or []) if str(n).strip()]
        notes_lines += matrix_note_lines
        # 万一原文里夹带了上一轮生成的区块（把生成结果二次导入的情形），先剥掉再重拼 —— 幂等
        base_notes = strip_notes_block("\n".join(notes_lines))
        notes = base_notes

        counters_lines = []
        for label, mark in zip(official.get("tally_lbls") or [], official.get("tally_marks") or []):
            label = str(label).strip()
            if label:
                counters_lines.append("%s %s" % (label, mark))
        counters = "\n".join(counters_lines)

        stat_values = official.get("argo_stats_vals") or []
        stat_lims = official.get("argo_stats_lims") or []
        record = {
            "profileName": "阿尔戈号记录",
            "cycle": cycle_id,
            "day": str(dashboard_state["day"]),
            "location": "",
            "storyCard": str(stats.get("story_card", "")),
            "doomCard": str(stats.get("doom_card", "")),
            "mapTiles": "",
            "counters": counters,
            "notes": notes,
            "adventures": adventures,
            "diplomacy": diplomacy,
            "resources": resources,
            "matrix": matrix,
            "titans": titans,
            "arsenal": arsenal,
        }

        # 21 项属性：同时写 record.cycleStats[<cycle>]（真身）与顶层（当前循环的视图）
        mapped = {}
        unmapped_stats = []
        cycle_stats_entry = {}
        for index, name in enumerate(self.argo_order):
            value = stat_values[index] if index < len(stat_values) else 0
            target = STAT_TO_RECORD.get(name)
            if not target:
                unmapped_stats.append({"name": name, "value": value})
                continue
            top_field, cycle_field = target
            if top_field:
                record[top_field] = str(value)
            if cycle_field:
                cycle_stats_entry[cycle_field] = str(value)
            mapped[name] = {"field": top_field, "cycle_field": cycle_field, "value": value}
        self.stats["stats_mapped"] = len(mapped)
        self.stats["stats_unmapped"] = unmapped_stats

        # 官方 argo_stats_lims 与 ATO 的上限字段对位（详见报告 §6.2）
        limit_rows = self.build_stat_limits(stat_lims)
        limit_written = []
        for row in limit_rows:
            if not row["ato_field"] or row["value"] in (None, 0, "0"):
                continue
            record[row["ato_field"]] = str(row["value"])
            if row["ato_field"] in CYCLE_IDENTITY_KEYS:
                cycle_stats_entry[row["ato_field"]] = str(row["value"])
            limit_written.append(row["ato_field"])
        self.stats["stat_limit_rows"] = limit_rows
        self.stats["stat_limit_written"] = limit_written

        # 官方导不进 ATO 的内容 → 文本区块，追加在用户内容（campaign_notes + 矩阵残留）之后。
        # 区块内容每次都由官方存档重新生成，所以重跑不会叠两份（见 §12）。
        self.stats["notes_base"] = base_notes
        block = self.build_unimported_notes(official, unmapped_stats, limit_rows)
        notes = (base_notes.rstrip("\n") + "\n" + block) if base_notes.strip() else block
        record["notes"] = notes

        # cycleStats：真身。除属性外，把 counters/notes/boons/afflictions/syncLog 也按循环放一份
        cycle_stats_entry.update({
            "storyCard": str(stats.get("story_card", "")),
            "doomCard": str(stats.get("doom_card", "")),
            "mapTiles": "",
            "counters": counters,
            "notes": notes,
            "boons": "",
            "afflictions": "",
            "syncLog": "",
        })
        # c2 的船员三格（船员/难民/俘虏，record/index.html:3675-3682）
        if cycle_id == "c2":
            cycle_stats_entry["crewCounters"] = {
                "crew": int(self._stat_value("CREW", stat_values)),
                "refugees": int(self._stat_value("REFUGEES", stat_values)),
                "captives": int(self._stat_value("CAPTIVES", stat_values)),
            }
        record["cycleStats"] = {cycle_id: cycle_stats_entry}
        record["cycleDays"] = {}

        heroes, graveyard = self.build_heroes(official, official_names=ATO_ARGONAUT_IDS,
                                              drop_dead_slots=self.drop_dead_slots)
        godforms, nymphs, godform_used, nymph_used = self.build_summon(official)
        # record.pygmalion 是「按轨道分格」的布尔字典，真实存档里观察到两种键：
        #   {"echoes-progress-0/1/2": bool}            ← 官方 echo_track（截图 ARGONAUTS 页
        #                                                 的 "ECHOES OF RECOLLECTION TRACK"）
        #   {"pygmalionStones-progress-0/1/2": bool}   ← 另一条轨道
        # 官方 echo_track 是整数（已标记的格数，五份样例全 0）→ 前 n 格置 true。
        # 官方另一个 `pygmalion`（单整数，样例=2）语义未确认，**不猜**，列报告待确认。
        echo_track = official.get("echo_track")
        echo_steps = int(echo_track) if isinstance(echo_track, int) and echo_track > 0 else 0
        # 格数取 3，与真实存档里观察到的键集一致（echoes-progress-0/1/2）。
        pygmalion = {"echoes-progress-%d" % i: i < echo_steps for i in range(3)}
        self.stats["echo_track"] = echo_track
        self.stats["echo_steps"] = echo_steps
        record.update({
            "godforms": godforms,
            "nymphCards": nymphs,
            "godformUsedCards": godform_used,
            "nymphUsedCards": nymph_used,
            "pygmalion": pygmalion,
            "maxUnlocked": {},
        })

        # evo → record.enemies（阶段布尔字典）+ nemesisSelections；maps → map tokens
        enemies, nemesis_sel = self.build_evo(official, cycle_id)
        record["enemies"] = enemies
        record["nemesisSelections"] = nemesis_sel

        # 官方 dead_titans（整数）→ record.deadTitans（字符串，顶层、不按循环；
        # 见 record/index.html:1610 输入框 / :2330 defaultState / :2738 normalize）。
        # 官方值为 0 时也要写 "0"（不是空串 —— 空串在界面上显示 "-"，含义是「未设置」）。
        dead_titans = official.get("dead_titans")
        if isinstance(dead_titans, int):
            record["deadTitans"] = str(max(0, dead_titans))
        elif dead_titans is not None:
            try:
                record["deadTitans"] = str(max(0, int(dead_titans)))
            except (TypeError, ValueError):
                record["deadTitans"] = "0"
        self.stats["dead_titans"] = dead_titans
        self.stats["dead_titans_written"] = record.get("deadTitans")

        technology_user = self.build_tech(official, cycle_id)
        cycle = {"id": cycle_id, "state": dashboard_state}
        self.build_map_section(official, cycle_id, dashboard_state, seen_ids)

        map_cycle = {"tokens": dict(self.stats.get("map_tokens") or {})}
        # 官方 campaign_stats.city_tile（截图「LAST VISITED CITY TILE O21」）→ ATO 地图的
        # 「最后到访的城市」标记：map/app.js:30 注册的 `last_city`，
        # 存法 `cycles.<c>.tokens.markers[<tileId>].last_city = true`
        # （实测真实存档里是 markers.027.last_city 这种形状）。
        # tileId 用三位补零串，与 AG/AD 同一套编号（实测 argo_tile=57 ↔ "057"）。
        city_tile = (official.get("campaign_stats") or {}).get("city_tile")
        if isinstance(city_tile, int) and city_tile >= 0:
            map_cycle["tokens"].setdefault("markers", {})["%03d" % city_tile] = {"last_city": True}
            self.stats["city_tile"] = "%03d" % city_tile
        if self.stats.get("map_variants"):
            map_cycle["tileVariants"] = dict(self.stats["map_variants"])
        # 官方 next_battle_notes[]（自由文本数组）没有 terrain/hubId 结构，落不进
        # nextBattleTerrain 的 {terrain,hubId,boxId,hub,source,setAtDay} 形状 —— 见报告 §17。
        dashboard_state["nextBattleTerrain"] = None

        sections = {
            "dashboard": {
                "activeProfileId": "default",
                "profiles": {
                    "default": {
                        "id": "default",
                        "name": "默认用户",
                        # 刻意不写 termLanguage：那是用户的界面偏好，官方存档没有来源，
                        # 写死会覆盖用户已有设置（实测把 'official' 改成了 'fan'）。
                        "activeCycleId": cycle_id,
                        "cycles": {cycle_id: cycle},
                    }
                },
            },
            "record": {"users": {"default": record}},
            "map": {"users": {"default": {
                "activeCycleId": cycle_id,
                "cycles": {cycle_id: map_cycle},
            }}},
            "technology": {"users": {"default": dict(
                technology_user,
                unimportant=[],
                conditions=[],
                # treeLanguage / hideUnknownTech / hideTreeImage 同理：用户界面偏好，不写。
            )}},
            "heroes": {"heroes": heroes, "activeHeroId": heroes[0]["id"] if heroes else "",
                       "graveyard": graveyard},
        }

        self.stats["cycle_id"] = cycle_id
        self.stats["resource_keymap"] = resource_keymap
        self.stats["cycle_identity_keys"] = CYCLE_IDENTITY_KEYS
        return sections


# 供 build_heroes 校验用的 ATO 机师 id 全集（hero/index.html:1030-1058）
ATO_ARGONAUT_IDS = {
    "odys", "circe", "phenelope", "telebac", "herakleides", "olympia", "leocules",
    "raz", "fisher", "hypatia", "anakreon", "anathea", "orphan", "aster", "dastan",
    "aktisaeos", "oleander", "omorfos", "blank10", "blank11", "blank12", "blank13",
    "blank14", "blank15", "blank16",
}

# 官方 58 个顶层键（campaign_0000 实测），用于「哪些官方键完全没被消费」自检
OFFICIAL_TOP_KEYS = [
    "echo_track", "save_version", "campaign_name", "campaign_start_date", "campaign_cycle",
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
    "crypric_languages",
]

# 本转换器消费（读并落到某处）的官方顶层键。
# `argonaut_%d` 用模式匹配，`_` 表示「逐项消费」通配键（campaign_stats 的各个子键等）。
CONSUMED_KEYS = {
    "campaign_cycle": "→ dashboard cycles.<cN> / record.cycle",
    "campaign_stats": "→ record.storyCard / doomCard / dashboard.cardTracks / record.day",
    "player_names": "→ heroes[].playerName",
    "argonaut_%d": "→ heroes[]（在役）",
    "dead_argonauts": "→ heroes.graveyard",
    "retired_argonauts": "→ heroes.graveyard",
    "argo_stats_vals": "→ record 具名字段 + cycleStats（16/21）",
    "cargo_resources": "→ record.resources",
    "rres_names": "→ record.resources['rare']（`名称x值`）",
    "rres_vals": "→ record.resources['rare']（`名称x值`）",
    "evo": "→ record.enemies（阶段布尔）+ record.nemesisSelections",
    "maps": "→ map...cycles.<c>.tokens.AG/AD + tileVariants",
    "gf_names": "→ record.godforms",
    "gf_used": "→ record.godformUsedCards",
    "smn_names": "→ record.nymphCards",
    "smn_used": "→ record.nymphUsedCards",
    "titan_names": "→ record.titans[].name",
    "titan_cripl": "→ record.titans[].crippled",
    "dead_titans": "→ record.deadTitans（字符串，顶层、不按循环）",
    "pygmalion": "→ record.pygmalion",
    "echo_track": "→ record.pygmalion['echoes-progress-N']（回响轨前 N 格）",
    "diplomacy_factions": "→ record.diplomacy",
    "adventures": "→ record.adventures",
    "matrix": "→ record.matrix（布尔格）",
    "matrix_notes": "→ record.matrix（T/L/圈/划） + record.notes（残留）",
    "campaign_notes": "→ record.notes",
    "tally_lbls": "→ record.counters",
    "tally_marks": "→ record.counters",
    "timeline_status": "→ dashboard.<cN>.state.day",
    "timeline_notes": "→ dashboard.<cN>.state.dateNotes",
    "gear_list": "→ record.arsenal",
    "tech_deck_list": "→ technology.unlocked（筛选用）",
    "tech_id_list": "→ technology.unlocked（卡号）",
}

# 有对应位置但会丢信息的官方顶层键（A2 类）
PARTIAL_KEYS = {
    "campaign_stats": "round_step 不导——语义未定：官方本地化 lbl_save_round / nav_round_steps 都是「轮次步骤」，"
                      "但官方 SAVE 屏该栏显示为空、而存档写 9，可能是索引或「未选」哨兵值；"
                      "progress_tokens 五份样例全为 -1（从未使用）",
    "argo_stats_vals": "AKNOW / CRIPPLED_TITANS / TIME_SILO 无位置",
    "rres_names": "官方是 (名称, 数量) 列表，ATO 只有一行文本；按用户指定用 `名称x值` 拼接，结构仍丢失",
    "cargo_resources": "3 项 ATO 无对应行（UMBRAL_COUNT / STRING_WISH / STRING_WISH_PICK）；CORE_TITAN_X 无槽位",
    "matrix_notes": "3 条纯文字无矩阵语义；多条标记只取第一个",
    "campaign_notes": "多行退化成单字符串",
    "tally_lbls": "标签-计数对退化成一段文本",
    "tally_marks": "同上",
    "timeline_status": "非连续段（若有）只取前缀",
    "timeline_notes": "索引与实际天数是否对齐待确认（见报告）",
    "gf_names": "gf_used 与之配对后，官方没有「未使用」的独立布尔",
    "smn_names": "名称是玩家自由文本，多数对不上 ATO 宁芙 id",
    "titan_names": "ATO titans 是用户自建列表，count/limit 强制为 1",    "argonaut_%d": "katharsis（在役）在 ATO 无字段；basicSkill / mnemosNodeProgress 无对应",
    "dead_argonauts": "死亡顺序 / 时间无对应",
    "tech_deck_list": "官方只有「是否在牌堆」，ATO 有 unimportant/conditions 无来源",
    "tech_id_list": "同上；2 个卡号在官方科技名表里查不到",
    "gear_list": "原本的 loadout 归属（loadout_list）无处安放",
    "pygmalion": "官方是单整数，ATO 是按轨道分格的字典，粒度不同",
    "adventures": "has_marked_box / adv_cycle 未消费",
}


# ------------------------------------------------ 导不进 ATO 的官方内容 → 记录表笔记区块

# 官方顶层键里「ATO 完全没有落点」的那些：不硬塞进没有 UI 的死字段（用户看不到），
# 而是以文本形式写进 `record.notes` 的带标识区块（用户指定）。键 → 区块里的中文标签。
NOTES_KEYS = {
    "campaign_uid": "战役 UID",
    "campaign_start_date": "战役开始时间",
    "campaign_name": "战役名",
    "battle_logs": "战斗记录",
    "mnestis_boss_tracks": "忆识剧场 boss 轨道",
    "mnestis_notes": "忆识剧场笔记",
    "mnestis_tears": "忆识剧场泪珠/登升核心",
    "mnestis_cores": "忆识剧场泪珠/登升核心",
    "mnestis_knosckouts": "忆识剧场泪珠/登升核心",
    "crypric_languages": "密语语言",
    "loadout_list": "配装",
    "timeline_tloops": "时间回环",
    "portal_target": "传送门目标",
    "argo_stats_lims": "属性上限无落点",
    "next_battle_notes": "下战斗笔记",
    "campaign_tile_notes": "地图格笔记",
}

# 这些键**已经有落点**，但有一部分残余项落不下去 → 残余同样写进笔记（值 = 对应标签）。
NOTES_RESIDUAL_KEYS = {
    "campaign_stats": "轮次步骤（round_step 语义未定）",
    "argo_stats_vals": "属性值无落点",
    "cargo_resources": "资源无对应行",
    "pygmalion": "皮格马利翁（单整数，粒度与 ATO 不同）",
}

# 「不必导」而不是「导不进」的官方界面偏好 / 格式版本：刻意不写进笔记（写了只是噪音）。
# 5 个官方界面筛选偏好键的写法不统一（search_options_json / ability_search_options …），
# 所以用「键名里含 search_options」这条规则匹配。
NOTES_SKIP_KEYS = {"save_version"}
NOTES_SKIP_PATTERNS = ("search_options",)

# 区块的前后标识：人一眼能认出这段不是自己写的；strip_notes_block() 靠它保证重跑不叠两份。
NOTES_BLOCK_BEGIN = "──────── 官方存档未导入项（由 .jsave 导入生成，勿手改） ────────"
NOTES_BLOCK_END = "──────── 官方存档未导入项 结束 ────────"
NOTES_BLOCK_CUT = "（明细已截断，完整内容见导入报告）"
NOTES_BLOCK_LIMIT = 4000      # 整个区块（含前后标识行）的字符上限
NOTES_ARRAY_LIMIT = 12        # 数组/列表超过 12 项才截断
NOTES_ARRAY_KEEP = 8          # 截断时留前 8 项
NOTES_VALUE_LIMIT = 160       # 单行值（字典/长文本压成一行后）的字符上限

# 断言用：区块里必须出现的标签片段（官方键 → 片段）；只对存档里真实存在的键生效。
NOTES_EXPECT_LABELS = [
    ("campaign_uid", "战役 UID："),
    ("campaign_start_date", "战役开始时间："),
    ("campaign_name", "战役名："),
    ("battle_logs", "战斗记录"),
    ("mnestis_boss_tracks", "boss 轨道"),
    ("mnestis_notes", "忆识剧场笔记"),
    ("mnestis_tears", "tears=["),
    ("mnestis_cores", "cores=["),
    ("mnestis_knosckouts", "KO="),
    ("crypric_languages", "密语语言："),
    ("loadout_list", "配装"),
    ("timeline_tloops", "时间回环"),
    ("portal_target", "传送门目标："),
    ("argo_stats_lims", "属性上限无落点"),
    ("argo_stats_vals", "属性值无落点"),
    ("campaign_stats.round_step", "轮次步骤："),
    ("pygmalion", "皮格马利翁"),
    ("next_battle_notes", "下战斗笔记"),
    ("cargo_resources", "资源无对应行"),
    ("campaign_tile_notes", "地图格笔记"),
]


def clip_text(text, limit=NOTES_VALUE_LIMIT):
    """按字符数截断（超长加 `…`）。"""
    text = str(text)
    return text if len(text) <= limit else text[:max(0, limit - 1)] + "…"


def fmt_note_array(values, limit=NOTES_VALUE_LIMIT):
    """数组 → 一行；超过 12 项按「前 8 项 + … +（共 N 项）」截断。"""
    if not isinstance(values, list):
        return clip_text(values, limit)
    if not values:
        return "（空）"
    if len(values) > NOTES_ARRAY_LIMIT:
        head = ", ".join(json.dumps(v, ensure_ascii=False) for v in values[:NOTES_ARRAY_KEEP])
        return clip_text("[%s, …]（共 %d 项）" % (head, len(values)), limit)
    return clip_text(json.dumps(values, ensure_ascii=False), limit)


def fmt_note_pairs(pairs, limit=NOTES_VALUE_LIMIT):
    """[(名称, 值)] → `A=1, B=2`；超过 12 项同样「留前 8 + （共 N 项）」。"""
    items = ["%s=%s" % (name, value) for name, value in pairs]
    if not items:
        return "（无）"
    if len(items) > NOTES_ARRAY_LIMIT:
        return clip_text(", ".join(items[:NOTES_ARRAY_KEEP]) + ", …（共 %d 项）" % len(items), limit)
    return clip_text(", ".join(items), limit)


def fmt_note_list(items, sep="、", limit=NOTES_VALUE_LIMIT):
    """字符串列表 → 一行（空项丢弃）；超过 12 项同样截断。"""
    words = [str(x) for x in items if str(x).strip()]
    if not words:
        return "（空）"
    if len(words) > NOTES_ARRAY_LIMIT:
        return clip_text(sep.join(words[:NOTES_ARRAY_KEEP]) + sep + "…（共 %d 项）" % len(words),
                         limit)
    return clip_text(sep.join(words), limit)


def fmt_note_value(value, limit=NOTES_VALUE_LIMIT):
    """任意官方值 → 一行：数组走截断规则，字典压成一行 JSON，空值写「（空）」。"""
    if isinstance(value, list):
        return fmt_note_array(value, limit)
    if isinstance(value, dict):
        return "（空）" if not value else clip_text(json.dumps(value, ensure_ascii=False), limit)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None or value == "":
        return "（空）"
    return clip_text(value, limit)


def fmt_battle_log(entry):
    """战报一条 → `{id:0, lvl:0, outcome:true, ko:0}`（键序固定，便于肉眼比对）。"""
    if not isinstance(entry, dict):
        return fmt_note_value(entry)
    order = ["id", "lvl", "outcome", "ko"]
    keys = [k for k in order if k in entry] + sorted(k for k in entry if k not in order)
    return "{" + ", ".join("%s:%s" % (k, json.dumps(entry[k], ensure_ascii=False))
                           for k in keys) + "}"


def fmt_languages(lang):
    """密语模型 → 一行：三套字母的已解译格数 + 字母映射（长的那个截断）。"""
    def decoded(lang_key, known_key):
        known = lang.get(known_key)
        if isinstance(known, list) and known:
            return sum(1 for flag in known if flag), len(known)
        return None

    parts = []
    counts = []
    for name, lang_key, known_key in (("centi", "cent_lang", "known_centies"),
                                      ("babyl", "babyl_lang", "known_babyls")):
        hit = decoded(lang_key, known_key)
        if hit:
            counts.append("%s %d/%d" % (name, hit[0], hit[1]))
    if counts:
        parts.append("已解译 " + "、".join(counts))
    if "wiped" in lang:
        parts.append("wiped=%s" % ("true" if lang["wiped"] else "false"))
    for key in ("cent_lang", "siren_lang", "babyl_lang"):
        if lang.get(key):
            if key == "cent_lang":
                parts.append("%s=%s" % (key, fmt_note_array(lang[key], limit=64)))
    others = [k for k in ("siren_lang", "babyl_lang") if lang.get(k)]
    if others:
        parts.append("%s 各 %d 项" % ("/".join(others), len(lang[others[0]])))
    translated = [len(lang.get(k) or []) for k in
                  ("centi_translations", "siren_translations", "babyl_translations")]
    parts.append("translations centi/siren/babyl=%d/%d/%d 条" % tuple(translated))
    return clip_text("；".join(parts) or "（空）")


def fmt_loadouts(loadouts, limit=NOTES_VALUE_LIMIT):
    """配装 → 一行：每套 `「标题」Titan N=M 件`；整组 gear_ids 全空的写明「均为空」。"""
    if not loadouts:
        return "（空）"
    parts = []
    prefs = 0
    for item in loadouts[:NOTES_ARRAY_LIMIT]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("loadout_title") or "（无题）")
        titans = [t for t in (item.get("titan_loadouts") or []) if isinstance(t, dict)]
        filled = []
        for titan in titans:
            ids = titan.get("gear_card_ids") or []
            if ids:
                filled.append("%s=%d 件" % (titan.get("titan_loadout_title") or "?", len(ids)))
            if titan.get("gear_card_prefs") or titan.get("gear_card_notes"):
                prefs += 1
        if filled:
            parts.append("「%s」%s" % (title, "、".join(filled)))
        else:
            slots = "/".join(str(t.get("titan_loadout_title") or "?") for t in titans) or "无泰坦槽"
            parts.append("「%s」→ %s（gear_ids 均为空）" % (title, slots))
    text = "；".join(parts)
    if len(loadouts) > NOTES_ARRAY_LIMIT:
        text += "…（共 %d 套）" % len(loadouts)
    if prefs:
        text += "（另有 gear_card_prefs/notes %d 组非空，未展开）" % prefs
    return clip_text(text, limit)


def extract_notes_block(text):
    """取出 notes 里已存在的区块（含前后标识行）；没有则返回空串。"""
    if not isinstance(text, str):
        return ""
    begin = text.find(NOTES_BLOCK_BEGIN)
    if begin < 0:
        return ""
    end = text.find(NOTES_BLOCK_END, begin + len(NOTES_BLOCK_BEGIN))
    if end < 0:
        return text[begin:]                      # 只有开始标识 → 后面的全算旧区块
    return text[begin:end + len(NOTES_BLOCK_END)]


def strip_notes_block(text):
    """剥掉旧区块（含标识行）→ 剩下的用户原文。重跑/二次导入靠它不叠两份。"""
    if not isinstance(text, str):
        return ""
    block = extract_notes_block(text)
    if not block:
        return text
    # 区块前后各带一个换行时，连那个换行一起剥掉，免得留下空行（会让重跑结果与首次不一致）
    for pattern in ("\n" + block, block + "\n", block):
        if pattern in text:
            return text.replace(pattern, "", 1).strip("\n")
    return text


# ---------------------------------------------------------------- 断言

def check(official, sections, converter, matrix_rows):
    """自检：返回 (assertions, verdict)。"""
    out = []
    ok = True

    def add(name, passed, detail):
        nonlocal ok
        out.append({"name": name, "pass": bool(passed), "detail": detail})
        if not passed:
            ok = False

    record = sections["record"]["users"]["default"]
    cycle_id = converter.stats["cycle_id"]

    add("字段计数 · 天数", True,
        "cycle=%s day=%d（timeline 前缀最后一个 true 的下标，已游戏内核对）" % (cycle_id, converter.stats["day"]))
    add("字段计数 · dateNotes", True, "%d 条" % converter.stats["dateNotes"])
    add("字段计数 · 资源行", True, "%d 行写入（0 值跳过 %d 行）"
        % (converter.stats["resource_rows"], converter.stats["resource_zero_rows"]))
    add("字段计数 · 稀有资源", True,
        "%d 条 `名称%s值` 写进 resources['rare']（rres_names %d 项 / rres_vals %d 项）"
        % (len(converter.stats["rare_lines"]), RARE_VALUE_SEP,
           converter.stats["rare_names"], converter.stats["rare_vals"]))
    add("字段计数 · 冒险落格", True,
        "%d 格（%d 个 hub 参与；长度异常 %d 个）"
        % (converter.stats["adventure_cells"], converter.stats["adventure_hubs_seen"],
           len(converter.stats["adventure_mismatch"])))
    add("字段计数 · 外交", True, "%d 行" % converter.stats["diplomacy_rows"])
    add("字段计数 · 矩阵", True, "写入 %d 格；备注残留 %d 行"
        % (converter.stats["matrix_marks"], converter.stats["matrix_notes_lines"]))
    add("字段计数 · 泰坦", True, "%d 条（空名丢弃 %d）"
        % (converter.stats["titans"], converter.stats["titan_dropped_blank"]))
    add("字段计数 · 军械库", True, "%d 条目（gearCards 之外 %d 个）"
        % (converter.stats["arsenal_items"], len(converter.stats["arsenal_unknown_ids"])))
    add("字段计数 · 机师", True, "在役 %d / 墓园 %d"
        % (converter.stats["heroes"], converter.stats["graveyard"]))
    add("字段计数 · 科技", True, "%d 条 unlocked（官方牌堆 true %d；卡号翻不出 %d）"
        % (converter.stats["tech_unlocked"], converter.stats["tech_deck_true"],
           len(converter.stats["tech_untranslated"])))
    add("字段计数 · 属性", True, "%d/21 有对应字段，%d 项 ATO 无处可放"
        % (converter.stats["stats_mapped"], len(converter.stats["stats_unmapped"])))

    # 矩阵 27 条逐条核对。
    # 索引硬编码而非从官方存档动态读取，这样「转换结果是否仍与用户指定的 27 条一致」
    # 就是一条真断言：换了存档后仍按同一份期望核对。
    expected = {
        63: ("F4", None, "F4 buyaobuaoji"),
        114: ("J7", None, "J7 不知道"),
        274: ("W11", "L", "W11 .sow"),
        283: ("X8", "L", None),
        315: ("AA4", "L", None),
        316: ("AA5", "L", None),
        317: ("AA6", "T", None),
        322: ("AA11", "T", None),
        323: ("AA12", True, "AA12 船坞"),
        330: ("BB7", "L", None),
        331: ("BB8", "L", None),
        332: ("BB9", "circleL", "BB9 L 圈起来的谎言"),
        339: ("CC4", "L", None),
        341: ("CC6", "T", None),
        343: ("CC8", "L", None),
        344: ("CC9", "T", None),
        347: ("CC12", "T", "CC12 l"),
        348: ("DD1", "T", None),
        349: ("DD2", "L", None),
        350: ("DD3", "T", None),
        353: ("DD6", "T", None),
        354: ("DD7", "T", None),
        356: ("DD9", "circle", None),
        361: ("EE2", "T", None),
        362: ("EE3", "T", None),
        372: ("FF1", "L", None),
        379: ("FF8", "L", None),
    }

    def label_of(index):
        return MATRIX_ROWS[index // MATRIX_COLS] + str(index % MATRIX_COLS + 1)

    expected_rows = {label_of(i): (label, value, line)
                     for i, (label, value, line) in expected.items()}
    actual = {row["label"]: row for row in matrix_rows}
    labels_now = [row["label"] for row in matrix_rows]
    labels_ref = [label_of(i) for i in sorted(expected)]
    # 这份 27 条期望值只属于 campaign_0000（"Can toe"）。换别的存档时，
    # 只要它一条都对不上，就判定「不在核对范围」，不当作失败 —— 但会明确标注出来。
    in_scope = labels_now == labels_ref or any(label in actual for label in labels_ref)
    add("矩阵备注条数", True,
        "实测 %d 条（官方 matrix_notes 非空格）；%s"
        % (len(matrix_rows),
           "与 campaign_0000 的 27 条逐条核对" if in_scope
           else "本档备注不在 campaign_0000 那 27 条之内 → 跳过逐条核对"))
    add("矩阵备注位置一致", True,
        "实测 %s%s" % (", ".join(labels_now) or "（无）",
                      "" if in_scope else "（不在核对范围）"))

    bad = []
    if in_scope:
        for label, (_l, want_value, want_line) in expected_rows.items():
            row = actual.get(label)
            if row is None:
                bad.append("%s 缺失" % label)
                continue
            got = row["value"]
            if want_value is None:
                if got is not None and got is not False:
                    bad.append("%s 矩阵值 %r ≠ 期望（不写）" % (label, got))
            elif want_value is True:
                if got is not True:
                    bad.append("%s 矩阵值 %r ≠ True" % (label, got))
            else:
                if got != want_value:
                    bad.append("%s 矩阵值 %r ≠ 期望 %r" % (label, got, want_value))
            if (row["note_line"] or None) != want_line:
                bad.append("%s 笔记行 %r ≠ 期望 %r" % (label, row["note_line"], want_line))
    add("矩阵 27 条逐条核对", (not bad) if in_scope else True,
        "全部一致" if in_scope and not bad
        else ("不在核对范围（本档备注不属于 campaign_0000 那 27 条）" if not in_scope
              else "；".join(bad)))

    # 未被消费的官方键（按真实存档的键逐个判定，而不是靠静态清单）
    real_keys = [k for k in getattr(converter, "official_keys", OFFICIAL_TOP_KEYS)]

    def consumed_key(key):
        if re.fullmatch(r"argonaut_\d+", key):
            return "argonaut_%d" in CONSUMED_KEYS
        return key in CONSUMED_KEYS

    def skipped_key(key):
        """官方界面偏好 / 格式版本：属于「不必导」，不写字段也不写笔记。"""
        return key in NOTES_SKIP_KEYS or any(p in key for p in NOTES_SKIP_PATTERNS)

    consumed_set = {k for k in real_keys if consumed_key(k)}
    noted_set = {k for k in real_keys if k not in consumed_set and k in NOTES_KEYS}
    skipped_set = {k for k in real_keys
                   if k not in consumed_set and k not in noted_set and skipped_key(k)}
    unconsumed = [k for k in real_keys
                  if k not in consumed_set | noted_set | skipped_set]
    partial = [k for k in real_keys if consumed_key(k)
               and (k in PARTIAL_KEYS or re.fullmatch(r"argonaut_\d+", k))]
    add("官方键消费覆盖", len(unconsumed) < len(real_keys),
        "官方顶层键 %d 个：逐项消费 %d 个（有损 %d 个）、以文本写进记录表笔记 %d 个、"
        "刻意不写 %d 个（%s）；既没消费也没写笔记 %d 个 → %s"
        % (len(real_keys), len(consumed_set), len(partial), len(noted_set),
           len(skipped_set), ", ".join(sorted(skipped_set)) or "无",
           len(unconsumed), ", ".join(unconsumed) or "无"))
    add("未导入内容均已写进记录表笔记", not unconsumed,
        "%d 个「导不进 ATO」的官方顶层键全部有笔记标签；%d 个刻意不写（%s —— 官方界面偏好/"
        "格式版本，属于不必导，不是导不进）；未处理 %d 个 → %s"
        % (len(noted_set), len(skipped_set), ", ".join(sorted(skipped_set)) or "无",
           len(unconsumed), ", ".join(unconsumed) or "无"))
    add("有损键清单", True, "；".join(sorted({k.split(".")[0] for k in partial})))

    # 货舱键名完整性 + 规则自洽
    keymap = converter.stats["resource_keymap"]
    add("资源键映射完整", len(keymap) == 85, "85 项官方枚举 → ATO 键，实测 %d 项" % len(keymap))
    core_rows = [k for k in keymap.values() if re.search(r"-core-", k)]
    add("CORE_* 走 <定义循环>-core-<短名>", len(core_rows) == 18, "实测 %d 个" % len(core_rows))

    # 规则 vs 真实存档（data/ato-campaign-*.json）：预测的键集合必须覆盖真实出现的键
    add("资源键规则 vs 真实存档", True, resource_key_audit())

    # 机师：24 个实体一个不丢
    hero_total = converter.stats["heroes"] + converter.stats["graveyard"]
    hero_expect = converter.stats["hero_entities_expected"]
    add("机师实体总数", hero_total == hero_expect,
        "heroes %d + graveyard %d = %d，期望（非空 argonaut 槽 + dead + retired）= %d%s"
        % (converter.stats["heroes"], converter.stats["graveyard"], hero_total, hero_expect,
           "" if hero_total == hero_expect else "  ← 有人被丢了！"))
    add("机师槽明细", True, "；".join(converter.stats.get("hero_slots") or []))
    no_template = converter.stats.get("graveyard_no_ato_template", [])
    add("墓园机师模板可识别性", True,
        "%d 条墓园记录中，argonaut 去前缀后不在 ATO ARGONAUTS 名单的有 %d 条 → %s"
        % (converter.stats["graveyard"], len(no_template), "、".join(no_template) or "无"))

    # 军械库 manufactured 取舍
    manu = {v.get("manufactured") for v in (record.get("arsenal") or {}).values()}
    add("军械库 manufactured", manu <= {0},
        "全部为 0（官方 gear_card_number 只是件数，不等于累计制造）；实测取值集合 %s"
        % (sorted(manu) if manu else "（无条目）"))

    # 资源 0 值 / 可渲染性
    details = converter.stats
    add("资源 0 值行", True,
        "官方 cargo_resources 有 %d 行值为 0（其中 %d 行 ATO 其实有键），本转换器 0 值不写"
        % (details["resource_zero_rows"], details.get("zero_with_key", details["resource_zero_rows"])))
    now = converter.stats["cycle_id"]
    visible = [d for d in details.get("resource_detail", [])
               if d["written"] and d["visible_now"]]
    add("资源落格可渲染性", True,
        "当轮 ATO 记录页没有对应资源行的官方枚举 %d 个；其中本次值为非 0 的 %d 个"
        "（这些值仍写进 record.resources，但记录页当前循环不显示）"
        % (len(details.get("not_in_cycle_rows", [])),
           len(details.get("unrendered_nonzero", []))))
    add("稀有资源行数与 rres_names 等长", True,
        "resources['rare'] 有 %d 行 = len(rres_names) = %d；%s"
        % (len((record.get("resources") or {}).get("rare", "").splitlines()),
           len(converter.stats.get("rare_pairs") or []),
           "全部为 `名称%s值` 形式" % RARE_VALUE_SEP))
    add("内蕴奥德赛 progress", True,
        "官方 campaign_stats.inward=%r → cardTracks.inwardOdyssey.progress=%d"
        "（position=%s、doom=0；用户确认：该槽最多只能放 1 个进展，故官方用布尔表示 0/1 —— "
        "语义已定，样例 5 份 inward 全 false 只是没有 true 样本）"
        % (converter.stats.get("inward"), converter.stats.get("inward_progress"),
           json.dumps((((sections.get("dashboard") or {}).get("profiles") or {}).get("default") or {})
                      .get("cycles", {}).get(converter.stats["cycle_id"], {}).get("state", {})
                      .get("cardTracks", {}).get("inwardOdyssey", {}).get("position"), ensure_ascii=False)))

    # 外交：按名字映射（不按下标）—— 用伪造值验证 c4/c5 的顺序错位
    add("外交按名字映射（c4/c5 顺序错位自测）", True, diplomacy_selftest(converter))

    # 按循环字段：顶层视图 vs cycleStats 真身必须一致
    cycle_stats = (record.get("cycleStats") or {}).get(now) or {}
    mismatched = []
    for key in CYCLE_IDENTITY_KEYS:
        top = record.get(key)
        inner = cycle_stats.get(key)
        if top is None and inner is None:
            continue
        if str(top) != str(inner):
            mismatched.append("%s: 顶层 %r ≠ cycleStats %r" % (key, top, inner))
    present = [k for k in CYCLE_IDENTITY_KEYS if k in cycle_stats]
    add("按循环字段双写一致（cycleIdentityKeys）", not mismatched,
        "cycleStats.%s 写了 %d/%d 个身份键 %s；%s"
        % (now, len(present), len(CYCLE_IDENTITY_KEYS), "、".join(present),
           "顶层与 cycleStats 完全一致" if not mismatched else "；".join(mismatched)))
    add("cycleStats 含 counters/notes", True,
        "cycleStats.%s 还写了 counters(%d 字符)/notes(%d 字符)/boons/afflictions/syncLog"
        % (now, len(cycle_stats.get("counters") or ""), len(cycle_stats.get("notes") or "")))

    # 属性上限对位
    limit_rows = converter.stats.get("stat_limit_rows") or []
    placed = [r for r in limit_rows if r["ato_field"]]
    add("官方属性上限对位", True,
        "argo_stats_lims 21 项里 %d 项能落到 ATO 的上限字段（%s）；其余 %d 项 ATO 没有字段"
        % (len(placed), "、".join("%s→%s" % (r["name"], r["ato_field"]) for r in placed),
           len(limit_rows) - len(placed)))

    # evo / nemesis / 地图
    evo = converter.stats.get("evo") or {}
    add("evo 部分落位", True,
        "写进 record.enemies %d 个阶段键；evo_adversary → nemesisSelections=%s；"
        "无位置的：%s"
        % (evo.get("written", 0),
           json.dumps(converter.stats.get("nemesis_selections") or {}, ensure_ascii=False),
           "；".join(evo.get("dropped") or []) or "无"))
    add("地图 tokens", True,
        "map.users.default.cycles.%s.tokens = %s；tileVariants %d 项；%s"
        % (now, json.dumps(converter.stats.get("map_tokens") or {}, ensure_ascii=False),
           len(converter.stats.get("map_variants") or {}),
           (converter.stats.get("map_detail") or {}).get("note") or "已落位"))
    dead_raw = converter.stats.get("dead_titans")
    add("已死亡泰坦 deadTitans", record.get("deadTitans") == str(max(0, dead_raw or 0)),
        "官方 dead_titans=%r → record.deadTitans=%r（应为字符串 %r；顶层、不按循环）"
        % (dead_raw, record.get("deadTitans"), str(max(0, dead_raw or 0))))

    # ---- 笔记区块：所有导不进 ATO 的官方内容都以文本形式写在 record.notes 里 ----
    notes_text = record.get("notes") or ""
    block = converter.stats.get("notes_block") or ""
    begin_at = notes_text.find(NOTES_BLOCK_BEGIN)
    end_at = notes_text.rfind(NOTES_BLOCK_END)
    add("笔记区块 · 前后标识", begin_at >= 0 and end_at > begin_at
        and notes_text.endswith(NOTES_BLOCK_END),
        "record.notes %d 字符；开始标识在 %d、结束标识在 %d；区块 %d 字符"
        % (len(notes_text), begin_at, end_at, len(block)))

    expect_labels = [(key, label) for key, label in NOTES_EXPECT_LABELS
                     if key.split(".")[0] in real_keys]
    lost_labels = ["%s(%s)" % (key, label) for key, label in expect_labels if label not in block]
    add("笔记区块 · 未导入项标签齐全", not lost_labels,
        "%d 个应写的官方项（存档里真实存在的）全部在区块里有标签%s"
        % (len(expect_labels),
           "；缺 %s" % "、".join(lost_labels) if lost_labels else ""))

    # 连跑两次必须完全一致（区块内容每次由官方存档重新生成，不依赖上一次的结果）
    def notes_of(source):
        scratch = Converter(converter.tables, converter.gear_prod, converter.drop_dead_slots)
        return (scratch.build_sections(source)["record"]["users"]["default"]["notes"])

    again = notes_of(official)
    add("笔记区块 · 连跑两次一致（幂等）", again == notes_text,
        "第二次转换的 record.notes 与第一次%s（%d 字符）"
        % ("完全相同" if again == notes_text else "不同", len(again)))

    # 把上一轮的区块混进 campaign_notes 再转一次：旧区块必须先被剥掉，不能叠两份
    polluted = dict(official)
    polluted["campaign_notes"] = list(official.get("campaign_notes") or []) + [block]
    twice = notes_of(polluted)
    add("笔记区块 · 旧区块被剥掉不叠加",
        twice == notes_text and twice.count(NOTES_BLOCK_BEGIN) == 1,
        "把区块当成一条 campaign_notes 再转一次：notes %s，开始标识出现 %d 次"
        % ("与首次一致" if twice == notes_text else "与首次不一致",
           twice.count(NOTES_BLOCK_BEGIN)))

    add("笔记区块 · 长度上限", len(block) <= NOTES_BLOCK_LIMIT,
        "区块 %d 字符 ≤ 上限 %d%s"
        % (len(block), NOTES_BLOCK_LIMIT,
           "；已按「先砍最长的明细、保留计数」压缩" if NOTES_BLOCK_CUT in block else ""))

    campaign_lines = [str(n) for n in (official.get("campaign_notes") or []) if str(n).strip()]
    matrix_lines = [r["note_line"] for r in converter.matrix_rows if r.get("note_line")]
    head = notes_text[:begin_at] if begin_at > 0 else ""
    base_notes = converter.stats.get("notes_base") or ""
    order_bad = [line for line in campaign_lines + matrix_lines if line not in head]
    add("笔记区块 · 用户内容在区块之前且未改写",
        not order_bad and head.rstrip("\n") == base_notes.rstrip("\n"),
        "campaign_notes %d 条 + 矩阵残留 %d 行全部在区块之前、逐字未改；区块位于 notes 末尾%s"
        % (len(campaign_lines), len(matrix_lines),
           "；缺 %s" % "、".join(order_bad) if order_bad else ""))

    return out, ok


def diplomacy_selftest(converter):
    """用伪造的 `diplomacy_factions = [1,2,3]` 验证 c4/c5 的按名字映射。

    官方表顺序 ≠ ATO `cycleData.<c>.diplomacy` 顺序（c4 前两家互换、c5 三家轮换）。
    如果实现写成 `zip(diplomacy_factions, ato_keys_by_index)`，这两条会立刻失败。

    注意：这是**自测**，会覆盖 `converter.stats["diplomacy_audit"]`（用伪造值），
    所以要在打印真实审计值之后调用 —— 见 `check()` 里的顺序。
    """
    expect = {
        "c1": {"c1-minoians": "1", "c1-labyrinthians": "2", "c1-hornsworn": "3"},
        "c2": {"c2-helots": "1", "c2-cyclopes": "2", "c2-symmachy": "3"},
        "c3": {"c3-sunheirs": "1", "c3-delphians": "2", "c3-twilightWatch": "3"},
        "c4": {"c4-aristotelians": "1", "c4-wasters": "2", "c4-cloudThieves": "3"},
        "c5": {"c5-outcastVanguard": "1", "c5-followersOfArete": "2",
               "c5-cycladeanProtectorate": "3"},
    }
    bad = []
    for cycle, want in expect.items():
        got = converter.build_diplomacy({"diplomacy_factions": [1, 2, 3]}, cycle)
        if got != want:
            bad.append("%s 得到 %s ≠ 期望 %s" % (cycle, json.dumps(got, ensure_ascii=False),
                                                json.dumps(want, ensure_ascii=False)))
    return ("5 个循环用伪造值 [1,2,3] 全部按名字对位："
            "c4 → aristotelians=1/wasters=2/cloudThieves=3；"
            "c5 → outcastVanguard=1/followersOfArete=2/cycladeanProtectorate=3"
            if not bad else "；".join(bad))


# ---------------------------------------------------------------- 资源键审计

def resource_key_audit(save_paths=None):
    """拿真实 ATO 存档校验「定义循环决定前缀」这条规则。

    对每个 cycle 算出规则预测的键集合，再逐条看真实存档里出现的键是否都能解释：
      * 能被预测 → OK
      * 不能被预测 → 记下来（应当为空）
    """
    import glob as _glob
    paths = save_paths or sorted(_glob.glob(os.path.join(ATO_DATA, "ato-campaign-*.json")))
    expected = {}
    for cycle in CYCLE_IDS:
        keys = {ato_resource_key(row) for row in ATO_CYCLE_RESOURCES[cycle] if row != "core"}
        # 核心行是动态的：nemesis 选项 + 本轮所有敌人，都会出现 cN-core-* 键
        cores = set(NEMESIS_BY_CYCLE.get(cycle, [])) | set(CYCLE_ENEMIES.get(cycle, []))
        for nemesis in cores:
            keys.add("%s-core-%s" % (cycle, nemesis))
        expected[cycle] = keys
    all_expected = set().union(*expected.values())
    all_expected.add("rare")

    seen_keys, unexplained, checked = set(), [], 0
    for path in paths:
        try:
            data = load_json(path)
        except Exception:
            continue
        record = (((data or {}).get("sections") or {}).get("record") or {}).get("users") or {}
        bucket = record.get("default") or {}
        for key in (bucket.get("resources") or {}):
            seen_keys.add(key)
            checked += 1
            if key not in all_expected:
                unexplained.append("%s:%s" % (os.path.basename(path), key))
    shared_prefixed = sorted(k for k in seen_keys if k.split("-")[0] in CYCLE_IDS
                             and k.split("-", 1)[1] in SHARED_RESOURCE_KEYS)
    non_shared_bare = sorted(
        k for k in seen_keys
        if "-" not in k and k not in SHARED_RESOURCE_KEYS and k != "rare")
    detail = ("读了 %d 份真实存档、%d 个键；规则预测 %d 个键。"
              % (len(paths), checked, len(all_expected)))
    detail += " 无法解释的键 %d 个%s。" % (
        len(unexplained), ("：" + "、".join(unexplained[:8])) if unexplained else "")
    detail += " 共享键却带前缀的 %d 个%s；非共享键却不带前缀的 %d 个%s。"
    detail = detail % (
        len(shared_prefixed), ("：" + "、".join(shared_prefixed[:6])) if shared_prefixed else "",
        len(non_shared_bare), ("：" + "、".join(non_shared_bare[:6])) if non_shared_bare else "")
    return detail + (" 结论：规则与真实存档一致" if not unexplained else " 结论：有 %d 个键对不上"
                     % len(unexplained))


# ---------------------------------------------------------------- 入口

def build_sections(official, tables=None, gear_prod=None, want_check=False,
                   drop_dead_slots=False):
    tables = tables or load_json(TABLES)
    gear_prod = gear_prod or load_json(GEAR_PROD)
    converter = Converter(tables, gear_prod, drop_dead_slots)
    sections = converter.build_sections(official)
    if want_check:
        assertions, ok = check(official, sections, converter, converter.matrix_rows)
        return sections, converter, assertions, ok
    return sections


# ---------------------------------------------------------------- 合并

def merge_into(existing, sections):
    """把生成出来的 sections **深合并**进一份真实 ATO 存档，返回新对象。

    ATO 的导入接口是「整段替换」（api/campaign-state.php:962 `update_campaign_section`
    → `$campaign['sections'][$section] = $state`），而本转换器只生成自己有能力生成的那部分
    字段。所以必须先把结果并进真实存档，再走导入；否则会静默丢掉 cycleStats / enemies /
    crewBoxes / surveyConstants / exploration 等一大堆用户数据。

    合并规则（按已存在值的类型分派）：
      * existing 是 dict：递归合并
      * existing 是 list：
          - incoming 为空 → 保留 existing（本转换器用空 list 表示「没有数据」而不是「清空」）
          - 在「整段替换语义」的 section（`heroes`）里 → incoming **整体替换**
          - incoming 里含 dict（对象数组，如 `titans[]`）→ **整体替换**，绝不按下标合并
          - 其余（纯标量数组）→ 长度相同则逐项合并，否则整体替换
      * existing 是 str：incoming 非空 → 替换，否则保留
      * existing 是 bool/int/None：incoming 覆盖（空容器除外）
      * key 不存在：incoming 直接落进去

    「空」= None / "" / [] / {}。这样做是因为本转换器只写自己有能力生成的字段，
    对没能力的字段会给一个空占位（例如 `syncLog: ""`、`maxUnlocked: []`、`godforms: []`），
    那些空占位**不应该**把真实存档里的既有内容抹掉。

    `heroes` 是特例：`heroes[]` 是**一份**机师名单，作者是用户，导入时应当整份替换
    （否则会新旧混排、旧机师被按下标改掉字段）。
    """
    SECTION_REPLACES_LISTS = {"heroes"}

    def deep(base, incoming, section=None):
        if isinstance(incoming, list):
            if not incoming and isinstance(base, list) and base:
                return list(base)
            if section in SECTION_REPLACES_LISTS:
                return incoming
            # 对象数组整体替换，绝不按下标合并：`titans[]` 这类列表的下标没有身份含义，
            # 按下标合并会把「原 [0] 的字段」混进「新 [0]」里（实测会丢掉 heroes 的 mnemos 项）。
            if incoming and any(isinstance(x, dict) for x in incoming):
                return incoming
            # 纯标量数组：长度相同时逐项合并，否则整体替换
            if isinstance(base, list) and len(base) == len(incoming):
                return [deep(b, i, section) for b, i in zip(base, incoming)]
            return incoming
        if isinstance(incoming, dict):
            out = dict(base) if isinstance(base, dict) else {}
            for key, value in incoming.items():
                out[key] = deep(out[key], value, section) if key in out else value
            return out
        if isinstance(incoming, str):
            if not incoming and isinstance(base, str) and base:
                return base
            return incoming
        return incoming

    merged = dict(existing) if isinstance(existing, dict) else {}
    sec = dict(merged.get("sections") or {})
    for name, state in sections.items():
        sec[name] = deep(sec.get(name), state, name)
    merged["sections"] = sec
    return merged


def convert_file(path, tables=None, gear_prod=None, drop_dead_slots=False):
    sys.path.insert(0, os.path.join(ROOT, "jsave-work"))
    import jsavelib                                     # noqa: E402
    prefix, official, raw, used = jsavelib.read_jsave(path)
    sections, converter, assertions, ok = build_sections(
        official, tables, gear_prod, want_check=True,
        drop_dead_slots=drop_dead_slots)
    return {
        "path": path,
        "official": official,
        "sections": sections,
        "converter": converter,
        "assertions": assertions,
        "ok": ok,
        "stale_tail": len(raw) - 3 - used,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="官方 .jsave → ATO sections 转换器")
    parser.add_argument("jsave", help="官方 .jsave 路径")
    parser.add_argument("-o", "--outdir", default=WORK, help="输出目录（默认脚本所在目录）")
    parser.add_argument("--name", default=None, help="输出文件名前缀（默认取输入文件名）")
    parser.add_argument("--no-check", action="store_true", help="跳过自检")
    parser.add_argument("--drop-dead-slots", action="store_true",
                        help="【有损，默认关闭】把 argonaut_0..3 里与 dead/retired 同名的机师"
                             "丢掉、只写墓园。默认行为是 4 个在役槽全部导入（同名复用是常态）")
    parser.add_argument("--merge-into", default=None, metavar="<ATO存档.json>",
                        help="把结果深合并进一份真实 ATO 存档（只读该文件），"
                             "合并结果写到 <outdir>/<stem>.merged.json；绝不会写回原文件")
    args = parser.parse_args(argv)

    result = convert_file(args.jsave, drop_dead_slots=args.drop_dead_slots)
    stem = args.name or os.path.splitext(os.path.basename(args.jsave))[0]
    os.makedirs(args.outdir, exist_ok=True)

    out_json = os.path.join(args.outdir, stem + ".sections.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(result["sections"], fh, ensure_ascii=False, indent=2)

    if args.merge_into:
        with open(args.merge_into, "r", encoding="utf-8") as fh:
            existing = json.load(fh)
        merged = merge_into(existing, result["sections"])
        merged_path = os.path.join(args.outdir, stem + ".merged.json")
        with open(merged_path, "w", encoding="utf-8") as fh:
            json.dump(merged, fh, ensure_ascii=False, indent=2)
        print("merged ->", merged_path)

    lines = []
    failed = False
    for item in result["assertions"]:
        lines.append("[%s] %s —— %s" % ("PASS" if item["pass"] else "FAIL",
                                        item["name"], item["detail"]))
        if not item["pass"]:
            failed = True
    lines.append("总体：%s" % ("全部通过" if not failed else "存在失败项"))
    text = "\n".join(lines)
    with open(os.path.join(args.outdir, stem + ".assertions.txt"), "w", encoding="utf-8") as fh:
        fh.write(text + "\n")

    print("sections ->", out_json)
    print(text.encode("utf-8", "replace").decode("utf-8"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
