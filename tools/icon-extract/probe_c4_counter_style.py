#!/usr/bin/env python3
"""Compare the C4 VI counter chip's box/typography with the level chip before it,
and confirm it lights up (.active) once it holds a count."""
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
      function info(row) {
        var c = row.querySelector('.counter-chip');
        var chips = row.querySelectorAll('.chip');
        var prev = chips[chips.length - 2];
        if (!c || !prev) return null;
        var cs = getComputedStyle(c);
        var l = getComputedStyle(c.querySelector('.counter-chip-label'));
        var val = c.querySelector('.counter-chip-value');
        // 计数为 0 时没有数字 span，别对它取计算样式（会抛异常，整个探针就没输出了）
        var v = val ? getComputedStyle(val) : null;
        var pc = getComputedStyle(prev);
        return {
          cls: c.className, text: c.textContent, hasValue: Boolean(val),
          w: Math.round(c.getBoundingClientRect().width),
          prevW: Math.round(prev.getBoundingClientRect().width),
          labelSize: l.fontSize,
          valueSize: v ? v.fontSize : null,
          prevSize: pc.fontSize,
          bg: cs.backgroundColor, color: cs.color,
          prevBg: pc.backgroundColor
        };
      }
      var rows = document.querySelectorAll('#enemyTracks .track-row');
      var out = { before: info(rows[0]) };
      rows[0].querySelector('.counter-chip').click();
      var rows2 = document.querySelectorAll('#enemyTracks .track-row');
      out.after = info(rows2[0]);
      out.second = info(rows2[1]);
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
        r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                            "--window-size=1500,2200", "--virtual-time-budget=9000",
                            "--dump-dom", PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        dump = r.stdout or ""
        s = dump.rfind("PROBE_JSON_START")
        e = dump.find("PROBE_JSON_END", s + 1)
        data = json.loads(dump[s + len("PROBE_JSON_START"):e])
    finally:
        for _ in range(10):
            try:
                PROBE.unlink(missing_ok=True); break
            except PermissionError:
                time.sleep(0.3)

    for key in ("before", "after", "second"):
        v = data[key]
        if not v:
            print(f"{key}: (no counter chip)")
            continue
        print(f"{key:7s} text={v['text']!r:7s} w={v['w']} (prev {v['prevW']})  "
              f"VI={v['labelSize']} value={v['valueSize']} (prev chip {v['prevSize']})")
        print(f"        bg={v['bg']} color={v['color']} (prev bg {v['prevBg']})")
        print(f"        class={v['cls']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
