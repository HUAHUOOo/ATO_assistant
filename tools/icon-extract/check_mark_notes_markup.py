#!/usr/bin/env python3
"""Confirm the 收割/播种 record-dropdown markup made it into the page."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
txt = (ROOT / "record" / "index.html").read_text(encoding="utf-8")

print("lines:", txt.count("\n") + 1)
for token in ['<details class="identity-mark-notes"',
              'data-mark-notes="reapMarkNotes"',
              'data-mark-notes="sowMarkNotes"',
              "<label>收割<",
              "<label>播种<",
              '<script src="./mark-notes.js">',
              'class="identity-mark-note"',
              '收割计数标记',
              '播种计数标记']:
    print(f"  {token!r:52s} {txt.count(token)}")
