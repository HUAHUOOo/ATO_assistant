#!/usr/bin/env python3
"""Detect the rounded tile rectangles in the ATO app menu screenshots."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "source"


def rect_components(mask: np.ndarray, min_area: int, min_fill: float = 0.9):
    """Simple 4-connected label + bbox, via scipy if present else flood fallback."""
    from scipy import ndimage

    lbl, n = ndimage.label(mask)
    out = []
    sl = ndimage.find_objects(lbl)
    for i, s in enumerate(sl, start=1):
        ys, xs = s
        h = ys.stop - ys.start
        w = xs.stop - xs.start
        area = int((lbl[s] == i).sum())
        if area < min_area:
            continue
        fill = area / float(h * w)
        if fill < min_fill:
            continue
        out.append({"x": int(xs.start), "y": int(ys.start), "w": int(w), "h": int(h),
                    "area": area, "fill": round(fill, 3)})
    out.sort(key=lambda r: (round(r["y"] / 40), r["x"]))
    return out


def report(name: str, thresh, mode, min_area, ymax) -> list[dict]:
    im = Image.open(SRC / f"{name}.jpg").convert("RGB")
    g = np.asarray(im).astype(np.float32).mean(axis=2)
    m = (g > thresh) if mode == "gt" else (g < thresh)
    m[ymax:, :] = False
    rects = rect_components(m, min_area)
    print(f"--- {name}: {len(rects)} candidate tiles (thresh {mode} {thresh}) ---")
    for r in rects:
        print("   ", r)
    return rects


# grid: tiles are lum ~63.3 on a ~57 background
grid = report("grid-menu", 60.0, "gt", 8000, 2400)
# main menu: buttons are lum ~118.8 on a ~244 background
main = report("main-menu", 200.0, "lt", 20000, 2200)

(HERE / "tiles.json").write_text(
    json.dumps({"grid-menu": grid, "main-menu": main}, indent=2), encoding="utf-8")
print("wrote tiles.json")
