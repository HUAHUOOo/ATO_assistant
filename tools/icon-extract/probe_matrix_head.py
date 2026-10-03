#!/usr/bin/env python3
"""Measure the .matrix-head bar and a .panel-heading bar straight from the DOM."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    function info(sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var h2 = el.querySelector('h2');
      var h2r = h2 ? h2.getBoundingClientRect() : null;
      return {
        sel: sel,
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left),
        width: Math.round(r.width),
        barH: Math.round(r.height * 100) / 100,
        pad: cs.paddingTop + ' / ' + cs.paddingBottom,
        borderB: cs.borderBottomWidth,
        display: cs.display,
        bg: cs.backgroundColor,
        h2Size: h2 ? getComputedStyle(h2).fontSize : null,
        h2H: h2r ? Math.round(h2r.height * 100) / 100 : null,
        before: getComputedStyle(el, '::before').content,
        beforeH: getComputedStyle(el, '::before').fontSize
      };
    }
    var out = {
      matrix: info('.matrix-head'),
      compact: info('.panel-heading.compact'),
      matchers: [].map.call(document.styleSheets, function (s) {
        var n = 0;
        try { n = s.cssRules.length; } catch (e) { return 'x'; }
        return (s.href ? s.href.split('/').pop() : 'inline') + ':' + n;
      })
    };
    var pre = document.createElement('pre');
    pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
    document.body.appendChild(pre);
  }, 1200);
});
</script>
</body>"""


def main() -> int:
    html = PAGE.read_text(encoding="utf-8").replace("</body>", SCRIPT, 1)
    PROBE.write_text(html, encoding="utf-8", newline="\r\n")
    try:
        chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                            "--window-size=1500,3000", "--virtual-time-budget=8000",
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

    print("stylesheets:", data["matchers"])
    for key in ("matrix", "compact"):
        d = data[key]
        if not d:
            print(f"{key}: (not found)"); continue
        print(f"\n{key}: {d['sel']}")
        for k in ("top", "left", "width", "barH", "pad", "borderB", "display", "bg",
                  "h2Size", "h2H", "before", "beforeH"):
            print(f"   {k:9s} {d[k]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
