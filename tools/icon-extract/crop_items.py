#!/usr/bin/env python3
"""Crop a region of the rendered record page for close inspection."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REGIONS = {
    "identity": (60, 200, 560, 280),
    "tracks": (60, 470, 560, 560),
    "crew-counters": (60, 530, 700, 780),
    "notes": (830, 1140, 1460, 1230),
}
Z = 3
src = Image.open(HERE / "record-render.png").convert("RGB")

for name, (x0, y0, x1, y1) in REGIONS.items():
    crop = src.crop((x0, y0, x1, y1))
    crop = crop.resize((crop.width * Z, crop.height * Z), Image.LANCZOS)
    crop.save(HERE / f"item-{name}.png")
    print(f"wrote item-{name}.png {crop.size}")
