#!/usr/bin/env python3
"""Check the navigation icons the way the browser will size them.

Headless Chrome cannot run inside this sandbox (its IPC needs named pipes), so
this renders the same glyphs with the project's own rasteriser at the exact CSS
size used in the dashboard (16px, 14px on narrow screens), next to a mock of the
navigation row built from the real palette and font sizes in dashboard.css.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verify_render import parse_path, rasterise
from nav_icon_sizing import glyph_size

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

# cycle-theme.css :root palette (the dashboard uses the cycle palette)
BG = (246, 240, 235)
ACCENT = (127, 75, 38)
GOLD = (154, 104, 44)
MUTED = (112, 106, 96)
DONE = (52, 100, 71)

NAV = [("argo", "阿尔戈号"), ("argonauts", "英雄"),
       ("evolution", "始徒"), ("technology", "科技"),
       ("map", "地图"), ("story", "故事书")]

LINK_GAP = 30        # dashboard.css .record-links column gap


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def glyph(name: str, box: int, scale: int = 3) -> Image.Image:
    """Render one glyph at the CSS size the equal-area rule gives it."""
    cw, ch = glyph_size(name, 0.0)
    text = (HERE / "svg" / f"{name}.svg").read_text(encoding="utf-8")
    d = text.split('d="', 1)[1].rsplit('"', 1)[0]
    vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
    _x, _y, w, h = (float(v) for v in vb.split())
    w, h = int(w), int(h)
    a = rasterise(parse_path(d), w, h, ss=4)
    img = Image.fromarray((a * 255).astype(np.uint8), "L")
    return img.resize((round(cw * scale), round(ch * scale)), Image.LANCZOS)


def tint(mask: Image.Image, colour) -> Image.Image:
    rgba = np.zeros((*np.asarray(mask).shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = colour
    rgba[..., 3] = np.asarray(mask)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    Z = 3                                   # draw everything at 3x then keep 3x
    label_font = font(["msyh.ttc", "msyh.ttf", "simsun.ttc"], 13 * Z)
    status_font = font(["msyh.ttc", "msyh.ttf", "simsun.ttc"], 12 * Z)
    arrow_font = font(["seguisym.ttf", "segoeui.ttf", "arial.ttf"], 13 * Z)

    icon16 = {n: glyph(n, 16) for n, _ in NAV}
    icon14 = {n: glyph(n, 14) for n, _ in NAV}

    pad = 40
    W = 1500 * 2
    H = 250 * 2
    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)

    def draw_row(icons, y, title, lab_font, icon_px, gap):
        dr.text((pad, y - 46), title, font=status_font, fill=MUTED)
        x = pad
        dr.ellipse([x + 2, y + 13, x + 14, y + 25], fill=DONE)
        x += 24
        dr.text((x, y + 2), "已同步", font=status_font, fill=MUTED)
        x += dr.textlength("已同步", font=status_font) + gap * Z
        for name, label in NAV:
            art = tint(icons[name], ACCENT)
            img.paste(art, (int(x), int(y + 13 - art.height / 2 + 6)), art)
            x += art.width + 6 * Z
            dr.text((x, y + 4), label, font=lab_font, fill=ACCENT)
            x += dr.textlength(label, font=lab_font) + 8 * Z
            dr.text((x, y + 2), "↗", font=arrow_font, fill=GOLD)
            x += dr.textlength("↗", font=arrow_font) + gap * Z

    draw_row(icon16, 90, f"默认尺寸：图标 16px，标签 13px，链接间距 {LINK_GAP}px",
             label_font, 16, LINK_GAP)
    draw_row(icon14, 200, "窄屏 (≤620px)：图标 14px，标签 12px，间距 20px",
             font(["msyh.ttc", "msyh.ttf", "simsun.ttc"], 12 * Z), 14, 20)

    img.save(HERE / "nav-icon-check.png")
    print(f"wrote nav-icon-check.png {img.size}")

    # legibility strip: each glyph at 16px, magnified 6x
    strip = Image.new("RGB", (len(NAV) * 120 + 40, 190), (255, 255, 255))
    d2 = ImageDraw.Draw(strip)
    for i, (name, label) in enumerate(NAV):
        ox = 40 + i * 120
        big = icon16[name].resize((96, 96), Image.NEAREST)
        strip.paste(big, (ox, 20))
        strip.paste(tint(icon14[name], ACCENT).resize((56, 56), Image.LANCZOS),
                    (ox + 20, 120))
        d2.text((ox, 4), f"{label} / {name}", font=font(["msyh.ttc"], 12), fill=(40, 40, 40))
    strip.save(HERE / "nav-icon-legibility.png")
    print(f"wrote nav-icon-legibility.png {strip.size}")


if __name__ == "__main__":
    main()
