#!/usr/bin/env python3
"""Compare icon sizing rules for the dashboard navigation row.

Every glyph is tight-cropped to its own bounding box, so fitting each into the
same 16x16 square gives them wildly different visual weight: the wide Argo
longship (120x81) ends up 16x10.8, while a near-square glyph like Story
(101x102) fills 15.9x16.1 -- the longship carries barely two thirds of the ink
area and reads as "smaller".

This renders the row under three normalisation rules so the right one can be
picked by eye:

  p = 1.0   fit max(w,h) to the box      (current behaviour)
  p = 0.5   blend of max(w,h) and area
  p = 0.0   constant bounding-box area   (geometric-mean scaling)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
BOXPX = 16.0            # nominal box, in CSS px
MAX_OVER = 1.25         # allow an icon to exceed the box by this much
Z = 3                   # draw at 3x

BG = (246, 240, 235)
ACCENT = (127, 75, 38)
GOLD = (154, 104, 44)
MUTED = (112, 106, 96)
DONE = (52, 100, 71)

NAV = [("argo", "阿尔戈号记录表"), ("argonauts", "英雄记录表"),
       ("evolution", "始徒"), ("technology", "科技"),
       ("map", "地图"), ("story", "故事书")]


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def glyph_size(name: str, p: float, box: float = BOXPX) -> tuple[int, int]:
    """Rendered CSS size of a glyph under normalisation exponent ``p``."""
    text = (HERE / "svg" / f"{name}.svg").read_text(encoding="utf-8")
    vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
    _x, _y, w, h = (float(v) for v in vb.split())
    denom = (max(w, h) ** p) * ((w * h) ** ((1 - p) / 2))
    s = box / denom
    s = min(s, box * MAX_OVER / max(w, h))      # never overflow the box by too much
    return round(w * s), round(h * s)


def glyph_image(name: str, p: float) -> Image.Image:
    text = (HERE / "svg" / f"{name}.svg").read_text(encoding="utf-8")
    d = text.split('d="', 1)[1].rsplit('"', 1)[0]
    vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
    _x, _y, w, h = (float(v) for v in vb.split())
    w, h = int(w), int(h)
    a = rasterise(parse_path(d), w, h, ss=4)
    img = Image.fromarray((a * 255).astype(np.uint8), "L")
    cw, ch = glyph_size(name, p)
    img = img.resize((cw * Z, ch * Z), Image.LANCZOS)
    rgba = np.zeros((*np.asarray(img).shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = ACCENT
    rgba[..., 3] = np.asarray(img)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    label_font = font(["msyh.ttc", "msyh.ttf", "simsun.ttc"], int(13 * Z))
    status_font = font(["msyh.ttc", "msyh.ttf", "simsun.ttc"], int(12 * Z))
    arrow_font = font(["seguisym.ttf", "segoeui.ttf", "arial.ttf"], int(13 * Z))

    pad = 40
    row_h = 78 * Z
    img = Image.new("RGB", (2100 * 2, row_h * 3 + 40), BG)
    dr = ImageDraw.Draw(img)

    for k, p in enumerate([1.0, 0.5, 0.0]):
        y = 20 + k * row_h
        title = {1.0: "p = 1.0  装进方框（现在）", 0.5: "p = 0.5  折中",
                 0.0: "p = 0.0  等包围盒面积（推荐）"}[p]
        dr.text((pad, y), title, font=status_font, fill=MUTED)
        x = pad
        yy = y + 34
        dr.ellipse([x + 2, yy + 13, x + 14, yy + 25], fill=DONE)
        x += 24
        dr.text((x, yy + 2), "已同步", font=status_font, fill=MUTED)
        x += dr.textlength("已同步", font=status_font) + 24 * Z
        for name, label in NAV:
            art = glyph_image(name, p)
            img.paste(art, (int(x), int(yy + 13 - art.height / 2 + 6)), art)
            cw, ch = glyph_size(name, p)
            x += cw * Z + 6 * Z
            dr.text((x, yy + 4), label, font=label_font, fill=ACCENT)
            x += dr.textlength(label, font=label_font) + 8 * Z
            dr.text((x, yy + 2), "↗", font=arrow_font, fill=GOLD)
            x += dr.textlength("↗", font=arrow_font) + 24 * Z

    img.save(HERE / "nav-icon-sizing.png")
    print(f"wrote nav-icon-sizing.png {img.size}\n")
    print(f"{'glyph':<14}{'crop':>10} {'p=1.0':>12} {'p=0.5':>12} {'p=0.0':>12}")
    for name, _ in NAV:
        text = (HERE / "svg" / f"{name}.svg").read_text(encoding="utf-8")
        vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
        w, h = (int(float(v)) for v in vb.split()[2:])
        sizes = " ".join(f"{glyph_size(name, p)[0]}x{glyph_size(name, p)[1]:<7}"
                         for p in (1.0, 0.5, 0.0))
        print(f"{name:<14}{w}x{h:<6} {sizes}")


if __name__ == "__main__":
    main()
