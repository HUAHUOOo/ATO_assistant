"""测试存档生成器（tools/make-briefing-test-save.py）与简报回放的联合回归。

流程与人工操作一致：先用生成器造出 20 天备份，再让真实的 briefing/api.php 从这些
备份重建时间轴，逐日核对「当天新翻开一格、当天新点亮一项科技」。生成器里任何一步
写歪（目录名、state.day、unlockedKeys、exploredIds），这里都会先失败。
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PHP = shutil.which('php')
GENERATOR = ROOT / 'tools' / 'make-briefing-test-save.py'

pytestmark = pytest.mark.skipif(PHP is None, reason='需要 php 可执行文件；本机没有装 PHP')

ACCOUNT = 'demo-briefing'
DAYS = 20


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def get_json(url: str, cookie: str | None = None):
    request = urllib.request.Request(url)
    if cookie:
        request.add_header('Cookie', cookie)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode('utf-8'))


@pytest.fixture(scope='module')
def fixture(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp('briefing-fixture')
    env = dict(os.environ)
    env['ATO_DATA_DIR'] = str(data_dir)
    env['ATO_BRIEFING_FIXTURE_QUIET'] = '1'
    env['PYTHONIOENCODING'] = 'utf-8'
    result = subprocess.run(
        [sys.executable, str(GENERATOR), '--account', ACCOUNT, '--days', str(DAYS)],
        cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=300,
        encoding='utf-8', errors='replace',
    )
    assert result.returncode == 0, f'生成器失败：{result.stdout}\n{result.stderr}'

    # 注册只为拿到登录态；备份本身与密码无关。
    users_file = data_dir / 'ato-users.json'
    users_file.write_text(json.dumps({
        'version': 1,
        'users': {
            ACCOUNT: {
                'id': ACCOUNT,
                'username': ACCOUNT,
                'passwordHash': '$2y$04$0123456789012345678901234567890123456789012345678901',
                'createdAt': '2026-09-01T00:00:00+00:00',
            },
        },
    }, ensure_ascii=False), encoding='utf-8')

    sessions = data_dir / 'sessions'
    sessions.mkdir(parents=True, exist_ok=True)
    session_id = 'briefingfixture00000000000001'
    (sessions / f'sess_{session_id}').write_text(f'ato_user_id|s:{len(ACCOUNT)}:"{ACCOUNT}";', encoding='utf-8')

    port = free_port()
    server_env = dict(env)
    process = subprocess.Popen(
        [PHP, '-S', f'127.0.0.1:{port}', '-t', str(ROOT), 'router.php'],
        cwd=str(ROOT), env=server_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f'http://127.0.0.1:{port}'
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            get_json(f'{base}/api/campaign-state.php?action=me')
            break
        except Exception:
            time.sleep(0.2)
    else:
        process.kill()
        raise RuntimeError('PHP 内置服务器没起来')

    yield {
        'data_dir': data_dir,
        'base': base,
        'cookie': f'PHPSESSID={session_id}',
        'stdout': result.stdout,
    }
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def test_generator_writes_one_backup_per_day(fixture):
    cycle_dir = fixture['data_dir'] / 'backups' / ACCOUNT / 'daily' / 'default' / 'c1'
    day_dirs = sorted(item.name for item in cycle_dir.iterdir() if item.is_dir())
    assert len(day_dirs) == DAYS, day_dirs
    # 序章 + 正片：T0..T5 与第 0..13 天
    assert 'day-T0' in day_dirs and 'day-T5' in day_dirs
    assert 'day-0' in day_dirs and f'day-{DAYS - len(["T0","T1","T2","T3","T4","T5"]) - 1}' in day_dirs
    for day_dir in cycle_dir.iterdir():
        files = list(day_dir.glob('*.json'))
        assert len(files) == 1, f'{day_dir.name} 应当只有一份备份，实际 {len(files)}'
    save_file = fixture['data_dir'] / f'ato-campaign-{ACCOUNT}.json'
    assert save_file.is_file()
    campaign = json.loads(save_file.read_text(encoding='utf-8'))
    assert campaign['sections']['dashboard']['profiles']['default']['cycles']['c1']['state']['day'] == '13'


def test_briefing_replays_a_tile_and_a_tech_per_day(fixture):
    status, payload = get_json(f"{fixture['base']}/briefing/api.php", fixture['cookie'])
    assert status == 200 and payload['ok'] is True, payload
    assert payload['hasData'] is True
    timeline = payload['timeline']
    assert len(timeline) == DAYS
    assert all(entry['present'] for entry in timeline)
    # 日期轴顺序：序章在前，正片在后
    assert [entry['day'] for entry in timeline[:6]] == ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']
    assert [entry['day'] for entry in timeline[6:]] == [str(index) for index in range(DAYS - 6)]

    for index, entry in enumerate(timeline):
        assert entry['map']['new'], f"第 {entry['day']} 天应当新翻开板块"
        assert len(entry['map']['new']) == 1, f"第 {entry['day']} 天只应新翻开一格"
        assert entry['map']['exploredCount'] == index + 1
        assert entry['map']['currentTileId'] == entry['map']['new'][0]
        assert entry['tech']['new'], f"第 {entry['day']} 天应当新点亮科技"
        assert len(entry['tech']['new']) == 1
        assert len(entry['tech']['unlocked']) == index + 1

    # 首尾对照：T0 只有一格一项，最后一天 20 格 20 项
    assert timeline[0]['map']['explored'] == [timeline[0]['map']['new'][0]]
    assert timeline[-1]['map']['exploredCount'] == DAYS
    assert len(timeline[-1]['tech']['unlocked']) == DAYS

    # 逐日清单里能看到可读的变化条目
    kinds = {change['kind'] for change in timeline[5]['changes']}
    assert {'map', 'location', 'tech', 'mapsync'} <= kinds

    # 地图与科技树载荷齐备（回放要用）
    assert len(payload['map']['tiles']) == DAYS
    assert all(tile['known'] for tile in payload['map']['tiles'])
    assert payload['map']['canvas']['width'] > 1
    pages = {page['page']: page for page in payload['tech']['pages']}
    cycle1 = pages['cycle1']
    assert len(cycle1['nodes']) == 53
    assert cycle1['edges'], '科技树连线不能为空'
    unlocked_nodes = [node for node in cycle1['nodes'] if node['unlocked']]
    assert len(unlocked_nodes) == DAYS
    assert payload['summary']['recordedDays'] == DAYS


def test_generator_clean_removes_fixture(tmp_path):
    data_dir = tmp_path / 'data'
    data_dir.mkdir()
    env = dict(os.environ)
    env['ATO_DATA_DIR'] = str(data_dir)
    env['ATO_BRIEFING_FIXTURE_QUIET'] = '1'
    env['PYTHONIOENCODING'] = 'utf-8'
    create = subprocess.run(
        [sys.executable, str(GENERATOR), '--account', 'demo-clean', '--days', '6'],
        cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120,
        encoding='utf-8', errors='replace',
    )
    assert create.returncode == 0, create.stderr
    assert (data_dir / 'ato-campaign-demo-clean.json').is_file()
    clean = subprocess.run(
        [sys.executable, str(GENERATOR), '--account', 'demo-clean', '--clean'],
        cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120,
        encoding='utf-8', errors='replace',
    )
    assert clean.returncode == 0, clean.stderr
    assert not (data_dir / 'ato-campaign-demo-clean.json').exists()
    assert not (data_dir / 'backups' / 'demo-clean').exists()
