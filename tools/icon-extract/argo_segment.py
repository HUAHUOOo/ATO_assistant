#!/usr/bin/env python3
"""Segment the icons out of the Argo stat screens.

Those screens are a light card with a centred stack of items.  Each item is a
small caps label, then a large dark glyph with its value to the right:

    ARGO KNOWLEDGE            <- label band, ~30px tall
        [book+candle]  60/80  <- glyph band, ~80-111px tall, value to the right

Measured on the five screenshots: label bands are 29-31px, glyph bands
80-111px, the label-to-glyph gap is 15-31px and the item-to-item gap is
114-133px, so rows separate cleanly.  The glyph column sits at x~400-570, the
value text at x~580-700 and the chevrons further out; the big crest medallion
is bottom-right and the summary strip is below y~2300, all outside the crop.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
SRC = HERE / "source-argo"
OUT = HERE / "png-argo"
OUT.mkdir(parents=True, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

X0, X1 = 360, 780        # icon column plus the value text, between the chevrons
Y0, Y1 = 300, 2290       # below the ARGO title, above the summary strip
DARK = 150
GLYPH_MIN_H = 60         # glyph bands are >=80px; labels are ~30px, values ~40px
CLUSTER_GAP = 40         # px between components of one glyph; value text is ~78px away
MERGE_GAP = 10           # merge runs this close; the label-to-glyph gap is 15-31px
PAD = 4

# glyph order as it appears on each screen
SCREENS = {
    "argo1-hull-crew-fate-knowledge-strangers.jpg":
        ["hull", "crew", "argo-fate", "argo-knowledge", "strangers"],
    "argo2-fate-knowledge-humanity-refugees-captives-defectors.jpg":
        ["argo-fate", "argo-knowledge", "humanity", "refugees", "captives", "defectors"],
    # Argo Fate / Argo Knowledge / Hull / Crew repeat on several screens
    "argo3-paradox-frozen-silo-loop.jpg":
        ["argo-fate", "argo-knowledge", "paradox", "frozen-time", "loop-length"],
    "argo4-hull-crew-babelian-debt.jpg":
        ["hull", "crew", "argo-fate", "argo-knowledge", "babelian-debt"],
    "argo5-paranoia-oxygen.jpg":
        ["hull", "crew", "argo-fate", "argo-knowledge", "paranoia"],
}


def row_runs(on: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(on)))
    return out


def glyph_box(sub: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box of the glyph inside one row band, excluding the value text.

    Components are clustered by horizontal proximity and the leftmost cluster is
    the glyph; the value digits sit well to the right (the gap is ~78px on the
    Argo Fate row, versus a few pixels between parts of one glyph).

    An earlier version instead trusted the tallest components to set the
    horizontal extent, which broke Argo Fate: its two triangle wings are only
    46px tall while the centre drop is 71px, so the wings were treated as
    outsiders and cropped away.
    """
    lbl, n = ndimage.label(sub)
    if n == 0:
        raise RuntimeError("empty band")
    comps = []
    for i, s in enumerate(ndimage.find_objects(lbl), start=1):
        ys, xs = s
        comps.append((xs.start, xs.stop, ys.start, ys.stop))
    comps.sort()

    clusters: list[list[tuple[int, int, int, int]]] = [[comps[0]]]
    for c in comps[1:]:
        right = max(x1 for _x0, x1, _y0, _y1 in clusters[-1])
        if c[0] - right <= CLUSTER_GAP:
            clusters[-1].append(c)
        else:
            clusters.append([c])

    icon = clusters[0]
    return (min(c[0] for c in icon), min(c[2] for c in icon),
            max(c[1] for c in icon), max(c[3] for c in icon))


def main() -> int:
    for p in OUT.glob("*"):
        p.unlink()

    manifest = []
    for fname, names in SCREENS.items():
        path = SRC / fname
        if not path.exists():
            print(f"missing {path}", file=sys.stderr)
            return 1
        rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
        g = rgb.mean(axis=2)
        dark = (g < DARK)[Y0:Y1, X0:X1]

        # Merge runs that sit right next to each other before sizing them up:
        # a glyph can have a thin tail a few pixels below its main mass (Frozen
        # Time's wreck tendrils), which would otherwise be its own tiny run --
        # and then be mistaken for a label and dropped.  The label-to-glyph gap
        # is 15-31px, so 10px is safely below it.
        merged: list[tuple[int, int]] = []
        for a, b in row_runs(dark.sum(axis=1) > 0):
            if merged and a - merged[-1][1] <= MERGE_GAP:
                merged[-1] = (merged[-1][0], b)
            else:
                merged.append((a, b))

        bands = [b for b in merged if b[1] - b[0] >= GLYPH_MIN_H]
        if len(bands) != len(names):
            print(f"!! {fname}: found {len(bands)} glyph bands, expected {len(names)}")
            for b in bands:
                print(f"     y {Y0 + b[0]}-{Y0 + b[1]} h={b[1] - b[0]}")
        for (a, b), name in zip(bands, names):
            sub = dark[a:b]
            x0, y0, x1, y1 = glyph_box(sub)
            gy0, gy1 = Y0 + a + y0, Y0 + a + y1
            gx0, gx1 = X0 + x0, X0 + x1
            gy0 = max(0, gy0 - PAD); gx0 = max(0, gx0 - PAD)
            gy1 = min(g.shape[0], gy1 + PAD); gx1 = min(g.shape[1], gx1 + PAD)

            m = (g[gy0:gy1, gx0:gx1] < DARK)
            crop = g[gy0:gy1, gx0:gx1]
            h, w = m.shape
            rgba = np.full((h, w, 4), 255, dtype=np.uint8)
            rgba[..., 3] = np.where(m, 255, 0).astype(np.uint8)
            Image.fromarray(rgba, "RGBA").save(OUT / f"{name}.png")
            np.save(OUT / f"{name}.mask.npy", m.astype(np.uint8))
            # the tracers expect a *bright* glyph, so store the inverted crop
            inv = 255.0 - crop
            lo, hi = np.percentile(inv, 1.0), np.percentile(inv, 99.0)
            norm = np.clip((inv - lo) / max(1e-6, hi - lo), 0, 1)
            Image.fromarray((norm * 255).astype(np.uint8), "L").save(OUT / f"{name}.src.png")
            manifest.append({"name": name, "screen": fname, "w": int(w), "h": int(h),
                             "coverage": round(float(m.mean()), 4),
                             "source_box": [gx0, gy0, gx1 - gx0, gy1 - gy0]})
            print(f"  {name:<16} {w:>4}x{h:<4} cov={m.mean():.3f}  from {fname.split('-')[0]}")

    # one rendering per glyph: keep the largest bounding box
    best: dict[str, dict] = {}
    for rec in manifest:
        cur = best.get(rec["name"])
        if cur is None or rec["w"] * rec["h"] > cur["w"] * cur["h"]:
            best[rec["name"]] = rec
    # drop the losing crops' files
    for p in OUT.glob("*"):
        if p.name.split(".")[0] not in best:
            p.unlink()
    final = sorted(best.values(), key=lambda r: r["name"])

    (HERE / "argo-icons.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    print(f"\n{len(final)} unique glyphs -> {OUT}")
    for r in final:
        print(f"  {r['name']:<16} {r['w']:>4}x{r['h']:<4} from {r['screen'].split('-')[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
