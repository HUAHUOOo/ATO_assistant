#!/usr/bin/env python3
"""Check that embed_record_panel_icons reaches a fixed point in one write."""
from __future__ import annotations

import difflib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import embed_record_panel_icons as E  # noqa: E402

current = E.PAGE.read_text(encoding="utf-8")
new1 = E.build(current)
new2 = E.build(new1)

print(f"one more run changes the file : {new1 != current}")
print(f"second run reaches fixed point: {new2 == new1}")

if new1 != current:
    diff = list(difflib.unified_diff(current.splitlines(keepends=True),
                                     new1.splitlines(keepends=True),
                                     "current", "after one run", n=1))
    print(f"\ndiff current -> after one run ({len(diff)} lines):")
    for line in diff[:24]:
        print("   " + line.rstrip("\n")[:150])

if new2 != new1:
    diff = list(difflib.unified_diff(new1.splitlines(keepends=True),
                                     new2.splitlines(keepends=True),
                                     "run1", "run2", n=1))
    print(f"\nNOT IDEMPOTENT ({len(diff)} lines):")
    for line in diff[:24]:
        print("   " + line.rstrip("\n")[:150])
