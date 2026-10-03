#!/usr/bin/env python3
"""C4: drop the 收割/播种 counters and put their record dropdowns on the fate row.

The two used to be a `.identity-mark-row` of their own at the bottom of the
identity grid, each with a number input plus a notes control.  Now they are just
two dropdowns, sitting right after 阿尔戈号命运 in source order so the flex grid
flows them onto that row.  The counting state (reapMark / sowMark) goes away with
the inputs, like 补给 did.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

html = PAGE.read_text(encoding="utf-8")
before = len(html)


def once(old: str, new: str, what: str) -> None:
    global html
    n = html.count(old)
    if n != 1:
        raise SystemExit(f"{what}: matched {n}x, expected 1\n  {old[:90]!r}")
    html = html.replace(old, new, 1)


# ---------------------------------------------------------------- markup
row = re.compile(r'\n *<div class="identity-mark-row".*?\n *</div>(?=\n)', re.S)
found = row.findall(html)
if len(found) != 1:
    raise SystemExit(f"identity-mark-row matched {len(found)}x")
html = html.replace(found[0], "", 1)


def field(name: str, bind: str) -> str:
    return f"""
            <div class="identity-mark-field" data-cycle-field="c4">
              <span class="identity-mark-name">{name}</span>
              <input type="hidden" data-cycle-bind="{bind}">
              <details class="identity-mark-notes" data-mark-notes="{bind}">
                <summary aria-label="{name}记录">记录</summary>
                <div class="identity-mark-notes-panel">
                  <p class="identity-mark-notes-empty">还没有记录</p>
                  <ul class="identity-mark-notes-list"></ul>
                  <form class="identity-mark-notes-add">
                    <input type="text" placeholder="名称或说明" aria-label="{name}记录条目">
                    <button type="submit">添加</button>
                  </form>
                </div>
              </details>
            </div>"""


once('<input data-cycle-bind="fate" type="number" min="0" max="12">\n            </label>',
     '<input data-cycle-bind="fate" type="number" min="0" max="12">\n            </label>'
     + field("收割", "reapMarkNotes") + field("播种", "sowMarkNotes"),
     "fate label")

# ---------------------------------------------------------------- state
once('"reapMark", "reapMarkNotes", "sowMark", "sowMarkNotes", "paranoia",',
     '"reapMarkNotes", "sowMarkNotes", "paranoia",', "cycleIdentityKeys")
once('      reapMark: "",\n', "", "defaultState reapMark")
once('      sowMark: "",\n', "", "defaultState sowMark")
once('        reapMark: { min: 0, max: null },\n', "", "number config reapMark")
once('        sowMark: { min: 0, max: null },\n', "", "number config sowMark")

# ---------------------------------------------------------------- css
once("""    .identity-mark-row {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(2, max-content);
      gap: 16px;
      align-items: center;
      min-width: 0;
    }

    .identity-mark-field {
      display: grid;
      grid-template-columns: max-content 100px;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }

    .identity-mark-field > label {
      display: grid;
      grid-template-columns: max-content max-content;
      align-items: center;
      gap: 8px;
    }

    .identity-mark-field .identity-mark-note {
      width: 100px;
      min-width: 0;
      min-height: 34px;
    }
""", """    /* 收割 / 播种：只剩一个「记录」下拉，作为普通项排进身份网格，
       跟在阿尔戈号命运后面，和它同一行。 */
    .identity-mark-field {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .identity-mark-field .identity-mark-name {
      white-space: nowrap;
    }
""", "mark css")

PAGE.write_text(html, encoding="utf-8", newline="\r\n")
print(f"done; {before - len(html)} bytes smaller")
