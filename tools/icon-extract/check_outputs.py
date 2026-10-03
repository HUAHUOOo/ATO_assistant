#!/usr/bin/env python3
"""Final sanity check on the generated deliverables."""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
icons = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
names = {i["name"] for i in icons}

h = (HERE / "preview.html").read_text(encoding="utf-8")
print(f"preview.html   : {len(h):,} bytes, inline <svg>={h.count('<svg')}, "
      f"cards={h.count('class=\"card\"')}")

sprite = (HERE / "ato-icon-sprite.svg").read_text(encoding="utf-8")
sym = set(re.findall(r'<symbol id="ato-icon-([^"]+)"', sprite))
print(f"sprite         : {len(sym)} symbols, matches manifest: {sym == names}")

sheet = (HERE / "ato-icon-sheet.svg").read_text(encoding="utf-8")
print(f"sheet          : {sheet.count('<path')} paths, {sheet.count('<text')} texts")

svgs = sorted((HERE / "svg").glob("*.svg"))
print(f"svg/           : {len(svgs)} files, matches manifest: "
      f"{ {p.stem for p in svgs} == names }")

raster = sorted((HERE / "raster").glob("*.png"))
print(f"raster/        : {len(raster)} files (expect {len(names) * 2})")

total = sum(p.stat().st_size for p in svgs)
print(f"svg payload    : {total:,} bytes total, "
      f"{total / len(svgs):,.0f} bytes average")

rep = json.loads((HERE / "verify-report.json").read_text(encoding="utf-8"))
score = {r["name"]: r["iou"] for r in rep}
print(f"verification   : {len(rep)} icons, mean IoU "
      f"{sum(score.values()) / len(score):.4f}, min {min(score.values()):.4f} "
      f"({min(score, key=score.get)})")
missing = names - set(score)
print(f"missing from verification: {missing or 'none'}")
