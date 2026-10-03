#!/usr/bin/env python3
"""Fill the 收割 dropdown with many entries and see how the panel behaves."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
SHOT = ROOT / "tools" / "icon-extract" / "mark-notes-many.png"
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENTRIES = ["给v人的分隔符", "纷纷", "分发", "第四条", "第五条",
           "第六条", "第七条", "第八条"]

SCRIPT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var sel = document.querySelector('#cycleSelect');
    sel.value = 'c4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      var details = document.querySelector('[data-mark-notes="reapMarkNotes"]');
      var form = details.querySelector('.identity-mark-notes-add');
      var text = form.querySelector('input[type="text"]');
      var list = ENTRY_JSON;
      list.forEach(function (v) {
        text.value = v;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      details.open = true;
      setTimeout(function () {
        var panel = details.querySelector('.identity-mark-notes-panel');
        var ul = details.querySelector('.identity-mark-notes-list');
        var host = details.closest('.panel');
        function r(el) {
          if (!el) return null;
          var b = el.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom),
                   h: Math.round(b.height) };
        }
        var chain = [];
        for (var n = details; n && n !== document.body; n = n.parentElement) {
          var b = n.getBoundingClientRect();
          chain.push(n.tagName.toLowerCase() + '.' + (n.className || '-')
                     + ' @' + Math.round(b.top) + '-' + Math.round(b.bottom)
                     + ' ov=' + getComputedStyle(n).overflow);
        }
        var panels = [].map.call(document.querySelectorAll('.panel'), function (p) {
          var b = p.getBoundingClientRect();
          return Math.round(b.top) + '-' + Math.round(b.bottom)
                 + ' h' + Math.round(b.height)
                 + ' ' + (p.querySelector('h2') ? p.querySelector('h2').textContent.slice(0, 8) : '?');
        });
        var out = {
          chain: chain,
          panels: panels,
          panel: r(panel),
          panelClass: panel.className,
          details: r(details),
          hostPanel: r(host),
          hostOverflow: host ? getComputedStyle(host).overflow : null,
          list: { top: Math.round(ul.getBoundingClientRect().top),
                  bottom: Math.round(ul.getBoundingClientRect().bottom),
                  h: Math.round(ul.getBoundingClientRect().height),
                  scrollTop: ul.scrollTop, scrollH: ul.scrollHeight,
                  clientH: ul.clientHeight },
          viewportH: window.innerHeight,
          pageY: Math.round(window.scrollY),
          items: ul.children.length
        };
        var pre = document.createElement('pre');
        pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
        document.body.appendChild(pre);
      }, 500);
    }, 900);
  }, 700);
});
</script>
</body>"""


def main() -> int:
    html = PAGE.read_text(encoding="utf-8")
    html = html.replace("</body>", SCRIPT.replace("ENTRY_JSON", json.dumps(ENTRIES)), 1)
    PROBE.write_text(html, encoding="utf-8", newline="\r\n")
    try:
        common = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                  "--window-size=1500,900"]
        r = subprocess.run(common + ["--virtual-time-budget=12000", "--dump-dom",
                                     PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        subprocess.run(common + ["--hide-scrollbars", "--virtual-time-budget=12000",
                                 f"--screenshot={SHOT}", PROBE.as_uri()],
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

    print(f"viewport height : {data['viewportH']}  (page scrolled {data['pageY']}px)")
    print(f"items           : {data['items']}")
    print(f"details (button): {data['details']}")
    print("\nancestor chain:")
    for c in data["chain"]:
        print("   ", c)
    print("\npanels:")
    for p in data["panels"]:
        print("   ", p)
    print(f"\nhost .panel     : {data['hostPanel']}  overflow={data['hostOverflow']}")
    print(f"panel           : {data['panel']}  class={data['panelClass']!r}")
    print(f"list            : h={data['list']['h']} scrollH={data['list']['scrollH']} "
          f"clientH={data['list']['clientH']} "
          f"clipped={data['list']['scrollH'] > data['list']['clientH']}")
    if data["panel"] and data["hostPanel"]:
        print(f"panel above host top   : {data['panel']['top'] < data['hostPanel']['top']}")
        print(f"panel below viewport   : {data['panel']['bottom'] > data['viewportH']}")
    print(f"wrote {SHOT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
