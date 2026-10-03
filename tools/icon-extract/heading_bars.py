#!/usr/bin/env python3
"""Crop each heading's bar exactly (using the probe's measured rect) and stack them."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

payload = json.loads((HERE / "probe-boxes.json").read_text(encoding="utf-8"))
boxes = payload["boxes"]
dpr = payload["dpr"]
Z = 2

img = Image.open(HERE / "record-render.png").convert("RGB")
pad = 12
row_h = 0
picked = []
for rec in boxes:
    if not rec.get("head") or rec["raw"] in ("循环 II",):
        continue
    picked.append(rec)

width = 900
rows = []
for rec in picked:
    hx, hy, hw, hh = rec["head"]
    x0 = int(hx * dpr)
    y0 = int((hy - 6) * dpr)
    x1 = int((hx + min(hw, 900 / 1)) * dpr)
    y1 = int((hy + hh + 6) * dpr)
    x1 = min(x1, img.width)
    crop = img.crop((x0, y0, min(x1, x0 + width * dpr), y1))
    rows.append((rec["raw"], crop))
    row_h = max(row_h, crop.height)

try:
    font = ImageFont.truetype("msyh.ttc", 15)
except OSError:
    font = ImageFont.load_default()

sheet = Image.new("RGB", (width * dpr + 2 * pad + 260,
                          len(rows) * (row_h + pad) + pad + 30), (28, 28, 31))
dr = ImageDraw.Draw(sheet)
dr.text((pad, 8), "heading bars (exact crop of .panel-heading)",
        font=font, fill=(230, 230, 235))
for i, (label, crop) in enumerate(rows):
    oy = 30 + i * (row_h + pad)
    sheet.paste(crop, (pad, oy))
    dr.text((pad + crop.width + 10, oy + crop.height // 2 - 9), label,
            font=font, fill=(205, 205, 212))
sheet.save(HERE / "heading-bars.png")
print(f"wrote heading-bars.png {sheet.size} ({len(rows)} bars)")
