#!/usr/bin/env python3
"""Show each Argo crop inside a generously widened source window.

The point is to make omissions obvious: the earlier contact sheet only showed the
crop next to its own mask, so a missing part (Argo Fate's triangle wings) looked
perfectly fine.  Here the full neighbourhood is visible and the crop is outlined,
so anything left outside is immediately visible.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MARGIN = 40
Z = 2
recs = json.loads((HERE / "argo-icons.json").read_text(encoding="utf-8"))

cell = 300
pad = 12
cols = 4
rows = (len(recs) + cols - 1) // cols
sheet = Image.new("RGB", (pad + cols * (cell + pad), rows * (cell + 22 + pad) + pad + 34),
                  (26, 26, 29))
dr = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 12)
    fontb = ImageFont.truetype("arialbd.ttf", 16)
except OSError:
    font = fontb = ImageFont.load_default()
dr.text((pad, 10), "Argo crops inside a widened source window (white box = the crop)",
        font=fontb, fill=(235, 235, 235))

suspect = []
for i, rec in enumerate(recs):
    r, c = divmod(i, cols)
    ox = pad + c * (cell + pad)
    oy = 34 + r * (cell + 22 + pad)
    src = Image.open(SRC / rec["screen"]).convert("RGB")
    x, y, w, h = rec["source_box"]
    gx0, gy0 = max(0, x - MARGIN), max(0, y - MARGIN)
    gx1 = min(src.width, x + w + MARGIN)
    gy1 = min(src.height, y + h + MARGIN)
    view = src.crop((gx0, gy0, gx1, gy1))
    s = min(cell / view.width, cell / view.height)
    nw, nh = max(1, int(view.width * s)), max(1, int(view.height * s))
    view = view.resize((nw, nh), Image.LANCZOS)
    px, py = ox + (cell - nw) // 2, oy + (cell - nh) // 2
    sheet.paste(view, (px, py))
    # outline where the crop starts and ends
    bx0, by0 = px + (x - gx0) * s, py + (y - gy0) * s
    bx1, by1 = bx0 + w * s, by0 + h * s
    dr.rectangle([bx0, by0, bx1, by1], outline=(255, 90, 90), width=2)
    # flag crops that touch the widened window's edge (nothing was cut then) --
    # instead flag ones where dark ink continues right outside the box
    import numpy as np
    g = np.asarray(src.convert("L")).astype(np.float32)
    strip = 12
    outside = np.concatenate([
        g[max(0, y - strip):y, x:x + w].ravel(),
        g[y + h:min(g.shape[0], y + h + strip), x:x + w].ravel(),
        g[y:y + h, max(0, x - strip):x].ravel(),
        g[y:y + h, x + w:min(g.shape[1], x + w + strip)].ravel(),
    ])
    dark_outside = int((outside < 150).sum())
    if dark_outside > 30:
        suspect.append((rec["name"], dark_outside))
        dr.rectangle([ox, oy, ox + cell, oy + 20], fill=(120, 30, 30))
        dr.text((ox + 4, oy + 4), f"ink outside crop: {dark_outside}px",
                font=font, fill=(255, 220, 220))
    dr.text((ox, oy + cell + 2), rec["name"], font=font, fill=(205, 205, 212))

sheet.save(HERE / "argo-crop-check.png")
print(f"wrote argo-crop-check.png {sheet.size}")
print("crops with ink immediately outside:",
      suspect if suspect else "none")
