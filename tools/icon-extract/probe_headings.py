#!/usr/bin/env python3
"""Measure the record page's module headings in a real browser.

Writes a probe copy of record/index.html with a small measuring script appended,
renders it with headless Chrome, and reads back each heading's box plus the icon
box, the text's own ink box, and their vertical centres.  That is the only way to
tell whether the icon and the label are actually centred on each other.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var out = [];
    var sels = '.panel-heading, .titan-list-head, .matrix-head';
    document.querySelectorAll(sels).forEach(function (el) {
      var er = el.getBoundingClientRect();
      var svg = el.querySelector('svg.panel-icon');
      var h = el.querySelector('h2, strong') || el;
      var rec = {cls: el.className, raw: (el.textContent || '').trim().slice(0, 14),
                 head: [er.x, er.y, er.width, er.height]};
      if (svg) {
        var s = svg.getBoundingClientRect();
        rec.icon = [s.x, s.y, s.width, s.height];
      }
      var range = document.createRange(), tr = null;
      for (var i = 0; i < h.childNodes.length; i++) {
        var n = h.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) {
          range.selectNodeContents(n); tr = range.getBoundingClientRect(); break;
        }
      }
      rec.text = tr ? [tr.x, tr.y, tr.width, tr.height] : null;
      var cs = getComputedStyle(h);
      rec.font = cs.fontFamily.slice(0, 40) + ' / ' + cs.fontSize;
      out.push(rec);
    });
    var pre = document.createElement('pre');
    pre.id = 'probe-out';
    pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
    document.body.appendChild(pre);
  }, 1200);
});
</script>
</body>"""


def main() -> int:
    html = PAGE.read_text(encoding="utf-8")
    PROBE.write_text(html.replace("</body>", SCRIPT, 1), encoding="utf-8")
    shot = ROOT / "tools" / "icon-extract" / "record-render.png"
    size = "1500,2600"
    dpr = 2                      # screenshot pixels per CSS pixel
    try:
        chrome = next(b for b in BROWSERS if Path(b).exists())
        common = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                  f"--window-size={size}", f"--force-device-scale-factor={dpr}"]
        r = subprocess.run(common + ["--virtual-time-budget=6000", "--dump-dom",
                                     PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        # same window size as the measurement run, so coordinates line up
        subprocess.run(common + ["--hide-scrollbars", "--virtual-time-budget=6000",
                                 f"--screenshot={shot}", PROBE.as_uri()],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=180)
        # the injected <script> itself contains those marker strings, so take the
        # LAST occurrence -- that is the <pre> the probe appended to the body
        dump = r.stdout or ""
        start = dump.rfind("PROBE_JSON_START")
        end = dump.find("PROBE_JSON_END", start + 1) if start != -1 else -1
        if start == -1 or end == -1:
            print("probe did not run", file=sys.stderr)
            print(dump[-1500:], file=sys.stderr)
            return 1
        raw = dump[start + len("PROBE_JSON_START"):end]
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            (ROOT / "tools" / "icon-extract" / "probe-raw.txt").write_text(raw, encoding="utf-8")
            print(f"could not parse probe JSON; raw head:\n{raw[:400]}", file=sys.stderr)
            return 1
    finally:
        # Chrome may still hold the file open for a moment; a leftover _probe.html
        # would otherwise sit inside record/ and show up in git status
        for _ in range(10):
            try:
                PROBE.unlink(missing_ok=True)
                break
            except PermissionError:
                time.sleep(0.3)
        if PROBE.exists():
            print(f"warning: could not remove {PROBE}", file=sys.stderr)

    print(f"{'heading':<14}{'icon cy':>9}{'text cy':>9}{'Δ':>7}  {'icon h':>7}{'text h':>7}  font")
    worst = 0.0
    for rec in data:
        if not rec.get("icon") or not rec.get("text"):
            print(f"  {rec['raw']:<12} (no icon or no text box)")
            continue
        iy = rec["icon"][1] + rec["icon"][3] / 2
        ty = rec["text"][1] + rec["text"][3] / 2
        d = iy - ty
        worst = max(worst, abs(d))
        print(f"  {rec['raw']:<12}{iy:>9.2f}{ty:>9.2f}{d:>7.2f}  "
              f"{rec['icon'][3]:>7.2f}{rec['text'][3]:>7.2f}  {rec['font']}")
    print(f"\nlargest |icon centre - text centre| = {worst:.2f}px")
    (ROOT / "tools" / "icon-extract" / "probe-boxes.json").write_text(
        json.dumps({"dpr": dpr, "boxes": data}, indent=2), encoding="utf-8")
    print("wrote probe-boxes.json (run heading_align.py for the ink centres)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
