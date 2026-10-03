#!/usr/bin/env python3
"""Build the deliverables for the Argo stat icon set.

Produces, under icon-extract/:
  argo-icon-sprite.svg     <symbol> sprite for <use href="...#argo-icon-hull">
  argo-icon-sheet.svg      labelled vector contact sheet
  argo-icons-preview.png   raster of the same, for quick review
  raster-argo/<name>@Nx.png transparent PNGs at 2x and 4x
  argo-manifest.json       name -> size / source screen / path size
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
SVG = HERE / "svg-argo"
RASTER = HERE / "raster-argo"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LABELS = {
    "argo-fate": "Argo Fate", "argo-knowledge": "Argo Knowledge",
    "babelian-debt": "Babelian Debt", "frozen-time": "Frozen Time",
    "loop-length": "Loop Length", "hull": "Hull", "crew": "Crew",
    "strangers": "Strangers", "humanity": "Humanity", "refugees": "Refugees",
    "captives": "Captives", "defectors": "Defectors", "paradox": "Paradox",
    "paranoia": "Paranoia",
}


def load() -> list[dict]:
    recs = json.loads((HERE / "argo-icons.json").read_text(encoding="utf-8"))
    out = []
    for r in recs:
        name = r["name"]
        text = (SVG / f"{name}.svg").read_text(encoding="utf-8")
        out.append({"name": name, "label": LABELS.get(name, name.replace("-", " ").title()),
                    "d": text.split('d="', 1)[1].rsplit('"', 1)[0],
                    "w": r["w"], "h": r["h"], "screen": r["screen"],
                    "source_box": r["source_box"]})
    return out


def to_image(d: str, w: int, h: int, scale: int) -> Image.Image:
    a = rasterise(parse_path(d), w, h, ss=3, scale=scale)
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = 255
    rgba[..., 3] = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    icons = load()
    print(f"{len(icons)} Argo glyphs")

    # ---- sprite
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">']
    for ic in icons:
        parts.append(f'  <symbol id="argo-icon-{ic["name"]}" '
                     f'viewBox="-0.5 -0.5 {ic["w"]} {ic["h"]}">'
                     f'<path fill="currentColor" fill-rule="evenodd" d="{ic["d"]}"/>'
                     f'</symbol>')
    parts.append("</svg>")
    (HERE / "argo-icon-sprite.svg").write_text("\n".join(parts) + "\n", encoding="utf-8")

    # ---- vector sheet
    cols, cell, pad, top = 5, 168, 16, 76
    rows = (len(icons) + cols - 1) // cols
    W = pad + cols * (cell + pad)
    H = top + rows * (cell + pad)
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'width="{W}" height="{H}">',
         f'<rect width="{W}" height="{H}" fill="#f6f0eb"/>',
         f'<text x="{pad}" y="38" fill="#5f341b" font-family="Georgia,serif" '
         f'font-size="23">Argo stat icons</text>',
         f'<text x="{pad}" y="60" fill="#8a7b6c" font-family="sans-serif" '
         f'font-size="12">{len(icons)} glyphs traced from the Argo ship screens</text>']
    for i, ic in enumerate(icons):
        r, c = divmod(i, cols)
        ox = pad + c * (cell + pad)
        oy = top + r * (cell + pad)
        s = min((cell - 40) / ic["w"], (cell - 40) / ic["h"])
        p.append(f'<rect x="{ox}" y="{oy}" width="{cell}" height="{cell}" fill="#fffdfb" '
                 f'stroke="#e3d4c8"/>')
        p.append(f'<g transform="translate({ox + (cell - ic["w"] * s) / 2:.2f} '
                 f'{oy + (cell - 30 - ic["h"] * s) / 2:.2f}) scale({s:.4f})">'
                 f'<path fill="#3a3632" fill-rule="evenodd" d="{ic["d"]}"/></g>')
        p.append(f'<text x="{ox + cell / 2:.0f}" y="{oy + cell - 10}" fill="#6b6259" '
                 f'font-family="Georgia,serif" font-size="12" text-anchor="middle">'
                 f'{html.escape(ic["label"])}</text>')
    p.append("</svg>")
    (HERE / "argo-icon-sheet.svg").write_text("\n".join(p) + "\n", encoding="utf-8")

    # ---- raster preview + PNGs
    try:
        fontb = ImageFont.truetype("georgia.ttf", 24)
        small = ImageFont.truetype("arial.ttf", 12)
    except OSError:
        fontb = small = ImageFont.load_default()
    PW = pad + cols * (cell + pad)
    PH = top + rows * (cell + pad)
    img = Image.new("RGB", (PW, PH), (246, 240, 235))
    dr = ImageDraw.Draw(img)
    dr.text((pad, 16), "Argo stat icons (vector)", font=fontb, fill=(95, 52, 27))
    dr.text((pad, 50), f"{len(icons)} glyphs traced from the Argo ship screens",
            font=small, fill=(138, 123, 108))
    RASTER.mkdir(exist_ok=True)
    for stale in RASTER.glob("*.png"):
        stale.unlink()
    for i, ic in enumerate(icons):
        r, c = divmod(i, cols)
        ox = pad + c * (cell + pad)
        oy = top + r * (cell + pad)
        dr.rectangle([ox, oy, ox + cell, oy + cell], fill=(255, 253, 251),
                     outline=(227, 212, 200))
        art = to_image(ic["d"], ic["w"], ic["h"], 1)
        s = min((cell - 44) / art.width, (cell - 38) / art.height)
        nw, nh = max(1, int(art.width * s)), max(1, int(art.height * s))
        art = art.resize((nw, nh), Image.LANCZOS)
        # recolour to the app's dark glyph colour
        arr = np.asarray(art).copy()
        arr[..., 0], arr[..., 1], arr[..., 2] = 58, 54, 50
        art = Image.fromarray(arr, "RGBA")
        img.paste(art, (ox + (cell - nw) // 2, oy + (cell - 28 - nh) // 2), art)
        tw = dr.textlength(ic["label"], font=small)
        dr.text((ox + (cell - tw) / 2, oy + cell - 20), ic["label"], font=small,
                fill=(107, 98, 89))
        for scale in (2, 4):
            to_image(ic["d"], ic["w"], ic["h"], scale).save(
                RASTER / f'{ic["name"]}@{scale}x.png')
    img.save(HERE / "argo-icons-preview.png")

    (HERE / "argo-manifest.json").write_text(json.dumps(
        [{k: v for k, v in ic.items() if k != "d"} for ic in icons],
        indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote argo-icons-preview.png {img.size}, sprite, sheet, "
          f"{2 * len(icons)} raster PNGs")


if __name__ == "__main__":
    main()
