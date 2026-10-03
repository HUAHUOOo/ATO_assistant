#!/usr/bin/env python3
"""Diagnose where the caption text sits inside a grid tile."""
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
a = np.asarray(Image.open(HERE / "source" / "grid-menu.jpg").convert("RGB")).astype(np.float32)
full = a.mean(axis=2) >= 150.0

TILE = 243
CASES = {
    "timeline": (96, 173), "map": (358, 173), "story": (96, 1598),
    "godforms": (619, 434), "campaign-notes": (619, 695),
    "save": (880, 1337), "cargo-hold": (358, 695), "cryptic": (619, 957),
}


def runs_of(rows_on):
    runs, start = [], None
    for i, v in enumerate(rows_on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, len(rows_on)))
    return [r for r in runs if r[1] - r[0] >= 2]


for name, (tx, ty) in CASES.items():
    tile = full[ty:ty + TILE, tx:tx + TILE]
    rs = runs_of(tile.sum(axis=1) > 0)
    gaps = [(rs[i + 1][0] - rs[i][1], rs[i][1], rs[i + 1][0]) for i in range(len(rs) - 1)]
    gaps.sort(reverse=True)
    print(f"{name:16s} runs={rs}")
    print(f"{'':16s} gaps(top3)={gaps[:3]}")
