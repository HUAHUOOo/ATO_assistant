#!/usr/bin/env python3
"""Analyse the Argo stat screens: find the icon column, chevrons, bar and crest."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

for p in sorted(SRC.glob("*.jpg")):
    im = Image.open(p).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    g = a.mean(axis=2)
    print(f"--- {p.name} {im.size} ---")
    print(f"   luminance: min={g.min():.0f} max={g.max():.0f}")
    dark = g < 150
    print(f"   dark fraction: {dark.mean():.4f}")
    cols = dark.sum(axis=0)
    rows = dark.sum(axis=1)
    # column profile in 40px buckets
    print("   col profile (every 40px):")
    print("   ", cols[::40])
    print("   row profile (every 80px):")
    print("   ", rows[::80])
    lbl, n = ndimage.label(dark)
    sizes = ndimage.sum(dark, lbl, range(1, n + 1))
    big = np.sort(sizes)[::-1][:12]
    print(f"   components={n}  biggest={big.astype(int)}")
