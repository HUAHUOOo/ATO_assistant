#!/usr/bin/env python3
"""Exercise the C4 shared VI counter: click it, and check both boss rows agree."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
SHOT = ROOT / "tools" / "icon-extract" / "c4-counter.png"
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT = """
<script>
window.__errs = [];
window.addEventListener('error', function (e) {
  window.__errs.push(String(e.message) + ' @' + (e.lineno || 0));
});
function rowInfo(row) {
  var chips = [].map.call(row.querySelectorAll('.chip'), function (c) {
    return c.classList.contains('counter-chip') ? '[' + c.textContent + ']' : c.textContent;
  });
  return { name: (row.querySelector('.track-name') || {}).textContent,
           chips: chips.join(' '),
           counter: (function () {
             var c = row.querySelector('.counter-chip');
             return c ? c.textContent : null;
           })() };
}
window.addEventListener('load', function () {
  setTimeout(function () {
    var sel = document.querySelector('#cycleSelect');
    sel.value = 'c4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      var rows = document.querySelectorAll('#enemyTracks .track-row');
      var a = rows[0], b = rows[1];
      var before = [rowInfo(a), rowInfo(b)];
      // 计数器有门控：前面的等级格没全部点亮时点不动，所以先把第一行点亮
      var n = document.querySelectorAll('#enemyTracks .track-row')[0]
                .querySelectorAll('.chip').length - 1;
      for (var k = 0; k < n; k++) {
        document.querySelectorAll('#enemyTracks .track-row')[0]
                .querySelectorAll('.chip')[k].click();
      }
      var gateOpen = !document.querySelectorAll('#enemyTracks .track-row')[0]
                        .querySelector('.counter-chip').disabled;
      // click the counter on the FIRST boss twice, then read the SECOND boss
      var ca = document.querySelectorAll('#enemyTracks .track-row')[0]
                 .querySelector('.counter-chip');
      ca.click();
      ca = document.querySelectorAll('#enemyTracks .track-row')[0].querySelector('.counter-chip');
      ca.click();
      var rows2 = document.querySelectorAll('#enemyTracks .track-row');
      var after = [rowInfo(rows2[0]), rowInfo(rows2[1])];
      // right-click on the SECOND boss's counter should drop both back to 1
      var cb = rows2[1].querySelector('.counter-chip');
      cb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      var rows3 = document.querySelectorAll('#enemyTracks .track-row');
      var afterRight = [rowInfo(rows3[0]), rowInfo(rows3[1])];
      var stored = {};
      try {
        stored = JSON.parse(localStorage.getItem('ato-argo-record-sheet-v1') || '{}');
      } catch (e) {}
      var counterKeys = Object.keys(stored.enemies || {}).filter(function (k) {
        return k.indexOf(':6') !== -1;
      });
      var out = {
        errors: window.__errs,
        gateOpen: gateOpen,
        rowCount: rows.length,
        before: before,
        after: after,
        afterRight: afterRight,
        counterKeys: counterKeys,
        counterValues: counterKeys.map(function (k) { return stored.enemies[k]; })
      };
      var pre = document.createElement('pre');
      pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
      document.body.appendChild(pre);
    }, 900);
  }, 700);
});
</script>
</body>"""


def main() -> int:
    html = PAGE.read_text(encoding="utf-8").replace("</body>", SCRIPT, 1)
    PROBE.write_text(html, encoding="utf-8", newline="\r\n")
    try:
        chrome = next(b for b in BROWSERS if Path(b).exists())
        common = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                  "--window-size=1500,2200"]
        r = subprocess.run(common + ["--virtual-time-budget=9000", "--dump-dom",
                                     PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        subprocess.run(common + ["--hide-scrollbars", "--virtual-time-budget=9000",
                                 f"--screenshot={SHOT}", PROBE.as_uri()],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=180)
        dump = r.stdout or ""
        s = dump.rfind("PROBE_JSON_START")
        e = dump.find("PROBE_JSON_END", s + 1)
        if s == -1 or e == -1:
            print("probe did not run", file=sys.stderr)
            return 1
        data = json.loads(dump[s + len("PROBE_JSON_START"):e])
    finally:
        for _ in range(10):
            try:
                PROBE.unlink(missing_ok=True); break
            except PermissionError:
                time.sleep(0.3)

    print(f"JS errors     : {data['errors'] or 'none'}")
    print(f"enemy rows    : {data['rowCount']}")
    for label in ("before", "after", "afterRight"):
        print(f"\n{label}:")
        for r in data[label]:
            print(f"   {r['name'][:14]:16s} counter={r['counter']}  chips: {r['chips']}")
    print(f"\nstored counter keys : {data['counterKeys']}")
    print(f"stored values       : {data['counterValues']}")
    print(f"wrote {SHOT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
