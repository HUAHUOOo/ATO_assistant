#!/usr/bin/env python3
"""List dark-pixel row bands inside the icon column, to separate labels from glyphs."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

X0, X1 = 370, 620        # central icon column, between the two chevrons
Y0, Y1 = 300, 2290       # below the ARGO title, above the bottom bar


def runs(on: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(on)))
    return out


for p in sorted(SRC.glob("*.jpg")):
    g = np.asarray(Image.open(p).convert("RGB")).astype(np.float32).mean(axis=2)
    band = (g < 150)[Y0:Y1, X0:X1]
    rs = runs(band.sum(axis=1) > 0)
    print(f"--- {p.name} ---")
    prev_end = None
    for a, b in rs:
        gap = "" if prev_end is None else f"  gap={a - prev_end}"
        kind = "ICON" if (b - a) >= 45 else "text"
        print(f"   y {Y0 + a:>5}-{Y0 + b:<5} h={b - a:<4} {kind}{gap}")
        prev_end = b
