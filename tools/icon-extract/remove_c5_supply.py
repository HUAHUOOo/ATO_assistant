#!/usr/bin/env python3
"""One-off: drop the C5 补给 (supply) item from the Argo record sheet.

The field is a plain `<label data-cycle-field="c5">` in the page's own HTML, plus
three mentions in the inline script (the cycle-scoped key list, the default
state, and the min/max config).  All four go, so a saved campaign stops carrying
the value around too.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

html = PAGE.read_text(encoding="utf-8")
before = html

# 1. the field itself
label = re.compile(r'\s*<label data-cycle-field="c5">(?:(?!</label>).)*?'
                   r'data-cycle-bind="supply".*?</label>', re.S)
n = len(label.findall(html))
if n == 0 and "supply" not in html:
    print("already removed; nothing to do")
    raise SystemExit(0)
print(f"label matches: {n}")
if n != 1:
    raise SystemExit("expected exactly one supply label")
html = label.sub("", html, count=1)

# 2-4. the state plumbing
for old, new in (('"paranoia", "supply",', '"paranoia",'),
                 ('      supply: "",\n', ''),
                 ('        supply: { min: 0, max: null },\n', '')):
    c = html.count(old)
    print(f"{old.strip()[:40]!r}: {c} match(es)")
    if c != 1:
        raise SystemExit("unexpected match count")
    html = html.replace(old, new, 1)

if html == before:
    raise SystemExit("nothing changed")
PAGE.write_text(html, encoding="utf-8")
print(f"removed; {len(before) - len(html)} bytes smaller")
