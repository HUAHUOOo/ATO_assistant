#!/usr/bin/env python3
"""Rasterise the traced Argo SVGs back and score them against the masks."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
PNG = HERE / "png-argo"
SVG = HERE / "svg-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    recs = json.loads((HERE / "argo-icons.json").read_text(encoding="utf-8"))
    rows = []
    tiles = []
    for rec in recs:
        name = rec["name"]
        mask = np.load(PNG / f"{name}.mask.npy").astype(bool)
        text = (SVG / f"{name}.svg").read_text(encoding="utf-8")
        d = text.split('d="', 1)[1].rsplit('"', 1)[0]
        render = rasterise(parse_path(d), mask.shape[1], mask.shape[0])
        inter = np.logical_and(render >= 0.5, mask).sum()
        union = np.logical_or(render >= 0.5, mask).sum()
        iou = float(inter / union) if union else 0.0
        alpha = np.asarray(
            Image.open(PNG / f"{name}.src.png").convert("L")).astype(np.float32) / 255.0
        soft = float(np.abs(render - alpha).mean())
        rows.append((name, iou, soft))
        tiles.append((name, mask, render))

    rows.sort(key=lambda r: r[1])
    print(f"{'icon':<17}{'IoU':>8}{'soft':>9}")
    for name, iou, soft in rows:
        flag = "  <-- low" if iou < 0.95 else ""
        print(f"{name:<17}{iou:>8.4f}{soft:>9.4f}{flag}")
    ious = [r[1] for r in rows]
    print(f"\n{len(rows)} icons  mean IoU {np.mean(ious):.4f}  "
          f"min {min(ious):.4f} ({rows[0][0]})")

    # visual sheet: source | mask | vector
    cell, pad, label_w = 120, 10, 140
    sheet = Image.new("RGB",
                      (label_w + 3 * (cell + pad) + pad, len(tiles) * (cell + pad) + 40),
                      (24, 24, 26))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 12)
        fontb = ImageFont.truetype("arialbd.ttf", 16)
    except OSError:
        font = fontb = ImageFont.load_default()
    dr.text((pad, 10), "Argo icons - source / mask / vector", font=fontb,
            fill=(235, 235, 235))
    for k, t in enumerate(["source", "mask", "vector"]):
        dr.text((label_w + k * (cell + pad) + pad, 12), t, font=font, fill=(150, 150, 150))
    for i, (name, mask, render) in enumerate(tiles):
        oy = 36 + i * (cell + pad)
        dr.text((pad + 6, oy + cell // 2 - 6), name, font=font, fill=(210, 210, 210))
        views = [Image.open(PNG / f"{name}.src.png").convert("L"),
                 Image.fromarray((mask * 255).astype(np.uint8), "L"),
                 Image.fromarray((render * 255).astype(np.uint8), "L")]
        for k, v in enumerate(views):
            ox = label_w + k * (cell + pad) + pad
            s = min(cell / v.width, cell / v.height, 1.6)
            nw, nh = max(1, int(v.width * s)), max(1, int(v.height * s))
            sheet.paste(v.resize((nw, nh), Image.LANCZOS).convert("RGB"),
                        (ox + (cell - nw) // 2, oy + (cell - nh) // 2))
    sheet.save(HERE / "argo-verify-sheet.png")
    print(f"wrote argo-verify-sheet.png {sheet.size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
