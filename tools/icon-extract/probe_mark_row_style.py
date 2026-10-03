#!/usr/bin/env python3
"""Compare the 巴比伦债务 label's typography with 收割/播种, and list the grid order."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

def _repo_root() -> Path:
    """向上找到含 record/index.html 的目录，别写死 parents[N]（目录被搬过好几次）。"""
    here = Path(__file__).resolve()
    for cand in [here.parent, *here.parents]:
        if (cand / "record" / "index.html").exists():
            return cand
    raise SystemExit("could not locate the repo root")


ROOT = _repo_root()
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
      function css(el) {
        if (!el) return null;
        var c = getComputedStyle(el);
        return {
          text: (el.textContent || '').trim().slice(0, 8),
          font: c.fontFamily.split(',')[0].replace(/"/g, ''),
          size: c.fontSize, weight: c.fontWeight,
          color: c.color, letterSpacing: c.letterSpacing
        };
      }
      var order = [].map.call(
        document.querySelectorAll('#identityGridPanel > *'),
        function (el) {
          var name = (el.querySelector('.item-label') || el).textContent.trim().slice(0, 10);
          return el.tagName.toLowerCase() + ':' + (el.getAttribute('data-cycle-field') || '-')
                 + ':' + name;
        });
      var out = {
        order: order,
        babelianLabel: css(document.querySelector('[data-cycle-bind="babelianDebt"]')
                           .closest('label').querySelector('.item-label')),
        babelianPlain: css(document.querySelector('[data-cycle-bind="aaLimit"]')
                           .closest('label')),
        markName: css(document.querySelector('.identity-mark-name')),
        markSummary: css(document.querySelector('.identity-mark-notes > summary')),
        fateLabel: css(document.querySelector('[data-cycle-bind="fate"]')
                       .closest('label').querySelector('.item-label'))
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
        r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                            "--window-size=1500,1400", "--virtual-time-budget=9000",
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

    print("identity grid order:")
    for i, o in enumerate(data["order"]):
        print(f"   {i:2d}  {o}")
    print()
    for key in ("babelianLabel", "fateLabel", "babelianPlain", "markName", "markSummary"):
        d = data[key]
        if not d:
            print(f"{key}: (not found)"); continue
        print(f"{key:15s} {d['text']!r:12s} font={d['font']:<20} size={d['size']:<6} "
              f"weight={d['weight']:<4} color={d['color']} ls={d['letterSpacing']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
