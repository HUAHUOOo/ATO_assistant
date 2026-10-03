#!/usr/bin/env python3
"""Exercise the 收割/播种 record dropdown in a real browser and screenshot it.

Switches to cycle IV (the only cycle that shows those fields), types two entries
into the 收割 dropdown through the widget's own form, opens it, and reads back
what landed in the hidden input the page saves from.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
SHOT = ROOT / "tools" / "icon-extract" / "mark-notes.png"
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
window.addEventListener('load', function () {
  setTimeout(function () {
    var sel = document.querySelector('#cycleSelect');
    sel.value = 'c4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      var details = document.querySelector('[data-mark-notes="reapMarkNotes"]');
      var form = details.querySelector('.identity-mark-notes-add');
      var text = form.querySelector('input[type="text"]');
      ['船骸水域', '商队补给站'].forEach(function (v) {
        text.value = v;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      details.open = true;
      var store = document.querySelector('[data-cycle-bind="reapMarkNotes"]');
      function box(sel) {
        var el = document.querySelector(sel);
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { top: Math.round(r.top), cy: Math.round(r.top + r.height / 2) };
      }
      var out = {
        errors: window.__errs,
        stored: store ? store.value : null,
        items: [].map.call(details.querySelectorAll('.identity-mark-notes-list li span'),
                           function (s) { return s.textContent; }),
        names: [].map.call(document.querySelectorAll('.identity-mark-name'),
                           function (e) { return e.textContent.trim(); }),
        countInputs: document.querySelectorAll(
          '[data-cycle-bind="reapMark"], [data-cycle-bind="sowMark"]').length,
        rows: {
          fate: box('[data-cycle-bind="fate"]'),
          reap: box('.identity-mark-field:nth-of-type(1)'),
          sow: box('.identity-mark-field:nth-of-type(2)')
        },
        reopenSame: (function () {
          details.open = false; details.open = true;
          return [].map.call(details.querySelectorAll('.identity-mark-notes-list li span'),
                             function (s) { return s.textContent; }).join('|');
        })()
      };
      // leave the dropdown closed so the screenshot shows the settled row
      details.open = false;
      var pre = document.createElement('pre');
      pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
      document.body.appendChild(pre);
    }, 900);
  }, 700);
});
</script>
</body>"""


def main() -> int:
    html = PAGE.read_text(encoding="utf-8")
    html = html.replace("</body>", SCRIPT, 1)
    PROBE.write_text(html, encoding="utf-8", newline="\r\n")
    try:
        chrome = next(b for b in BROWSERS if Path(b).exists())
        common = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                  "--window-size=1500,1400"]
        r = subprocess.run(common + ["--virtual-time-budget=8000", "--dump-dom",
                                     PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        subprocess.run(common + ["--hide-scrollbars", "--virtual-time-budget=8000",
                                 f"--screenshot={SHOT}", PROBE.as_uri()],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=180)
        dump = r.stdout or ""
        start = dump.rfind("PROBE_JSON_START")
        end = dump.find("PROBE_JSON_END", start + 1) if start != -1 else -1
        if start == -1 or end == -1:
            print("probe did not run", file=sys.stderr)
            return 1
        data = json.loads(dump[start + len("PROBE_JSON_START"):end])
    finally:
        for _ in range(10):
            try:
                PROBE.unlink(missing_ok=True); break
            except PermissionError:
                time.sleep(0.3)

    print(f"JS errors          : {data['errors'] or 'none'}")
    print(f"field names        : {data['names']}")
    print(f"leftover count inputs (reapMark/sowMark): {data['countInputs']}")
    print(f"hidden input value : {data['stored']!r}")
    print(f"list items         : {data['items']}")
    print(f"reopened items     : {data['reopenSame']!r}")
    rows = data["rows"]
    cys = [rows[k]["cy"] for k in rows]
    print(f"vertical centres   : fate={rows['fate']['cy']} "
          f"收割={rows['reap']['cy']} 播种={rows['sow']['cy']}"
          f"  -> same row: {max(cys) - min(cys) <= 2} (spread {max(cys) - min(cys)}px)")
    print(f"wrote {SHOT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
