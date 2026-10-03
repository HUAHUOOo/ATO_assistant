#!/usr/bin/env python3
"""Report the space above and below the content inside each heading bar.

The heading bar is visible (`.panel-heading` gives it a #f8faf8 background and a
bottom rule), so what matters is whether the icon+label sit centred *inside that
bar* -- i.e. whether the top inset equals the bottom inset.  That is a different
question from icon-vs-text alignment.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

payload = json.loads((HERE / "probe-boxes.json").read_text(encoding="utf-8"))
boxes = payload["boxes"]

print(f"{'heading':<14}{'bar h':>7}{'above':>8}{'below':>8}{'Δ':>8}")
for rec in boxes:
    head = rec.get("head")
    if not head:
        continue
    hx, hy, hw, hh = head
    parts = [b for b in (rec.get("icon"), rec.get("text")) if b]
    if not parts:
        print(f"  {rec['raw']:<12}  (no content boxes)")
        continue
    top = min(b[1] for b in parts)
    bottom = max(b[1] + b[3] for b in parts)
    above = top - hy
    below = hy + hh - bottom
    d = above - below
    flag = "" if abs(d) <= 0.5 else ("  <-- sits high" if d < 0 else "  <-- sits low")
    print(f"  {rec['raw']:<12}{hh:>7.1f}{above:>8.1f}{below:>8.1f}{d:>8.1f}{flag}")
print("\nΔ = above - below; 0 means centred inside the bar")
