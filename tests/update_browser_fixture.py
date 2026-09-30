"""Disposable manual-browser fixture. Run python -B tests/update_browser_fixture.py.

Copies tracked application files into tmp, adds synthetic GitHub responses to the
copied dashboard, and runs real PHP APIs. Never serves the working installation.
Stop with Ctrl+C. Fixture files remain under tmp for inspecting test evidence.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    fixture = ROOT / 'tmp' / ('browser-update-' + uuid.uuid4().hex[:10])
    fixture.mkdir(parents=True)
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    tracked += ['api/app-update.php', 'api/app-update-policy.php']
    for name in tracked:
        if not name or name.split('/')[0] in {'.git', '.github', 'data', 'tests', 'tools', 'official-assets'}:
            continue
        source = ROOT / name
        if not source.is_file():
            continue
        target = fixture / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (fixture / 'runtime/php').mkdir(parents=True)
    (fixture / 'data').mkdir()
    (fixture / 'data/browser-test-sentinel.txt').write_text('synthetic save: preserve me', encoding='utf-8')
    (fixture / 'assets/update-fixture-blocked.js').mkdir()
    (fixture / 'assets/update-fixture-old.js').write_text('// old module\n', encoding='utf-8')
    (fixture / 'tools').mkdir()
    shutil.copyfile(ROOT / 'tools/matrix.html', fixture / 'tools/matrix.html')
    shim = '''<script>
    (() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = String(input);
        if (url.startsWith('https://api.github.com/repos/banard2049-cpu/ATO_assistant') ||
            url.startsWith('https://raw.githubusercontent.com/banard2049-cpu/ATO_assistant/')) {
          const scenario = document.querySelector('#fixtureScenario')?.value || 'normal';
          const kind = url.includes('/releases/latest') ? 'release' : url.includes('/compare/') ? 'compare' : 'raw';
          const path = kind === 'raw' ? decodeURIComponent(url.split('/v9.9.9/')[1] || '') : '';
          return originalFetch('/fixture.php?kind=' + kind + '&scenario=' + scenario + '&path=' + encodeURIComponent(path), init);
        }
        return originalFetch(input, init);
      };
    })();
    </script>'''
    controls = '''<label style="display:block;padding:12px;background:#483e20;color:white" for="fixtureScenario">隔离测试场景</label>
    <select id="fixtureScenario" style="margin:12px">
      <option value="normal">正常更新</option><option value="checksum">下载内容损坏</option>
      <option value="apply-failure">写入文件被占用</option><option value="offline">GitHub 不可用</option>
    </select>'''
    dashboard = (fixture / 'index.html').read_text(encoding='utf-8')
    dashboard = dashboard.replace('<head>', '<head>' + shim, 1).replace('<body>', '<body>' + controls, 1)
    (fixture / 'index.html').write_text(dashboard, encoding='utf-8')
    contents = {'assets/update-fixture-new.js': '// browser fixture updated\n'}
    for name in ['api/app-update.php', 'api/app-update-policy.php', 'assets/update/update-check.js']:
        contents[name] = (fixture / name).read_text(encoding='utf-8') + '\n// browser fixture version\n'
    files = [{'filename': name, 'status': 'modified', 'sha': hashlib.sha1(
        b'blob ' + str(len(text.encode())).encode() + b'\0' + text.encode()).hexdigest()} for name, text in contents.items()]
    files.append({'filename': 'assets/update-fixture-old.js', 'status': 'removed'})
    blocked = b'// blocked\n'
    manifest = {'contents': contents, 'files': files, 'blocked': {
        'filename': 'assets/update-fixture-blocked.js', 'status': 'added',
        'sha': hashlib.sha1(b'blob ' + str(len(blocked)).encode() + b'\0' + blocked).hexdigest()}}
    (fixture / 'data/fixture.json').write_text(json.dumps(manifest), encoding='utf-8')
    (fixture / 'fixture.php').write_text('''<?php
    $fixture = json_decode(file_get_contents(__DIR__ . '/data/fixture.json'), true);
    $kind = $_GET['kind'] ?? '';
    $scenario = $_GET['scenario'] ?? 'normal';
    header('Cache-Control: no-store');
    if ($scenario === 'offline') { http_response_code(503); echo '{}'; exit; }
    if ($kind === 'raw') {
      $path = $_GET['path'] ?? '';
      if ($scenario === 'checksum') { echo 'broken fixture content'; exit; }
      echo $path === 'assets/update-fixture-blocked.js' ? "// blocked\\n" : ($fixture['contents'][$path] ?? '');
      exit;
    }
    header('Content-Type: application/json');
    if ($kind === 'release') { echo json_encode(['tag_name'=>'v9.9.9', 'body'=>'隔离测试版本：下载、校验、写入、删除、自更新、还原。']); exit; }
    $files = $fixture['files'];
    if ($scenario === 'apply-failure') $files[] = $fixture['blocked'];
    echo json_encode(['status'=>'ahead','files'=>$files]);
    ''', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = (fixture / 'server.log').open('wb')
    server = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(fixture), str(fixture / 'router.php')],
        cwd=fixture, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        for _ in range(50):
            try:
                request = urllib.request.Request(f'http://127.0.0.1:{port}/api/campaign-state.php?action=register',
                    data=json.dumps({'username':'browser_fixture', 'password':'fixture-only'}).encode(),
                    headers={'Content-Type':'application/json'})
                urllib.request.urlopen(request, timeout=3).close()
                break
            except OSError:
                time.sleep(.1)
        print(json.dumps({'root':str(fixture),'url':f'http://127.0.0.1:{port}/', 'pid':server.pid}), flush=True)
        server.wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.terminate()
        server.wait(timeout=10)
        log.close()


if __name__ == '__main__':
    main()
