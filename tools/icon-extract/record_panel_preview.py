#!/usr/bin/env python3
"""Render the record-sheet module headings as they will appear on the page."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from nav_icon_sizing import glyph_size
from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PANEL = (255, 253, 251)      # cycle-theme --panel
PAGE = (246, 240, 235)       # cycle-theme --bg
ACCENT = (127, 75, 38)
STRONG = (95, 52, 27)        # --accent-strong
Z = 3
BOX = 17.0

# title, glyph, font-size px, extra class note
ROWS = [
    ("循环记录", "timeline", 22),
    ("泰坦列表", "titans", 14),
    ("神之形态与宁芙", "godforms-summons", 15),
    ("船体与船员", "argo", 15),
    ("敌人", "evolution", 15),
    ("外交", "diplomacy", 15),
    ("冒险", "adventures", 15),
    ("抉择矩阵", "choice-matrix", 22),
    ("资源", "cargo-hold", 15),
    ("笔记", "campaign-notes", 15),
]


def font(size):
    for n in ("msyh.ttc", "msyh.ttf", "simsun.ttc"):
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def icon(name: str) -> Image.Image:
    text = (HERE / "svg" / f"{name}.svg").read_text(encoding="utf-8")
    d = text.split('d="', 1)[1].rsplit('"', 1)[0]
    vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
    w, h = (int(float(v)) for v in vb.split()[2:])
    a = rasterise(parse_path(d), w, h, ss=4)
    img = Image.fromarray((a * 255).astype(np.uint8), "L")
    # same equal-bounding-box-area rule the page uses (17px box, 1.25 cap)
    sys.modules[__name__].__dict__.setdefault("_gs", glyph_size)
    cw, ch = glyph_size(name, 0.0, BOX)
    img = img.resize((round(cw * Z), round(ch * Z)), Image.LANCZOS)
    rgba = np.zeros((*np.asarray(img).shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = ACCENT
    rgba[..., 3] = np.asarray(img)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    pad = 30
    row_h = 56 * Z // 2
    width = 900
    img = Image.new("RGB", (width, len(ROWS) * row_h + pad * 2 + 40), PAGE)
    dr = ImageDraw.Draw(img)
    dr.text((pad, 16), "阿尔戈号记录表 — 模块标题（实际字号与图标尺寸）",
            font=font(16 * 2), fill=STRONG)

    y = pad + 40
    for title, name, size in ROWS:
        dr.rectangle([pad, y, width - pad, y + row_h - 8], fill=PANEL,
                     outline=(214, 221, 216))
        art = icon(name)
        ty = y + (row_h - 8) / 2
        img.paste(art, (pad + 20, int(ty - art.height / 2)), art)
        f = font(int(size * Z))
        dr.text((pad + 20 + art.width + 7 * Z, int(ty - size * Z * 0.72)),
                title, font=f, fill=STRONG)
        dr.text((width - pad - 330, int(ty - 9 * Z)),
                f"{name}  {size}px  {glyph_size(name, 0.0, BOX)}",
                font=font(11 * Z), fill=(120, 114, 104))
        y += row_h

    img.save(HERE / "record-panel-headings.png")
    print(f"wrote record-panel-headings.png {img.size}")


if __name__ == "__main__":
    main()
