#!/usr/bin/env python3
"""Before/after view of the 稀有资源 icon next to its sibling resource icons."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ICONS = ROOT / "record" / "assets" / "resource-icons"
NEW = ICONS / "rare.png"
OLD = HERE / "backup" / "rare-original.png"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PANEL = (255, 253, 251)
PAGE = (246, 240, 235)
MUTED = (112, 106, 96)
STRONG = (95, 52, 27)
SIBLINGS = ["core", "echoes", "armament", "clothflesh"]


def font(size, bold=False):
    # CJK-capable faces first: Arial exists on every box but has no han glyphs,
    # which renders the Chinese captions as tofu boxes.
    names = (("msyhbd.ttc", "msyh.ttc") if bold else ("msyh.ttc",)) + \
            ("arialbd.ttf", "arial.ttf")
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def tile(img, box, bg):
    """Place an RGBA icon into a box of the given background colour."""
    out = Image.new("RGB", (box, box), bg)
    if img is None:
        return out
    s = min((box - 8) / img.width, (box - 8) / img.height)
    nw, nh = max(1, int(img.width * s)), max(1, int(img.height * s))
    art = img.resize((nw, nh), Image.LANCZOS)
    out.paste(art, ((box - nw) // 2, (box - nh) // 2), art)
    return out


def main() -> None:
    Z = 2
    box = 64 * Z
    pad = 18
    items = [("原来（稀有二字）", Image.open(OLD).convert("RGBA") if OLD.exists() else None),
             ("现在（Glossary）", Image.open(NEW).convert("RGBA"))]
    items += [(n, Image.open(ICONS / f"{n}.png").convert("RGBA")) for n in SIBLINGS]

    W = pad + len(items) * (box + pad)
    H = 34 + box + 52
    img = Image.new("RGB", (W, H), PAGE)
    dr = ImageDraw.Draw(img)
    dr.text((pad, 10), "稀有资源图标 — 前后对比（背景与面板同色）", font=font(15, True),
            fill=STRONG)
    for i, (label, art) in enumerate(items):
        ox = pad + i * (box + pad)
        oy = 34
        dr.rectangle([ox, oy, ox + box, oy + box], fill=PANEL, outline=(227, 212, 200))
        img.paste(tile(art, box, PANEL), (ox, oy))
        tw = dr.textlength(label, font=font(11))
        dr.text((ox + (box - tw) / 2, oy + box + 8), label, font=font(11), fill=MUTED)

    # also show the new icon at the small size it renders at in the card
    small = Image.new("RGB", (pad + 6 * (40 + 8), 62), PAGE)
    d2 = ImageDraw.Draw(small)
    d2.text((pad, 4), "缩略尺寸", font=font(11), fill=MUTED)
    for k, size in enumerate((20, 24, 28, 32, 40, 48)):
        t = tile(Image.open(NEW).convert("RGBA"), size, PANEL)
        small.paste(t, (pad + k * (40 + 8), 20))
    img = Image.new("RGB", (max(W, small.width + 2 * pad), H + small.height + 10), PAGE)
    img.paste(Image.new("RGB", img.size, PAGE), (0, 0))
    dr = ImageDraw.Draw(img)
    dr.text((pad, 10), "稀有资源图标 — 前后对比（背景与面板同色）", font=font(15, True),
            fill=STRONG)
    for i, (label, art) in enumerate(items):
        ox = pad + i * (box + pad)
        oy = 34
        dr.rectangle([ox, oy, ox + box, oy + box], fill=PANEL, outline=(227, 212, 200))
        img.paste(tile(art, box, PANEL), (ox, oy))
        tw = dr.textlength(label, font=font(11))
        dr.text((ox + (box - tw) / 2, oy + box + 8), label, font=font(11), fill=MUTED)
    img.paste(small, (0, H))
    img.save(HERE / "rare-icon-before-after.png")
    print(f"wrote rare-icon-before-after.png {img.size}")


if __name__ == "__main__":
    main()
