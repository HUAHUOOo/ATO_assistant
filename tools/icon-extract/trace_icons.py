#!/usr/bin/env python3
"""Trace the segmented ATO glyphs into smooth SVG paths.

Rather than contouring the hard 1-bit mask (which reproduces the pixel
staircase), we contour the *antialiased* source crop at the 0.5 alpha level.
That places every contour on the true sub-pixel edge of the original artwork.

Pipeline per glyph:
  1. load the greyscale source crop, robust-normalise it to an alpha field;
  2. light Gaussian blur (sigma ~0.6 px) to suppress JPEG ringing;
  3. marching squares (skimage.measure.find_contours) at level 0.5 -> closed
     sub-pixel loops, outer outlines and holes alike;
  4. Douglas-Peucker simplification (skimage.measure.approximate_polygon);
  5. corner detection, then a Catmull-Rom spline rendered as cubic Beziers
     through every non-corner run, so curves stay smooth while genuine corners
     stay sharp;
  6. one <path> per glyph, fill-rule="evenodd", fill="currentColor" so the SVG
     inherits colour from CSS.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import measure
from skimage.filters import gaussian

HERE = Path(__file__).resolve().parent
PNG = HERE / "png"
SVG = HERE / "svg"
SVG.mkdir(parents=True, exist_ok=True)

DP_TOLERANCE = 0.40          # px, Douglas-Peucker
CORNER_DEG = 34.0            # turn sharper than this stays a hard corner
SIGMA = 0.0                  # px, pre-contour Gaussian blur (0 = off)
MIN_CONTOUR_POINTS = 3
MIN_AREA = 1.8               # px^2, drop specks


# ------------------------------------------------------------------ alpha field
def load_alpha(name: str, sigma: float = SIGMA, png_dir: Path | None = None) -> np.ndarray:
    g = np.asarray(Image.open((png_dir or PNG) / f"{name}.src.png").convert("L")).astype(np.float32)
    lo, hi = np.percentile(g, 1.0), np.percentile(g, 99.0)
    a = np.clip((g - lo) / max(1e-6, hi - lo), 0.0, 1.0)
    return gaussian(a, sigma, preserve_range=True) if sigma > 0 else a


# --------------------------------------------------------------- geometry utils
def signed_area(pts: np.ndarray) -> float:
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def turn_angles(pts: np.ndarray) -> np.ndarray:
    n = len(pts)
    prev = pts - np.roll(pts, 1, axis=0)
    nxt = np.roll(pts, -1, axis=0) - pts
    out = np.zeros(n)
    for i in range(n):
        a, b = prev[i], nxt[i]
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na < 1e-9 or nb < 1e-9:
            continue
        c = float(np.clip(np.dot(a, b) / (na * nb), -1.0, 1.0))
        out[i] = math.degrees(math.acos(c))
    return out


def catmull_rom_closed(pts: np.ndarray, corners: list[int]) -> str:
    """Cubic-Bezier path through ``pts`` (closed), splitting at corner indices."""
    n = len(pts)
    if n < 3:
        return ""
    if not corners:
        corners = [0]
    corners = sorted(set(corners))

    def P(i: int) -> np.ndarray:
        return pts[i % n]

    parts: list[str] = []
    for ci, start in enumerate(corners):
        end = corners[(ci + 1) % len(corners)]
        idx = [start]
        k = start
        while True:
            k = (k + 1) % n
            idx.append(k)
            if k == end:
                break
        if len(idx) < 2:
            continue
        if ci == 0:
            parts.append(f"M {P(idx[0])[0]:.2f} {P(idx[0])[1]:.2f}")
        for j in range(1, len(idx) - 1):
            i0, i1, i2 = idx[j - 1], idx[j], idx[j + 1]
            i3 = (i2 + 1) % n
            p0, p1, p2, p3 = P(i0), P(i1), P(i2), P(i3)
            c1 = p1 + (p2 - p0) / 6.0
            c2 = p2 - (p3 - p1) / 6.0
            parts.append(f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} "
                         f"{p2[0]:.2f} {p2[1]:.2f}")
        if len(idx) == 2:
            p1, p2 = P(idx[0]), P(idx[1])
            parts.append(f"L {p2[0]:.2f} {p2[1]:.2f}")
    parts.append("Z")
    return " ".join(parts)


def smooth_polygon(pts: np.ndarray, corner_deg: float = CORNER_DEG) -> str:
    turns = turn_angles(pts)
    corners = [i for i, t in enumerate(turns) if t > corner_deg]
    return catmull_rom_closed(pts, corners)


# --------------------------------------------------------------------- tracing
def trace_alpha(alpha: np.ndarray, tolerance: float = DP_TOLERANCE,
                corner_deg: float = CORNER_DEG) -> tuple[str, int]:
    """Contour an alpha field and return (svg path data, loop count)."""
    field = np.pad(alpha, 1, mode="constant", constant_values=0.0)
    subs: list[str] = []
    kept = 0
    for c in measure.find_contours(field, 0.5):
        xy = np.stack([c[:, 1] - 1.0, c[:, 0] - 1.0], axis=1)
        if len(xy) > 1 and np.allclose(xy[0], xy[-1]):
            xy = xy[:-1]
        if len(xy) < MIN_CONTOUR_POINTS or abs(signed_area(xy)) < MIN_AREA:
            continue
        simp = measure.approximate_polygon(
            np.vstack([xy, xy[:1]]), tolerance=tolerance)[:-1]
        if len(simp) < MIN_CONTOUR_POINTS:
            continue
        kept += 1
        subs.append(smooth_polygon(simp, corner_deg))
    return " ".join(subs), kept


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Trace segmented glyphs into SVG")
    ap.add_argument("--png", type=Path, default=PNG,
                    help=f"source crops/masks directory (default {PNG.name})")
    ap.add_argument("--svg", type=Path, default=SVG,
                    help=f"output directory (default {SVG.name})")
    args = ap.parse_args(argv)
    png_dir, svg_dir = args.png, args.svg
    svg_dir.mkdir(parents=True, exist_ok=True)

    sources = sorted(p.name.replace(".src.png", "") for p in png_dir.glob("*.src.png"))
    if not sources:
        print(f"no source crops in {png_dir}; run segment_icons.py first", file=sys.stderr)
        return 1

    # wipe previous output so a renamed or dropped glyph cannot linger
    for stale in svg_dir.glob("*.svg"):
        stale.unlink()

    index = []
    for name in sources:
        alpha = load_alpha(name, png_dir=png_dir)
        h, w = alpha.shape
        d, loops = trace_alpha(alpha)
        svg = (
            # Contours are in pixel-centre space, so pixel 0 spans -0.5..0.5 and
            # the artwork occupies -0.5..w-0.5.  Starting the viewBox at -0.5
            # reproduces exactly the pixels of the source crop, with no clip.
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 {w} {h}" '
            f'width="{w}" height="{h}" role="img" aria-label="{name}">\n'
            f'  <path fill="currentColor" fill-rule="evenodd" d="{d}"/>\n'
            f'</svg>\n'
        )
        (svg_dir / f"{name}.svg").write_text(svg, encoding="utf-8")
        index.append({"name": name, "w": w, "h": h, "loops": loops,
                      "path_bytes": len(d), "svg_bytes": len(svg)})
        print(f"  {name:24s} {w:>4}x{h:<4} loops={loops:<3} d={len(d)}B")

    idx_name = "trace-index.json" if svg_dir == SVG else f"trace-index-{svg_dir.name}.json"
    (HERE / idx_name).write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"traced {len(index)} glyphs -> {svg_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
