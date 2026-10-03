#!/usr/bin/env python3
"""Contact sheet of the Argo stat icon crops: source pixels next to the mask."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PNG = HERE / "png-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

manifest = json.loads((HERE / "argo-icons.json").read_text(encoding="utf-8"))
cols, cell, pad, label_w = 4, 132, 12, 150
rows = (len(manifest) + cols - 1) // cols
W = pad + cols * (cell + pad)
H = rows * (cell + 40) + pad + 44
sheet = Image.new("RGB", (W, H), (24, 24, 26))
dr = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 12)
    fontb = ImageFont.truetype("arialbd.ttf", 17)
except OSError:
    font = fontb = ImageFont.load_default()
dr.text((pad, 12), "Argo stat screens - segmented icons", font=fontb, fill=(235, 235, 235))
dr.text((pad + 330, 18), "top: source crop    bottom: binary mask", font=font,
        fill=(150, 150, 150))

for i, rec in enumerate(manifest):
    name = rec["name"]
    r, c = divmod(i, cols)
    ox = pad + c * (cell + pad)
    oy = 44 + r * (cell + 40)
    src = Image.open(PNG / f"{name}.src.png").convert("L")
    mask = np.load(PNG / f"{name}.mask.npy").astype(bool)
    mk = Image.fromarray((mask * 255).astype(np.uint8), "L")
    half = (cell - 22) // 2
    for k, v in enumerate((src, mk)):
        s = min(cell / v.width, half / v.height, 2.0)
        nw, nh = max(1, int(v.width * s)), max(1, int(v.height * s))
        v = v.resize((nw, nh), Image.LANCZOS).convert("RGB")
        sheet.paste(v, (ox + (cell - nw) // 2, oy + k * (half + 4) + (half - nh) // 2))
    tw = dr.textlength(name, font=font)
    dr.text((ox + (cell - tw) / 2, oy + cell - 16), name, font=font, fill=(206, 206, 214))
sheet.save(HERE / "argo-icons-sheet.png")
print(f"wrote argo-icons-sheet.png {sheet.size} ({len(manifest)} icons)")
