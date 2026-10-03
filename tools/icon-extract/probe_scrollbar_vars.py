#!/usr/bin/env python3
"""What does the scroller's scrollbar actually resolve to?"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"D:\desktop\ATO_assistant")
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var el = document.querySelector('.diplomacy-scale');
    var cs = getComputedStyle(el);
    var vars = {};
    ['--line-strong', '--line', '--accent', '--accent-strong', '--muted', '--panel']
      .forEach(function (v) { vars[v] = cs.getPropertyValue(v).trim(); });
    var out = {
      scrollbarColor: cs.scrollbarColor,
      scrollbarWidth: cs.scrollbarWidth,
      vars: vars,
      barH: el.offsetHeight - el.clientHeight,
      ua: navigator.userAgent
    };
    var pre = document.createElement('pre');
    pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
    document.body.appendChild(pre);
  }, 1200);
});
</script></body>"""


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

    print("scrollbar-color :", data["scrollbarColor"])
    print("scrollbar-width :", data["scrollbarWidth"])
    print("bar height      :", data["barH"], "px")
    print("vars:")
    for k, v in data["vars"].items():
        print(f"   {k:16s} {v}")
    print("ua:", data["ua"][:90])
    return 0


if __name__ == "__main__":
    sys.exit(main())
