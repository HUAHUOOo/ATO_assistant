#!/usr/bin/env python3
"""生成一份用于查看战役简报回放效果的测试存档。

做什么：
  - 造一个指定名字的账号存档（默认 demo-briefing），五个循环齐全；
  - 造 C1 约 20 天的每日备份：从序章 T0 起，每天推进一格（相邻板块）、
    序章结束后每天点亮一项满足前置的科技，并让故事章节、英雄名单、
    地图流水都跟着走；
  - 同时把最后一天的状态写成账号当前存档，这样简报的循环下拉能看到它。

为什么需要它：战役简报（briefing/）完全由备份重建，要人工逐天点 20 天才能看出
回放效果。这份脚本按真实存档结构合成数据，用来看「地图一格一格长出来、科技一项一项
亮起来」。

用法：
    python tools/make-briefing-test-save.py                       # 生成 20 天
    python tools/make-briefing-test-save.py --days 30             # 换天数
    python tools/make-briefing-test-save.py --account demo-x      # 换账号名
    python tools/make-briefing-test-save.py --clean               # 删掉这个账号的数据

生成后：启动程序 → 主控台用该账号「注册」（密码随意，≥4 位；账号名见输出）→
打开 /briefing/ 选择「循环 I」。备份本身不依赖密码，注册只是为了拿到登录态。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# 数据目录固定是 <仓库根>/data；测试可以用 ATO_DATA_DIR 指向临时目录，
# 与 api/campaign-state.php、briefing/api.php 认的是同一个环境变量。
_env_data_dir = os.environ.get('ATO_DATA_DIR', '').strip()
DATA_DIR = Path(_env_data_dir) if _env_data_dir else ROOT / 'data'
# 测试调用时不要打印「请去注册」那段（它只是给人看的说明）。
SKIP_NOTICE = bool(os.environ.get('ATO_BRIEFING_FIXTURE_QUIET'))
MAP_DATA = ROOT / 'map' / 'map-data.js'
TECH_DICTIONARY = ROOT / 'technology' / 'tech_card_dictionary.min.json'


def display_path(path: Path) -> str:
    """仓库里的路径显示相对路径；测试会把落点指到临时目录，那时显示绝对路径。"""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


CYCLE = 'c1'
PROFILE = 'default'

# 序章天数：C1 的备份里真实存在 T0..T5 与 T6/00
PROLOGUE_DAYS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']

STORY_SECTIONS = [
    '教程 - 一切的开始',
    '主线剧情 - 迷宫的真理',
    '冒险枢纽 01 - 宿命的迷境',
    '冒险枢纽 02 - 缄默的证词',
    '冒险枢纽 03 - 我们身后留下的',
    '内蕴奥德赛 - 世界的诞生',
]

ARGONAUTS = ['odys', 'herm', 'atla', 'mene', 'anti', 'kast', 'poly']


def load_map_cycle(cycle_id: str) -> dict:
    raw = MAP_DATA.read_text(encoding='utf-8')
    raw = re.sub(r'^\s*window\.ATO_MAP_DATA\s*=\s*', '', raw)
    raw = raw.rstrip().rstrip(';')
    data = json.loads(raw)
    for cycle in data['cycles']:
        if cycle['id'] == cycle_id:
            return cycle
    raise SystemExit(f'map-data.js 里没有循环 {cycle_id}')


def load_tech_cards() -> list[dict]:
    data = json.loads(TECH_DICTIONARY.read_text(encoding='utf-8'))
    cards = []
    for card in data['cards']:
        nodes = [node for node in (card.get('nodes') or []) if node.get('page') == 'cycle1']
        if not nodes:
            continue
        cards.append({
            'key': str(card['key']).lower().strip(),
            'rawKey': card['key'],
            'nameEn': (card.get('names') or {}).get('en') or card['key'],
            'nameZh': (card.get('names') or {}).get('zh') or '',
            'category': card.get('category') or '',
            'index': card.get('index', 0),
            'nodeIds': [node['id'] for node in nodes],
            'requires': [str(ref).lower().strip() for ref in (nodes[0].get('req') or [])],
            'requiresAny': [
                [str(ref).lower().strip() for ref in group]
                for group in (nodes[0].get('requires_any_groups') or [])
            ],
        })
    cards.sort(key=lambda card: card['index'])
    return cards


def walk_tiles(cycle: dict, steps: int) -> list[str]:
    """从起始板块出发、沿相邻关系走一条不重复的路线，返回每天到达的板块。"""
    neighbours = {}
    for tile in cycle['tiles']:
        linked = [value for value in (tile.get('neighbors') or {}).values() if value]
        linked += [value for value in (tile.get('exits') or {}).values() if value]
        neighbours[str(tile['id'])] = [str(value) for value in dict.fromkeys(linked)]

    def score(tile_id: str) -> tuple:
        tile = next(item for item in cycle['tiles'] if str(item['id']) == tile_id)
        # 先走编号区（和地图页的排版一致），再走地形区
        numbered = 0 if re.fullmatch(r'\d{3}', tile_id) else 1
        return (numbered, int(tile.get('ny') or 0), int(tile.get('nx') or 0))

    visited = set()
    path = []
    current = None
    for tile_id in sorted(neighbours, key=score):
        if neighbours[tile_id]:
            current = tile_id
            break
    if current is None:
        raise SystemExit('地图数据里没有可用的起始板块')

    # 走法：在相邻未访问板块里带权重随机挑（坐标序靠前的略占优），这样路线会拐弯，
    # 回放看起来像真的在开图，而不是沿着一行推到底。
    def pick(options: list[str]) -> str:
        ranked = sorted(options, key=score)
        weights = [2 ** (len(ranked) - 1 - position) for position in range(len(ranked))]
        return random.choices(ranked, weights=weights, k=1)[0]

    while len(path) < steps:
        if current not in visited:
            visited.add(current)
            path.append(current)
        options = [item for item in neighbours[current] if item not in visited]
        if options:
            current = pick(options)
            continue
        # 走到死角：退回最近的一个仍有未访问邻格的已访问板块，从那里继续开路，
        # 这样路线始终由相邻关系连成一条真实的航行轨迹。
        bridge = None
        for step in reversed(path):
            if [item for item in neighbours[step] if item not in visited]:
                bridge = step
                break
        if bridge is None:
            path.extend([path[-1]] * (steps - len(path)))
            break
        current = bridge
    return path[:steps]


def pick_techs(cards: list[dict], count: int) -> list[dict]:
    """按前置关系每天点亮一项：返回按天排列的科技列表。"""
    unlocked: set[str] = set()
    chosen: list[dict] = []
    by_key = {card['key']: card for card in cards}

    def available(card: dict) -> bool:
        if card['key'] in unlocked:
            return False
        for ref in card['requires']:
            if ref in by_key and ref not in unlocked:
                return False
        for group in card['requiresAny']:
            usable = [ref for ref in group if ref in by_key]
            if usable and not any(ref in unlocked for ref in usable):
                return False
        return True

    # 开局送的几项（真实存档里 C1 起始就有这几项）
    for key in ('antikratos project', 'argo works', 'last tome', 'primordial dawn', 'titanogenesis'):
        if key in by_key:
            unlocked.add(key)
            chosen.append(by_key[key])

    pool = list(cards)
    while len(chosen) < count:
        candidate = next((card for card in pool if available(card)), None)
        if candidate is None:
            break
        unlocked.add(candidate['key'])
        chosen.append(candidate)
    while len(chosen) < count:
        chosen.append(chosen[-1])
    return chosen[:count]


def tech_record(card: dict) -> dict:
    return {
        'key': card['key'],
        'pageKey': 'cycle1',
        'pageLabel': '循环 I',
        'name': card['nameEn'],
        'nameZh': card['nameZh'],
        'displayName': card['nameZh'] or card['nameEn'],
        'category': card['category'],
        'categoryLabel': '结构科技' if card['category'] == 'structure' else '战斗科技',
        'negotiation': False,
        'cardIndexes': [card['index']],
        'unimportant': False,
    }


def build_days(cycle: dict, cards: list[dict], days: int) -> list[dict]:
    """算出每天的进度：地点、已翻开板块、已解锁科技。"""
    day_names = list(PROLOGUE_DAYS) + [str(index) for index in range(days)]
    day_names = day_names[:days]
    tiles = walk_tiles(cycle, len(day_names))
    techs = pick_techs(cards, len(day_names))

    timeline = []
    explored: list[str] = []
    unlocked: list[dict] = []
    for index, day in enumerate(day_names):
        tile = tiles[index]
        if tile not in explored:
            explored.append(tile)
        unlocked.append(techs[index])
        timeline.append({
            'day': day,
            'tile': tile,
            'explored': list(explored),
            'unlocked': list(unlocked),
        })
    return timeline


def backup_component(value: str) -> str:
    """与 api/campaign-state.php 的 campaign_backup_component() 保持一致。"""
    import hashlib
    component = re.sub(r'[^A-Za-z0-9_-]+', '-', value).strip('-') or 'value'
    needs_hash = component != value or len(component) > 70
    if len(component) > 70:
        component = component[:70]
    if needs_hash:
        component += '-' + hashlib.sha256(value.encode('utf-8')).hexdigest()[:8]
    return component


def state_for(entry: dict, cycle: dict, cards: list[dict], unlocked: list[dict],
              story_section: str, story_title: str, heroes: list[str], notes: str) -> dict:
    tiles_by_id = {str(tile['id']): tile for tile in cycle['tiles']}
    current = entry['tile']
    current_tile = tiles_by_id.get(current, {'id': current, 'label': current})
    explored = entry['explored']
    latest = current

    markers = [f'{current}:last_city'] if entry['day'] == '5' else []
    tag_labels = []
    if current_tile.get('cardId'):
        tag_labels = ['进展']

    def tech_section_keys() -> list[str]:
        return [card['key'] for card in cards if card['key'] in {item['key'] for item in unlocked}]

    return {
        'day': entry['day'],
        'location': current,
        'objective': '',
        'reminder': '',
        'notes': notes,
        'dateNotes': [],
        'completed': [],
        'events': [],
        'constantToolsOpen': [],
        'cardTracks': {
            'story': {'position': len(explored), 'progress': 0, 'doom': 0},
            'doom': {'position': max(1, len(explored) // 3), 'progress': 0, 'doom': 0},
            'inwardOdyssey': {'position': max(1, len(explored) // 5), 'progress': 0, 'doom': 0},
        },
        'cardTracksVersion': 1,
        'nextBattleTerrain': {},
        'surveyConstants': {'hubs': {}, 'rr': [], 'activeHub': None, 'activeRr': None},
        'surveyConstantsDay': f'{CYCLE}:{entry["day"]}',
        'surveyConstantsTouchedDay': None,
        'latestSurveyAdventureAction': None,
        'latestSimpleAdventureAction': None,
        'pharosDreams': {},
        'pharosDreamsDay': None,
        'pharosDreamsActive': None,
        'mainStoryConstants': {},
        'mainStoryConstantsDay': None,
        'mainStoryConstantsActive': None,
        'mnemosBreakthroughConstants': [],
        'mnemosBreakthroughConstantsDay': None,
        'mnemosBreakthroughConstantsActive': None,
        'specialEventConstants': {},
        'specialEventConstantsDay': None,
        'specialEventConstantsActive': None,
        'exploration': {
            'selectedByCycle': {CYCLE: []},
            'drawStateByCycle': {
                CYCLE: {
                    'drawPile': [], 'activePiles': [], 'temporaryRemoved': [],
                    'permanentRemoved': [], 'history': [], 'discardPile': [], 'current': None,
                },
            },
            'cardTagsByCycle': [], 'destructionByCycle': [], 'destructionCardIdsByCycle': [],
            'acclimationsByCycle': [], 'settledByCycle': {CYCLE: []},
        },
        'unlockedTech': {
            'savedAt': None,
            'accountId': PROFILE,
            'accountName': '默认用户',
            'techCycle': 'cycle1',
            'techCycleLabel': '循环 I',
            'unlockedKeys': [item['key'] for item in unlocked],
            'unimportantKeys': [],
            'conditionKeys': [],
            'unlocked': [tech_record(card) for card in unlocked],
        },
        'mapSnapshot': {
            'savedAt': None,
            'cycleId': CYCLE,
            'cycleLabel': cycle.get('label') or 'Cycle I',
            'currentTileId': current,
            'currentTileLabel': current_tile.get('label', current),
            'currentTileFace': '',
            'adversaryTileId': '',
            'adversaryTileLabel': '',
            'titanXTrackPosition': None,
            'latestRevealedTileId': latest,
            'latestRevealedTileLabel': tiles_by_id.get(latest, {}).get('label', latest),
            'latestRevealedTileFace': '',
            'lastCityTileId': current if markers else '',
            'lastCityTileLabel': current if markers else '',
            'lastOasisTileId': '',
            'lastOasisTileLabel': '',
            'lastSilverRuinTileId': '',
            'lastSilverRuinTileLabel': '',
            'scoutCount': max(0, len(explored) // 6),
            'scoutTileId': '',
            'scoutTileLabel': '',
            'currentTileTags': [],
            'currentTileTagLabels': tag_labels,
            'currentTileFactions': [],
            'currentTileFactionLabels': [],
            'latestRevealedTileTags': [],
            'latestRevealedTileTagLabels': [],
            'currentTileHasLastCityMarker': bool(markers),
            'currentTileHasLastOasisMarker': False,
            'currentTileHasLastSilverRuinMarker': False,
            'currentTileIsLatestRevealed': True,
            'exploredCount': len(explored),
            'totalTiles': len(cycle['tiles']),
            'exploredIds': list(explored),
            'tileNotes': [],
            'markers': markers,
        },
        '_story': {'section': story_section, 'title': story_title},
        '_heroes': list(heroes),
    }


def campaign_document(day_entries: list[dict], state: dict, revised_at: str, revision: int) -> dict:
    story = state.pop('_story')
    heroes = state.pop('_heroes')
    cycles = {}
    for cycle_id in ('c1', 'c2', 'c3', 'c4', 'c5'):
        cycles[cycle_id] = {
            'id': cycle_id,
            'state': state if cycle_id == CYCLE else {'day': '0'},
        }
    map_cycle_state = {
        'currentTile': state['mapSnapshot']['currentTileId'],
        'latestRevealedTile': state['mapSnapshot']['latestRevealedTileId'],
        'explored': {tile_id: True for tile_id in state['mapSnapshot']['exploredIds']},
        'previewRevealed': [],
        'tileNotes': {},
        'tileVariants': {},
        'titanXTrackPosition': None,
        'tokens': {
            'AG': state['mapSnapshot']['currentTileId'],
            'AD': '',
            'hsCount': state['mapSnapshot']['scoutCount'],
            'markers': {},
            'edgeMarkers': [],
        },
    }
    return {
        'version': 1,
        'updatedAt': revised_at,
        'sections': {
            'dashboard': {
                'activeProfileId': PROFILE,
                'profiles': {
                    PROFILE: {
                        'id': PROFILE,
                        'name': '默认用户',
                        'termLanguage': 'fan',
                        'activeCycleId': CYCLE,
                        'cycles': cycles,
                    },
                },
            },
            'map': {'users': {PROFILE: {'activeCycleId': CYCLE, 'mapZoom': 140, 'cycles': {CYCLE: map_cycle_state}}}},
            'record': {'users': {PROFILE: {'cycle': CYCLE, 'day': state['day'], 'location': ''}}},
            'technology': {
                'users': {
                    PROFILE: {
                        'currentCycle': 'cycle1',
                        'unlocked': list(state['unlockedTech']['unlockedKeys']),
                        'unimportant': [],
                        'conditions': [],
                        'treeLanguage': 'zh',
                        'hideUnknownTech': False,
                        'hideTreeImage': False,
                    },
                },
            },
            'heroes': {
                'heroes': [
                    {
                        'id': f'hero-demo-{name}',
                        'argonaut': name,
                        'customName': '',
                        'playerName': '',
                        'basicSkill': '',
                        'skillsExpanded': False,
                        'baseSkills': {'courage': 0, 'wisdom': 0, 'will': 0, 'endurance': 0, 'cunning': 0, 'fury': 0},
                        'mnemos': {'c1': [], 'c2': [], 'c3': [], 'c4': [], 'c5': []},
                        'mnemosProgress': [], 'mnemosNodeProgress': [], 'mnemosTags': [],
                        'fatedMnemos': {'c1': [], 'c2': [], 'c3': [], 'c4': [], 'c5': []},
                        'fatedProgress': [],
                        'triskelion': {'fury': 0, 'fate': 0, 'danger': 0},
                        'abilities': '',
                        'notes': '',
                    }
                    for name in heroes
                ],
                'activeHeroId': f'hero-demo-{heroes[0]}' if heroes else '',
                'graveyard': [],
            },
            'aibp': {'version': 1, 'apostle': '', 'title': '', 'level': 'C1', 'traits': [], 'extraCards': []},
            'story': {
                'imagesOnly': False,
                'images': [],
                'fallbackText': '',
                'bookTitle': 'ATO C1 故事书（测试存档）',
                'section': story['section'],
                'id': story['title'],
                'title': story['title'],
            },
        },
        'sectionRevisions': {
            'dashboard': revision, 'map': revision, 'record': 1, 'technology': revision,
            'heroes': revision, 'aibp': 1, 'story': revision,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='生成战役简报回放用的测试存档')
    parser.add_argument('--account', default='demo-briefing', help='账号名（默认 demo-briefing）')
    parser.add_argument('--days', type=int, default=20, help='总天数（含序章，默认 20）')
    parser.add_argument('--clean', action='store_true', help='只删除这个账号的存档与备份')
    args = parser.parse_args()

    account = args.account.strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,31}', account):
        raise SystemExit('账号名只能是小写字母/数字/下划线/连字符，3-32 位')

    save_file = DATA_DIR / f'ato-campaign-{account}.json'
    backup_root = DATA_DIR / 'backups' / backup_component(account)

    if args.clean:
        removed = []
        if save_file.exists():
            save_file.unlink()
            removed.append(display_path(save_file))
        if backup_root.exists():
            shutil.rmtree(backup_root)
            removed.append(display_path(backup_root))
        print('已删除：' + (', '.join(removed) if removed else '（没有找到该账号的数据）'))
        return 0

    random.seed(20261002)
    cycle = load_map_cycle(CYCLE)
    cards = load_tech_cards()
    entries = build_days(cycle, cards, max(2, args.days))

    start = datetime(2026, 9, 1, 20, 0, tzinfo=timezone.utc)
    sync_lines: list[str] = []
    written = 0

    for index, entry in enumerate(entries):
        moment = start + timedelta(days=index)
        stamp = moment.strftime('%Y%m%dT%H%M%SZ')
        story_section = STORY_SECTIONS[min(len(STORY_SECTIONS) - 1, index // 4)]
        story_title = f'{index + 1:04d}'
        heroes = ARGONAUTS[: min(len(ARGONAUTS), 1 + (index + 2) // 3)]

        sync_lines.append(
            f'[地图同步 {moment.strftime("%Y/%m/%d %H:%M:%S")}]'
            f' / 测试存档 / 阿尔戈号：{entry["tile"]} / 已揭示：{len(entry["explored"])}/{len(cycle["tiles"])}'
        )
        state = state_for(entry, cycle, cards, entry['unlocked'], story_section, story_title, heroes,
                          '\n'.join(sync_lines))
        state['mapSnapshot']['savedAt'] = moment.isoformat().replace('+00:00', 'Z')
        state['unlockedTech']['savedAt'] = state['mapSnapshot']['savedAt']

        document = campaign_document(entry, state, moment.isoformat().replace('+00:00', 'Z'), 100 + index)
        day_dir = backup_root / 'daily' / PROFILE / CYCLE / f'day-{backup_component(entry["day"])}'
        day_dir.mkdir(parents=True, exist_ok=True)
        target = day_dir / f'{stamp}-{random.randrange(16 ** 8):08x}.json'
        target.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding='utf-8')
        written += 1

    # 当前存档 = 最后一天，循环下拉才看得到这个账号的进度
    last_index = len(entries) - 1
    last_entry = entries[last_index]
    last_moment = start + timedelta(days=last_index)
    last_state = state_for(
        last_entry, cycle, cards, last_entry['unlocked'],
        STORY_SECTIONS[min(len(STORY_SECTIONS) - 1, last_index // 4)],
        f'{last_index + 1:04d}',
        ARGONAUTS[: min(len(ARGONAUTS), 1 + (last_index + 2) // 3)],
        '\n'.join(sync_lines),
    )
    last_state['mapSnapshot']['savedAt'] = last_moment.isoformat().replace('+00:00', 'Z')
    last_state['unlockedTech']['savedAt'] = last_state['mapSnapshot']['savedAt']
    live = campaign_document(last_entry, last_state, last_moment.isoformat().replace('+00:00', 'Z'), 100 + last_index)
    save_file.write_text(json.dumps(live, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'账号：{account}')
    print(f'当前存档：{display_path(save_file)}')
    print(f'每日备份：{display_path(backup_root)}/daily/{PROFILE}/{CYCLE}/  （{written} 天）')
    print(f'天数轴：{entries[0]["day"]} → {last_entry["day"]}')
    print()
    print('逐日进度：')
    print('  天数   板块      已翻开  已解锁科技  最新点亮')
    for index, entry in enumerate(entries):
        latest = entry['unlocked'][-1]
        print(f'  {entry["day"]:<6} {entry["tile"]:<8} {len(entry["explored"]):>4}   {len(entry["unlocked"]):>8}    {latest["nameZh"] or latest["nameEn"]}')
    print()
    if not SKIP_NOTICE:
        print('查看方式：启动程序后在主控台用下面这组信息注册/登录，再打开 /briefing/ 选择「循环 I」')
        print(f'  账号：{account}    密码：自定（≥4 位）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
