#!/usr/bin/env python3
"""Rasterise an SVG back and compare it with its source crop (IoU + side by side)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

name = sys.argv[1] if len(sys.argv) > 1 else "oxygen"
png_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "png-extra"
svg_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else HERE / "svg-extra"

mask = np.load(png_dir / f"{name}.mask.npy").astype(bool)
d = (svg_dir / f"{name}.svg").read_text(encoding="utf-8").split('d="', 1)[1] \
    .rsplit('"', 1)[0]
render = rasterise(parse_path(d), mask.shape[1], mask.shape[0])
inter = np.logical_and(render >= 0.5, mask).sum()
union = np.logical_or(render >= 0.5, mask).sum()
print(f"{name}: {mask.shape[1]}x{mask.shape[0]}  IoU {inter / union:.4f}  "
      f"mean|diff| {np.abs(render - mask).mean():.4f}")

src = Image.open(png_dir / f"{name}.src.png").convert("L")
mk = Image.fromarray((mask * 255).astype(np.uint8), "L")
vr = Image.fromarray((render * 255).astype(np.uint8), "L")
Z = 2
w, h = src.width * Z, src.height * Z
sheet = Image.new("RGB", (w * 3 + 40, h + 40), (24, 24, 26))
dr = ImageDraw.Draw(sheet)
for i, (t, im) in enumerate((("source", src), ("mask", mk), ("vector", vr))):
    sheet.paste(im.resize((w, h), Image.LANCZOS).convert("RGB"), (10 + i * (w + 10), 30))
    dr.text((10 + i * (w + 10), 8), t, fill=(200, 200, 205))
sheet.save(HERE / f"{name}-check.png")
print(f"wrote {name}-check.png {sheet.size}")
