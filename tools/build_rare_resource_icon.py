#!/usr/bin/env python3
"""Regenerate record/assets/resource-icons/rare.png from the app's Glossary glyph.

The glyph itself is read from ``assets/icons/glossary.svg`` (the same file the
record page loads, distributed through the .atopack ``iconFiles`` section), so
there is exactly one copy of the path data.  ``/record/assets/`` is in
.gitignore -- the PNG is a local build artefact, so this generator is what
actually carries the change.

    python tools/build_rare_resource_icon.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "record" / "assets" / "resource-icons" / "rare.png"
GLYPH = ROOT / "assets" / "icons" / "glossary.svg"

SIZE = 64
PAD = 2
SS = 4
INK = (28, 26, 25)

TOKEN = re.compile(r"([MCLZ])|(-?\d*\.?\d+(?:e-?\d+)?)")


def load_glyph() -> tuple[str, str]:
    """Read viewBox + path data from the distributed glyph."""
    if not GLYPH.is_file():
        raise SystemExit(
            f"缺少字形 {GLYPH.relative_to(ROOT)}；它随 .atopack 的 iconFiles 段分发，"
            "先导入资源包或手动放进 assets/icons/"
        )
    text = GLYPH.read_text(encoding="utf-8")
    view_box = re.search(r'viewBox="([^"]+)"', text)
    paths = re.findall(r'\sd="([^"]+)"', text)
    if not view_box or not paths:
        raise SystemExit(f"字形文件里没有 viewBox / path：{GLYPH}")
    return view_box.group(1), " ".join(paths)


def flatten(d):
    vals = []
    for cmd, num in TOKEN.findall(d):
        vals.append(cmd if cmd else float(num))
    polys, cur = [], []
    i = 0
    x = y = 0.0
    start = (0.0, 0.0)
    while i < len(vals):
        t = vals[i]
        if t == "M":
            if len(cur) > 2:
                polys.append(cur)
            x, y = float(vals[i + 1]), float(vals[i + 2]); i += 3
            start = (x, y); cur = [(x, y)]
        elif t == "L":
            x, y = float(vals[i + 1]), float(vals[i + 2]); i += 3
            cur.append((x, y))
        elif t == "C":
            x1, y1 = float(vals[i + 1]), float(vals[i + 2])
            x2, y2 = float(vals[i + 3]), float(vals[i + 4])
            x3, y3 = float(vals[i + 5]), float(vals[i + 6]); i += 7
            for k in range(1, 17):
                t0 = k / 16.0
                mt = 1 - t0
                cur.append((mt**3 * x + 3 * mt**2 * t0 * x1 + 3 * mt * t0**2 * x2
                            + t0**3 * x3,
                            mt**3 * y + 3 * mt**2 * t0 * y1 + 3 * mt * t0**2 * y2
                            + t0**3 * y3))
            x, y = x3, y3
        elif t == "Z":
            i += 1
            if len(cur) > 2:
                polys.append(cur)
            cur = []
            x, y = start
        else:
            i += 1
    if len(cur) > 2:
        polys.append(cur)
    return polys


def main():
    view_box, path_data = load_glyph()
    tx, ty, w, h = (float(v) for v in view_box.split())
    s = (SIZE - 2 * PAD) / max(w, h)
    ox = (SIZE - w * s) / 2.0 + 0.5 * s
    oy = (SIZE - h * s) / 2.0 + 0.5 * s
    W = SIZE * SS
    acc = Image.new("1", (W, W), 0)
    for poly in flatten(path_data):
        layer = Image.new("1", (W, W), 0)
        pts = [((px + 0.5) * s * SS + ox * SS, (py + 0.5) * s * SS + oy * SS)
               for px, py in poly]
        ImageDraw.Draw(layer).polygon(pts, fill=1)
        acc = ImageChops.logical_xor(acc, layer)
    alpha = acc.convert("L").resize((SIZE, SIZE), Image.LANCZOS)
    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = INK
    rgba[..., 3] = np.asarray(alpha)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(TARGET)
    print(f"wrote {TARGET.relative_to(ROOT)} ({SIZE}x{SIZE}, ink {INK})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
