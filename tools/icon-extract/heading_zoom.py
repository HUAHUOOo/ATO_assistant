#!/usr/bin/env python3
"""Zoom into the record page's module headings, at coordinates measured by probe_headings.py."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SRC = HERE / "record-render.png"
Z = 3
HALF = 30          # rows either side of the heading's vertical centre

# (label, centre y, x0, x1) -- centres come from probe_headings.py
CROPS = [
    ("循环 II (icon moved out of the h2)", 209, 60, 700),
    ("泰坦列表 (existing summary)", 369, 60, 700),
    ("船体与船员 (new, sans)", 446, 60, 700),
    ("外交 (new, sans)", 775, 60, 700),
    ("敌人 (new, sans)", 1183, 60, 700),
    ("神之形态与宁芙 (new, sans)", 1585, 60, 700),
    ("冒险 (new, sans)", 1817, 60, 700),
    ("抉择矩阵 (existing h2, serif 22px)", 2217, 60, 700),
    ("资源 (new, sans)", 201, 800, 1450),
    ("笔记 (new, sans)", 1178, 800, 1450),
]

img = Image.open(SRC).convert("RGB")
cw = 640 * Z
ch = 2 * HALF * Z
pad = 12
sheet = Image.new("RGB", (cw + 2 * pad + 300, len(CROPS) * (ch + pad) + pad + 30),
                  (28, 28, 31))
dr = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("msyh.ttc", 14)
except OSError:
    font = ImageFont.load_default()
dr.text((pad, 8), f"record module headings @{Z}x (probe-measured coordinates)",
        font=font, fill=(230, 230, 235))
for i, (label, cy, x0, x1) in enumerate(CROPS):
    oy = 30 + i * (ch + pad)
    dr.rectangle([pad, oy, pad + cw, oy + ch], fill=(255, 253, 251))
    crop = img.crop((x0, cy - HALF, x1, cy + HALF)).resize((cw, ch), Image.LANCZOS)
    sheet.paste(crop, (pad, oy))
    dr.text((pad + cw + 10, oy + ch // 2 - 9), label, font=font, fill=(205, 205, 212))
sheet.save(HERE / "heading-zoom.png")
print(f"wrote heading-zoom.png {sheet.size}")
