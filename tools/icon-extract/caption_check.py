#!/usr/bin/env python3
"""Re-read the tile captions from the grid screenshot at 3x, to double-check labels."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from segment_icons import GRID_NAMES, GRID_ROWS, GRID_X, TILE, SRC

HERE = Path(__file__).resolve().parent
Z = 3
im = Image.open(SRC / "grid-menu.jpg").convert("RGB")

cells = []
for ri, ty in enumerate(GRID_ROWS):
    for ci, tx in enumerate(GRID_X):
        if (ci, ri) not in GRID_NAMES:
            continue
        # caption band only
        cap = im.crop((tx, ty + 158, tx + TILE, ty + 225))
        cells.append((GRID_NAMES[(ci, ri)], cap))

cw = TILE * Z
ch = 67 * Z
cols = 3
rows = (len(cells) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (cw + 12) + 12, rows * (ch + 34) + 12), (30, 30, 32))
dr = ImageDraw.Draw(sheet)
for i, (name, cap) in enumerate(cells):
    r, c = divmod(i, cols)
    ox = 12 + c * (cw + 12)
    oy = 12 + r * (ch + 34)
    big = cap.resize((cw, ch), Image.LANCZOS)
    sheet.paste(big, (ox, oy + 22))
    dr.text((ox, oy), name, fill=(150, 220, 255))
sheet.save(HERE / "caption-check.png")
print(f"wrote caption-check.png {sheet.size} with {len(cells)} captions")
