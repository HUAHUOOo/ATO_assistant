#!/usr/bin/env python3
"""Show the 回退 button and report its background / text colours."""
from __future__ import annotations

import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHOT = ROOT / "tools" / "icon-extract" / "fate-rollback.png"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                "--hide-scrollbars", "--window-size=1500,600",
                "--virtual-time-budget=6000", f"--screenshot={SHOT}",
                (ROOT / "record" / "index.html").as_uri()],
               capture_output=True, text=True, encoding="utf-8", errors="replace")

im = Image.open(SHOT).convert("RGB")
a = np.asarray(im).astype(np.int16)
# the button uses --gold (#9a682c); find pixels close to it in the identity grid
gold = np.array([154, 104, 44])
dist = np.abs(a - gold).sum(axis=2)
mask = dist < 60
mask[:150, :] = False          # ignore anything above the identity grid
rows = np.nonzero(mask.any(axis=1))[0]
print(f"gold-ish rows: {rows.min()}-{rows.max()}" if len(rows) else "no gold found")
if len(rows):
    y0, y1 = int(rows.min()) - 6, int(rows.max()) + 6
    cols = np.nonzero(mask[y0:y1].any(axis=0))[0]
    x0, x1 = int(cols.min()) - 6, int(cols.max()) + 6
    print(f"box: x {x0}-{x1}  y {y0}-{y1}")
    crop = im.crop((x0, y0, x1, y1))
    crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS).save(
        ROOT / "tools" / "icon-extract" / "fate-rollback-zoom.png")
    px = a[y0:y1, x0:x1].reshape(-1, 3)
    common = Counter(map(tuple, px)).most_common(6)
    print("top colours in the crop:")
    for colour, n in common:
        print(f"   rgb{colour}  x{n}")
