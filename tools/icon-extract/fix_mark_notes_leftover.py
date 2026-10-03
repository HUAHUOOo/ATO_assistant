#!/usr/bin/env python3
"""Repair the leftover tail that move_mark_notes.py's over-eager regex left behind.

The first attempt matched `\\n *</div>` inside the row, so it swallowed only the
opening div plus the 收割 field down to the notes panel's closing div, leaving
`</details></div>` and the whole 播种 field orphaned at the bottom of the grid.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
html = PAGE.read_text(encoding="utf-8")

LEFTOVER = """                </details>
              </div>
              <div class="identity-mark-field">
                <label>播种<input data-cycle-bind="sowMark" type="number" min="0"></label>
                <input type="hidden" data-cycle-bind="sowMarkNotes">
                <details class="identity-mark-notes" data-mark-notes="sowMarkNotes">
                  <summary aria-label="播种记录">记录</summary>
                  <div class="identity-mark-notes-panel">
                    <p class="identity-mark-notes-empty">还没有记录</p>
                    <ul class="identity-mark-notes-list"></ul>
                    <form class="identity-mark-notes-add">
                      <input type="text" placeholder="名称或说明" aria-label="播种记录条目">
                      <button type="submit">添加</button>
                    </form>
                  </div>
                </details>
              </div>
            </div>
"""

n = html.count(LEFTOVER)
print(f"leftover block matched: {n}")
if n != 1:
    raise SystemExit("cannot find the leftover tail exactly once")
html = html.replace(LEFTOVER, "", 1)

PAGE.write_text(html, encoding="utf-8", newline="\r\n")

txt = PAGE.read_text(encoding="utf-8")
for token in ("identity-mark-row", 'data-cycle-bind="reapMark"',
              'data-cycle-bind="sowMark"', "data-mark-notes=",
              "identity-mark-name"):
    print(f"  {token:32s} {txt.count(token)}")
print("  <details occurrences        ", txt.count("<details"),
      "/ </details>", txt.count("</details>"))
