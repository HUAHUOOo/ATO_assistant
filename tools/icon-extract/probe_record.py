#!/usr/bin/env python3
"""Render the record page in Chrome and report JS errors + rendered item icons.

The runtime item icons are built by JavaScript, so a screenshot alone cannot tell
whether the hook threw.  This injects an error collector, counts the icon elements
that actually made it into the DOM, and dumps the result out of --dump-dom.
"""
from __future__ import annotations

import json
import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
PROBE = ROOT / "record" / "_probe.html"
SHOT = ROOT / "tools" / "icon-extract" / "record-render.png"
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

EARLY_SCRIPT = """
<script>
window.__errs = [];
window.addEventListener('error', function (e) {
  window.__errs.push(String(e.message) + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
});
</script>
</head>"""

SCRIPT = """
<script>
window.__cycle = %(cycle)s;
window.addEventListener('load', function () {
  setTimeout(function () {
    if (window.__cycle) {
      var sel = document.querySelector('#cycleSelect');
      if (sel) {
        sel.value = window.__cycle;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    setTimeout(measure, window.__cycle ? 1200 : 0);
  }, 600);

  function measure() {
    function q(s) { return document.querySelectorAll(s).length; }
    var out = {
      errors: window.__errs,
      itemIcon: q('svg.item-icon'),
      itemLabel: q('.item-label'),
      trackIcon: q('svg.track-item-icon'),
      trackWithIcon: q('.track-name.with-icon'),
      crewWithIcon: q('.crew-counter-label.with-icon'),
      itemIconsJsLoaded: typeof window.RECORD_ITEM_ICONS === 'object'
                          && Object.keys(window.RECORD_ITEM_ICONS || {}).length,
      hullTitle: (function () {
        var el = document.querySelector('#hullTrack .track-name');
        return el ? el.outerHTML.slice(0, 260) : '(no #hullTrack .track-name)';
      })(),
      trackNames: (function () {
        var out = [];
        document.querySelectorAll('.track-name').forEach(function (el) {
          out.push((el.textContent || '').trim().slice(0, 8)
                   + '|svg=' + el.querySelectorAll('svg.track-item-icon').length
                   + '|img=' + el.querySelectorAll('img').length);
        });
        return out;
      })(),
      sample: []
    };
    document.querySelectorAll('.item-label').forEach(function (el) {
      var svg = el.querySelector('svg.item-icon');
      if (!svg) return;
      var sr = svg.getBoundingClientRect();
      var tr = document.createRange();
      tr.selectNodeContents(el);
      var rr = tr.getBoundingClientRect();
      out.sample.push({
        text: el.textContent.trim(),
        iconCy: +(sr.y + sr.height / 2).toFixed(2),
        wrapCy: +(rr.y + rr.height / 2).toFixed(2),
        w: +sr.width.toFixed(1), h: +sr.height.toFixed(1)
      });
    });
    var pre = document.createElement('pre');
    pre.id = 'probe';
    pre.textContent = 'PROBE_JSON_START' + JSON.stringify(out) + 'PROBE_JSON_END';
    document.body.appendChild(pre);
  }
});
</script>
</body>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cycle", choices=["c1", "c2", "c3", "c4", "c5"],
                    help="switch to this cycle before measuring (fields are cycle-gated)")
    args = ap.parse_args()

    html = PAGE.read_text(encoding="utf-8")
    # the error listener has to exist *before* the page's own inline script runs,
    # otherwise a parse error there goes unnoticed
    html = html.replace("</head>", EARLY_SCRIPT, 1)
    html = html.replace("</body>",
                        SCRIPT % {"cycle": json.dumps(args.cycle)}, 1)
    PROBE.write_text(html, encoding="utf-8")
    try:
        chrome = next(b for b in BROWSERS if Path(b).exists())
        common = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                  "--window-size=1500,2600"]
        r = subprocess.run(common + ["--virtual-time-budget=6000", "--dump-dom",
                                     PROBE.as_uri()],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        subprocess.run(common + ["--hide-scrollbars", "--virtual-time-budget=6000",
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
        if PROBE.exists():
            print(f"warning: could not remove {PROBE}", file=sys.stderr)

    print(f"RECORD_ITEM_ICONS entries : {data['itemIconsJsLoaded']}")
    print(f".item-label spans         : {data['itemLabel']}")
    print(f"svg.item-icon rendered    : {data['itemIcon']}")
    print(f"svg.track-item-icon       : {data['trackIcon']} "
          f"(titles with icon: {data['trackWithIcon']}, "
          f"crew counters: {data['crewWithIcon']})")
    if data["errors"]:
        print("\nJS ERRORS:")
        for e in data["errors"]:
            print("   ", e)
    else:
        print("\nno JS errors")
    print("\n#hullTrack .track-name:")
    print("   ", data.get("hullTitle"))
    print("\n.track-name entries:")
    for t in data.get("trackNames", []):
        print("   ", t)
    print(f"\n{'label':<14}{'icon cy':>9}{'wrap cy':>9}{'Δ':>7}{'size':>12}")
    for s in data["sample"]:
        print(f"  {s['text']:<12}{s['iconCy']:>9.2f}{s['wrapCy']:>9.2f}"
              f"{s['iconCy'] - s['wrapCy']:>7.2f}   {s['w']}x{s['h']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
