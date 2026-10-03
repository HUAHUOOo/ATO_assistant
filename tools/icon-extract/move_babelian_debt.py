#!/usr/bin/env python3
"""Put the 巴比伦债务 label immediately before the 收割 field.

(First attempt inserted it after the 播种 field's closing tag, i.e. still behind both.)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# 脚本现在在 <repo>/tools/icon-extract/，parents[2] 就是仓库根（原值多算了一层，本来就取不到 record/）。
ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
lines = PAGE.read_text(encoding="utf-8").split("\n")

babel = [i for i, ln in enumerate(lines) if 'data-cycle-bind="babelianDebt"' in ln]
if len(babel) != 1:
    raise SystemExit(f"babelianDebt found {len(babel)}x")
b_idx = babel[0]

# the 收割 field starts at its own `<div class="identity-mark-field">` line,
# which is a few lines above the reapMarkNotes input
reap = next(i for i, ln in enumerate(lines) if 'data-cycle-bind="reapMarkNotes"' in ln)
r_idx = max(i for i in range(reap) if '<div class="identity-mark-field"' in lines[i])

print(f"收割 field opens at line {r_idx + 1}: {lines[r_idx]!r}")
print(f"巴比伦债务 at line {b_idx + 1}")

if b_idx == r_idx - 1:
    print("already directly before 收割; nothing to do")
    raise SystemExit(0)
if b_idx < r_idx:
    raise SystemExit("already before the mark fields; nothing to do")

label = lines.pop(b_idx)
lines.insert(r_idx, label)
PAGE.write_text("\n".join(lines), encoding="utf-8", newline="\r\n")

order = re.findall(r'<(label|div)[^>]*?data-cycle-field="([^"]*)"[^>]*>(.{0,90})', "\n".join(lines))
print("\nnew source order:")
for tag, field, body in order[:9]:
    name = re.sub(r"<[^>]+>", "", body).strip()[:12] or "(icon only)"
    print(f"   <{tag}> field={field:16s} {name}")
