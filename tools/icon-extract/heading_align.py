#!/usr/bin/env python3
"""Measure the real ink centre of each heading's icon vs its label.

The DOM only reports layout boxes; for "is the icon centred on the text?" the
honest measure is the ink: take the heading's row band from the screenshot, read
the dark pixels inside the icon's own columns and inside the label's columns, and
compare those two vertical centres.

The screenshot is taken at dpr device pixels per CSS pixel, so the DOM rects are
scaled up before indexing it -- that is what makes a fraction-of-a-pixel offset
measurable instead of being lost to antialiasing.

NOTE: deep headings may not line up with the screenshot.  The two Chrome runs
(measure, screenshot) can load lazy images at different moments, which shifts
everything below them by tens of pixels.  Trust the reported CSS values only for
the rows whose ink height looks sane; the DOM box centres from probe_headings.py
are always reliable.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

payload = json.loads((HERE / "probe-boxes.json").read_text(encoding="utf-8"))
boxes = payload["boxes"]
dpr = payload["dpr"]
img = np.asarray(Image.open(HERE / "record-render.png").convert("RGB")).astype(np.float32)
gray = img.mean(axis=2)
print(f"screenshot {gray.shape[1]}x{gray.shape[0]} at dpr={dpr}")


def ink_center(x0, x1, y0, y1):
    xa, xb = max(0, int(x0 * dpr)), min(gray.shape[1], int(x1 * dpr))
    ya, yb = max(0, int(y0 * dpr)), min(gray.shape[0], int(y1 * dpr))
    if xb <= xa or yb <= ya:
        return None
    sub = gray[ya:yb, xa:xb]
    rows = np.nonzero((sub < 190).any(axis=1))[0]
    if len(rows) == 0:
        return None
    return (ya + (rows[0] + rows[-1] + 1) / 2.0) / dpr, len(rows) / dpr


print(f"{'heading':<14}{'icon ink cy':>12}{'text ink cy':>12}{'Δ (CSS px)':>12}")
for rec in boxes:
    if not rec.get("icon") or not rec.get("text"):
        print(f"  {rec['raw']:<12}  (missing icon or text box)")
        continue
    ix, iy, iw, ih = rec["icon"]
    tx, ty, tw, th = rec["text"]
    band = (min(iy, ty) - 10, max(iy + ih, ty + th) + 10)
    ic = ink_center(ix, ix + iw, *band)
    tc = ink_center(tx, tx + tw, *band)
    if not ic or not tc:
        print(f"  {rec['raw']:<12}  (no ink found in the screenshot window)")
        continue
    d = ic[0] - tc[0]
    flag = "  <-- icon too high" if d < -0.3 else ("  <-- icon too low" if d > 0.3 else "  ok")
    print(f"  {rec['raw']:<12}{ic[0]:>12.2f}{tc[0]:>12.2f}{d:>12.2f}{flag}  "
          f"ink h {ic[1]:.1f}/{tc[1]:.1f}")
