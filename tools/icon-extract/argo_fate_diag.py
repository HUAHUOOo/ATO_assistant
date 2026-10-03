#!/usr/bin/env python3
"""Diagnose the Argo Fate crop: show the source band and the components in it."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DARK = 150
X0, X1 = 360, 780

# Argo Fate band on the first screen (from argo_rows.py)
BAND = (1005, 1120)

for fname in ["argo1-hull-crew-fate-knowledge-strangers.jpg",
              "argo2-fate-knowledge-humanity-refugees-captives-defectors.jpg"]:
    g = np.asarray(Image.open(SRC / fname).convert("RGB")).astype(np.float32).mean(axis=2)
    # second screen's fate band sits a little lower
    y0, y1 = (BAND if "argo1" in fname else (500, 615))
    sub = (g[y0:y1, X0:X1] < DARK)
    lbl, n = ndimage.label(sub)
    objs = ndimage.find_objects(lbl)
    print(f"--- {fname.split('-')[0]}  band y {y0}-{y1}  components={n}")
    for i, s in enumerate(objs, start=1):
        ys, xs = s
        h, w = ys.stop - ys.start, xs.stop - xs.start
        area = int((lbl[s] == i).sum())
        core = "CORE" if h >= 55 else "    "
        print(f"   {core} x {X0 + xs.start:>4}-{X0 + xs.stop:<4} y {y0 + ys.start:>4}-{y0 + ys.stop:<4}"
              f"  {w:>3}x{h:<3} area={area}")

# save a generous crop of the source band for eyeballing
g = np.asarray(Image.open(SRC / "argo1-hull-crew-fate-knowledge-strangers.jpg").convert("RGB"))
Image.fromarray(g[995:1130, 350:640]).resize((290 * 3, 135 * 3), Image.LANCZOS).save(
    HERE / "argo-fate-source-band.png")
print("wrote argo-fate-source-band.png")
