#!/usr/bin/env python3
"""Segment icons that were supplied as images rather than screenshotted.

These live in source-extra/ and come in as a dark glyph on a white background
(opaque, no alpha), so this simply thresholds them and stores the same
src.png/mask.npy pair the rest of the pipeline expects -- with the glyph made
*bright* in src.png, because trace_icons.py contours at the 0.5 alpha level and
assumes the shape is the bright side.

    python extra_icons.py
    python trace_icons.py --png png-extra --svg svg-extra
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-extra"
OUT = HERE / "png-extra"
OUT.mkdir(exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DARK = 128          # glyph is anything darker than this
MIN_AREA = 4        # drop specks


def main() -> int:
    sources = sorted(SRC.glob("*.png"))
    if not sources:
        print(f"no images in {SRC}", file=sys.stderr)
        return 1

    for p in OUT.glob("*"):
        p.unlink()

    for path in sources:
        name = path.stem
        im = Image.open(path).convert("RGBA")
        # flatten onto white in case a future input carries alpha
        flat = Image.new("RGB", im.size, (255, 255, 255))
        flat.paste(im, mask=im.split()[3])
        g = np.asarray(flat.convert("L")).astype(np.float32)

        mask = g < DARK
        lbl, n = ndimage.label(mask)
        if n > 1:
            sizes = ndimage.sum(mask, lbl, range(1, n + 1))
            keep = np.isin(lbl, [i for i, s in enumerate(sizes, start=1) if s >= MIN_AREA])
            mask = keep
        ys, xs = np.nonzero(mask)
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        pad = 2
        y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
        y1, x1 = min(g.shape[0], y1 + pad), min(g.shape[1], x1 + pad)

        m = mask[y0:y1, x0:x1]
        # bright glyph: invert, then normalise robustly
        inv = 255.0 - g[y0:y1, x0:x1]
        lo, hi = np.percentile(inv, 1.0), np.percentile(inv, 99.0)
        norm = np.clip((inv - lo) / max(1e-6, hi - lo), 0, 1)

        np.save(OUT / f"{name}.mask.npy", m.astype(np.uint8))
        Image.fromarray((norm * 255).astype(np.uint8), "L").save(
            OUT / f"{name}.src.png")
        # white glyph on transparent, for eyeballing
        h, w = m.shape
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        rgba[..., 3] = np.where(m, 255, 0).astype(np.uint8)
        Image.fromarray(rgba, "RGBA").save(OUT / f"{name}.png")
        print(f"  {name:<12} {w:>4}x{h:<4} cov={m.mean():.3f}  from {path.name}")

    print(f"\n{len(sources)} glyphs -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
