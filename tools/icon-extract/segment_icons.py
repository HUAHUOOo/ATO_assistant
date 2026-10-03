#!/usr/bin/env python3
"""Segment the individual white glyphs out of the ATO app menu screenshots.

The grid screen draws a white glyph plus a centred caption inside each rounded
tile; the main menu draws a white glyph at the left of each button.  We isolate
the glyph, threshold it, and store a clean full-resolution mask plus a
transparent PNG.

Measured layout facts (full-resolution pixels, verified in diag_caption.py):
  * grid tile = 243x243, columns at x = 96/358/619/880, rows at y = 173/434/
    695/957/1337/1598
  * inside a tile the glyph always ends by row 147 and the caption never starts
    before row 169 -- so the caption is the first bright run at row >= 150
  * in a main-menu button the glyph is confined to x < 183+200, well left of the
    centred caption which starts around x = 430
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "source"
OUT = HERE / "png"
OUT.mkdir(parents=True, exist_ok=True)

GRID_X = [96, 358, 619, 880]
GRID_ROWS = [173, 434, 695, 957, 1337, 1598]
TILE = 243
CAPTION_ROW = 150

GRID_NAMES = {
    (0, 0): "timeline",          (1, 0): "map",               (2, 0): "adventures",
    (3, 0): "argonauts",
    (0, 1): "diplomacy",         (1, 1): "titans",            (2, 1): "godforms-summons",
    (3, 1): "evolution",
    (0, 2): "choice-matrix",     (1, 2): "cargo-hold",        (2, 2): "campaign-notes",
    (3, 2): "argo",
    (0, 3): "mnestis-theatre",   (1, 3): "fated-events",      (2, 3): "cryptic-languages",
    (0, 4): "armory",            (1, 4): "technology",        (3, 4): "save",
    (0, 5): "story",             (1, 5): "binder-audio",      (2, 5): "glossary",
    (3, 5): "settings",
}

MENU_ROWS = [(818, "host-game"), (1055, "story"), (1292, "truth-machine"),
             (1529, "binder-audio"), (1765, "settings")]
MENU_H = 188
MENU_X0, MENU_GLYPH_X1 = 183, 383
MENU_INSET_Y = 14


def row_runs(on: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True runs of length >= 2."""
    runs, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, len(on)))
    return [r for r in runs if r[1] - r[0] >= 2]


def glyph_box(tile: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box of the glyph inside a grid tile, excluding the caption."""
    runs = row_runs(tile.sum(axis=1) > 0)
    if not runs:
        raise RuntimeError("empty tile")
    caption_rows = [r[0] for r in runs if r[0] >= CAPTION_ROW]
    cut = min(caption_rows) - 6 if caption_rows else tile.shape[0]
    glyph = tile[:cut]
    r = row_runs(glyph.sum(axis=1) > 0)
    if not r:
        raise RuntimeError("empty glyph")
    y0, y1 = r[0][0], r[-1][1]
    band = glyph[y0:y1]
    cols = np.nonzero(band.sum(axis=0) > 0)[0]
    return int(cols[0]), y0, int(cols[-1]) + 1, y1


def save_icon(name: str, mask: np.ndarray, gray: np.ndarray | None = None,
              pad: int = 4) -> dict:
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        raise RuntimeError(f"empty glyph for {name}")
    y0 = max(0, ys.min() - pad); x0 = max(0, xs.min() - pad)
    y1 = min(mask.shape[0], ys.max() + 1 + pad); x1 = min(mask.shape[1], xs.max() + 1 + pad)
    m = mask[y0:y1, x0:x1].astype(bool)

    h, w = m.shape
    rgba = np.full((h, w, 4), 255, dtype=np.uint8)
    rgba[..., 3] = np.where(m, 255, 0).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(OUT / f"{name}.png")
    np.save(OUT / f"{name}.mask.npy", m.astype(np.uint8))
    if gray is not None:
        # antialiased reference crop, normalised to 0..255 for visual QA
        g = gray[y0:y1, x0:x1].astype(np.float32)
        if g.ndim == 3:
            g = g.mean(axis=2)
        g = (g - g.min()) / max(1e-6, g.max() - g.min())
        Image.fromarray((g * 255).astype(np.uint8), "L").save(OUT / f"{name}.src.png")
    return {"name": name, "w": int(w), "h": int(h), "coverage": round(float(m.mean()), 4)}


def tight(mask: np.ndarray, gray: np.ndarray):
    """Trim both arrays to the bounding box of ``mask``; returns area too."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        raise RuntimeError("empty glyph")
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    return mask[y0:y1, x0:x1], gray[y0:y1, x0:x1], (y1 - y0) * (x1 - x0)


def main() -> None:
    """Collect every glyph crop, keep one rendering per name, then write files.

    The two screens share several glyphs (story, binder-audio, settings...) and
    the main menu draws them slightly larger, so candidates are gathered first
    and only the biggest bounding box is written -- otherwise a later, smaller
    crop would silently overwrite the better file.
    """
    # name -> list of (bbox area, mask crop, grey crop, metadata)
    candidates: dict[str, list[tuple[int, np.ndarray, np.ndarray, dict]]] = {}
    notes: list[dict] = []

    b = np.asarray(Image.open(SRC / "main-menu.jpg").convert("RGB")).astype(np.float32)
    menu_bright = b.mean(axis=2) >= 170.0
    for by, name in MENU_ROWS:
        y0m, y1m = by + MENU_INSET_Y, by + MENU_H - MENU_INSET_Y
        region = menu_bright[y0m:y1m, MENU_X0:MENU_GLYPH_X1]
        if region.sum() < 200:            # text-only button, no glyph of its own
            notes.append({"name": name, "screen": "menu", "note": "no glyph"})
            continue
        ys, xs = np.nonzero(region)
        m, g, area = tight(region, b[y0m:y1m, MENU_X0:MENU_GLYPH_X1])
        candidates.setdefault(name, []).append((
            area, m, g,
            {"screen": "menu",
             "source_cell": [MENU_X0 + int(xs.min()), by + MENU_INSET_Y + int(ys.min()),
                             int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]}))

    a = np.asarray(Image.open(SRC / "grid-menu.jpg").convert("RGB")).astype(np.float32)
    grid_bright = a.mean(axis=2) >= 150.0
    for ri, ty in enumerate(GRID_ROWS):
        for ci, tx in enumerate(GRID_X):
            if (ci, ri) not in GRID_NAMES:
                continue
            name = GRID_NAMES[(ci, ri)]
            tile = grid_bright[ty:ty + TILE, tx:tx + TILE]
            x0, y0, x1, y1 = glyph_box(tile)
            m, g, area = tight(tile[y0:y1, x0:x1],
                               a[ty + y0:ty + y1, tx + x0:tx + x1])
            candidates.setdefault(name, []).append((
                area, m, g,
                {"screen": "grid", "source_cell": [tx + x0, ty + y0, x1 - x0, y1 - y0]}))

    # wipe previous output so stale crops can never survive a re-run
    for p in OUT.glob("*"):
        p.unlink()

    final: list[dict] = []
    for name in sorted(candidates):
        # Both screens draw the shared glyphs at essentially the same size
        # (within ~2px), so prefer the grid screen for every glyph it has: one
        # screen means one consistent threshold and JPEG generation.  Fall back
        # to the main menu only for glyphs the grid does not contain.
        _area, mask, gray, meta = max(
            candidates[name], key=lambda c: (c[3]["screen"] == "grid", c[0]))
        rec = save_icon(name, mask, gray)
        rec.update(meta)
        final.append(rec)

    (HERE / "icons.json").write_text(
        json.dumps({"glyphs": final, "skipped": notes}, indent=2), encoding="utf-8")
    for r in final:
        print(f"  {r['name']:24s} {r['w']:>4} x {r['h']:<4} cov={r['coverage']:<7} "
              f"[{r['screen']}]")
    for n in notes:
        print(f"  {n['name']:24s} -- {n['note']}")


if __name__ == "__main__":
    main()
