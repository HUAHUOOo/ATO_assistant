#!/usr/bin/env python3
"""Rasterise the generated SVG paths and score them against the source pixels.

This is an independent check of the whole pipeline: it parses each traced
``d`` string, flattens the cubic Beziers, fills every subpath with the even-odd
rule by scanline crossing counting at 4x supersampling, then reports the IoU
against the thresholded source mask.  It also writes side-by-side comparison
sheets (source / mask / vector render / difference).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PNG = HERE / "png"
SVG = HERE / "svg"
SS = 4                      # supersampling factor

TOKEN = re.compile(r"([MCLZ])|(-?\d*\.?\d+(?:e-?\d+)?)")


def parse_path(d: str):
    """Return a list of closed polygons (flattened, float px coords)."""
    toks = TOKEN.findall(d)
    vals: list = []
    for cmd, num in toks:
        if cmd:
            vals.append(cmd)
        elif num:
            vals.append(float(num))
    polys, cur = [], []
    i, x, y = 0, 0.0, 0.0
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
            x3, y3 = float(vals[i + 5]), float(vals[i + 6])
            i += 7
            for k in range(1, 13):                  # 12 segments per cubic
                t0 = k / 12.0
                mt = 1 - t0
                bx = (mt**3 * x + 3 * mt**2 * t0 * x1
                      + 3 * mt * t0**2 * x2 + t0**3 * x3)
                by = (mt**3 * y + 3 * mt**2 * t0 * y1
                      + 3 * mt * t0**2 * y2 + t0**3 * y3)
                cur.append((bx, by))
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


def rasterise(polys, w: int, h: int, ss: int = SS, scale: int = 1) -> np.ndarray:
    """Even-odd scanline fill, returns float 0..1 at ``w*scale x h*scale``.

    ``find_contours`` works in pixel-centre space, so pixel (r, c) covers
    [c-0.5, c+0.5) x [r-0.5, r+0.5); the sample grid must match that frame or
    every edge lands half a pixel off.  ``ss`` supersamples within a pixel for
    antialiasing, ``scale`` magnifies the output.
    """
    W, H = w * ss * scale, h * ss * scale
    edges: list[tuple[float, float, float, float]] = []
    for p in polys:
        n = len(p)
        for k in range(n):
            x0, y0 = p[k]
            x1, y1 = p[(k + 1) % n]
            if y0 != y1:
                edges.append((x0, y0, x1, y1))
    ys = ((np.arange(H) + 0.5) / (ss * scale)) - 0.5
    acc = np.zeros((H, W), dtype=np.float32)
    ex0 = np.array([e[0] for e in edges])
    ey0 = np.array([e[1] for e in edges])
    ex1 = np.array([e[2] for e in edges])
    ey1 = np.array([e[3] for e in edges])
    xs = ((np.arange(W) + 0.5) / (ss * scale)) - 0.5
    for r, yy in enumerate(ys):
        ymin = np.minimum(ey0, ey1)
        ymax = np.maximum(ey0, ey1)
        sel = (yy >= ymin) & (yy < ymax)
        if not sel.any():
            continue
        a0, b0, a1, b1 = ex0[sel], ey0[sel], ex1[sel], ey1[sel]
        t = (yy - b0) / (b1 - b0)
        xint = np.sort(a0 + t * (a1 - a0))
        if len(xint) < 2:
            continue
        # even-odd: spans between pairs
        for k in range(0, len(xint) - 1, 2):
            lo, hi = xint[k], xint[k + 1]
            acc[r] += ((xs >= lo) & (xs < hi)).astype(np.float32)
    acc = np.clip(acc, 0, 1)
    # box-downsample each scale*ss block back to one output pixel
    b = ss * scale
    return acc.reshape(h, b, w, b).mean(axis=(1, 3))


def main() -> int:
    index = json.loads((HERE / "trace-index.json").read_text(encoding="utf-8"))
    report = []
    tiles = []
    for rec in index:
        name = rec["name"]
        w, h = rec["w"], rec["h"]
        mask = np.load(PNG / f"{name}.mask.npy").astype(bool)
        d = re.search(r'\sd="([^"]*)"', (SVG / f"{name}.svg").read_text(encoding="utf-8")).group(1)
        polys = parse_path(d)
        render = rasterise(polys, w, h)
        binary = render >= 0.5
        inter = np.logical_and(binary, mask).sum()
        union = np.logical_or(binary, mask).sum()
        iou = inter / union if union else 0.0
        mad = float(np.abs(render - mask.astype(np.float32)).mean())
        report.append({"name": name, "iou": round(float(iou), 4),
                       "mean_abs_diff": round(mad, 4), "subpaths": len(polys)})
        tiles.append((name, mask, render))

    report.sort(key=lambda r: r["iou"])
    (HERE / "verify-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"{'icon':24s} {'IoU':>7} {'MAD':>7}  subpaths")
    for r in report:
        flag = "  <-- low" if r["iou"] < 0.97 else ""
        print(f"{r['name']:24s} {r['iou']:7.4f} {r['mean_abs_diff']:7.4f}  {r['subpaths']}{flag}")
    worst = report[0]["iou"]
    print(f"\n{len(report)} icons, worst IoU {worst:.4f}, "
          f"mean IoU {np.mean([r['iou'] for r in report]):.4f}")

    make_sheet(tiles)
    return 0


def make_sheet(tiles) -> None:
    """Contact sheet: one row per icon, columns = source | mask | vector | diff."""
    cell, pad, label_w = 116, 10, 176
    top = 58
    views_per_row = 4
    W = label_w + views_per_row * (cell + pad) + pad
    H = len(tiles) * (cell + pad) + pad + top
    sheet = Image.new("RGB", (W, H), (24, 24, 26))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 13)
        fontb = ImageFont.truetype("arialbd.ttf", 18)
    except OSError:
        font = fontb = ImageFont.load_default()
    dr.text((pad, pad), "ATO app icons - vector trace verification", font=fontb,
            fill=(235, 235, 235))
    heads = ["source crop", "binary mask", "vector render", "diff (red=extra, blue=missing)"]
    for k, t in enumerate(heads):
        dr.text((label_w + k * (cell + pad) + pad, pad + 28), t, font=font,
                fill=(150, 150, 150))

    for i, (name, mask, render) in enumerate(tiles):
        oy = top + i * (cell + pad) + pad
        dr.text((pad + 8, oy + cell // 2 - 7), name, font=font, fill=(215, 215, 215))
        src_path = PNG / f"{name}.src.png"
        views = []
        if src_path.exists():
            views.append(Image.open(src_path).convert("L"))
        views.append(Image.fromarray((mask * 255).astype(np.uint8), "L"))
        views.append(Image.fromarray((render * 255).astype(np.uint8), "L"))
        diff = np.zeros((*mask.shape, 3), dtype=np.uint8)
        diff[np.logical_and(render >= 0.5, ~mask)] = (255, 80, 80)      # extra
        diff[np.logical_and(render < 0.5, mask)] = (80, 160, 255)       # missing
        diff[np.logical_and(render >= 0.5, mask)] = (185, 185, 185)
        views.append(Image.fromarray(diff, "RGB"))
        for k, v in enumerate(views):
            ox = label_w + k * (cell + pad) + pad
            scale = min(cell / v.width, cell / v.height, 2.2)
            nw, nh = max(1, int(v.width * scale)), max(1, int(v.height * scale))
            v = v.resize((nw, nh), Image.LANCZOS)
            if v.mode == "L":
                v = v.convert("RGB")
            sheet.paste(v, (ox + (cell - nw) // 2, oy + (cell - nh) // 2))
    sheet.save(HERE / "verify-sheet.png")
    print(f"wrote verify-sheet.png ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    sys.exit(main())
