#!/usr/bin/env python3
"""Check the C4 VI counter's gate: adding needs every preceding level chip lit,
subtracting (right click) does not."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for cand in [here.parent, *here.parents]:
        if (cand / "record" / "index.html").exists():
            return cand
    raise SystemExit("repo root not found")


ROOT = repo_root()
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var sel = document.querySelector('#cycleSelect');
    sel.value = 'c4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      function rows() { return document.querySelectorAll('#enemyTracks .track-row'); }
      function chip(i) { return rows()[i].querySelector('.counter-chip'); }
      function read(i) {
        var c = chip(i);
        return {
          text: c.textContent,
          locked: c.classList.contains('counter-locked'),
          aria: c.getAttribute('aria-disabled'),
          title: c.title
        };
      }
      function lit(i) {
        var n = 0;
        rows()[i].querySelectorAll('.chip').forEach(function (c) {
          if (c.classList.contains('active')) n++;
        });
        return n;
      }
      function clickAll(i) {
        var n = rows()[i].querySelectorAll('.chip').length - 1;
        for (var k = 0; k < n; k++) {
          rows()[i].querySelectorAll('.chip')[k].click();
        }
      }
      function rightClick(i) {
        chip(i).dispatchEvent(new MouseEvent('contextmenu',
          { bubbles: true, cancelable: true }));
      }
      var log = [];
      log.push({ step: '0 initial', lit: lit(0), r0: read(0), r1: read(1) });

      chip(0).click();
      log.push({ step: '1 left-click while locked', lit: lit(0), r0: read(0), r1: read(1) });

      clickAll(0);
      log.push({ step: '2 all levels lit', lit: lit(0), r0: read(0), r1: read(1) });

      chip(0).click();
      chip(0).click();
      log.push({ step: '3 left-click x2', lit: lit(0), r0: read(0), r1: read(1) });

      rows()[0].querySelectorAll('.chip')[0].click();
      log.push({ step: '4 one level unlit', lit: lit(0), r0: read(0), r1: read(1) });

      chip(0).click();
      log.push({ step: '5 left-click while locked', lit: lit(0), r0: read(0), r1: read(1) });

      rightClick(0);
      log.push({ step: '6 right-click while locked', lit: lit(0), r0: read(0), r1: read(1) });

      rightClick(1);
      log.push({ step: '7 right-click row1 locked', lit: lit(1), r0: read(0), r1: read(1) });

      var pre = document.createElement('pre');
      pre.textContent = 'PROBE_JSON_START' + JSON.stringify(log) + 'PROBE_JSON_END';
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
        r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                            "--window-size=1500,2200", "--virtual-time-budget=12000",
                            "--dump-dom", PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        dump = r.stdout or ""
        s = dump.rfind("PROBE_JSON_START")
        e = dump.find("PROBE_JSON_END", s + 1)
        log = json.loads(dump[s + len("PROBE_JSON_START"):e])
    finally:
        for _ in range(10):
            try:
                PROBE.unlink(missing_ok=True); break
            except PermissionError:
                time.sleep(0.3)

    print(f"{'step':28s} {'lit':>3}  {'row0':^18} {'row1':^18}")
    for entry in log:
        a, b = entry["r0"], entry["r1"]
        def fmt(d):
            return f"{d['text']:>4} {'LOCKED' if d['locked'] else 'open':6s}"
        print(f"{entry['step']:28s} {entry['lit']:>3}  {fmt(a):18s} {fmt(b):18s}")
    print("\nrow0 title at the end:", log[-1]["r0"]["title"])
    print("row0 aria-disabled :", log[-1]["r0"]["aria"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
