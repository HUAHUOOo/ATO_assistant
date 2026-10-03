#!/usr/bin/env python3
"""High-zoom visual comparison of the traced vectors against the source pixels.

Renders each glyph from its SVG path at ``SCALE``x and stacks it under a
nearest/lanczos enlargement of the original crop, so staircase artefacts and
over-smoothing are both obvious.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from trace_icons import load_alpha, trace_alpha
from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
PNG = HERE / "png"

SCALE = 5
SHOW = ["technology", "diplomacy", "adventures", "menu-truth-machine",
        "mnestis-theatre", "map"]
SETTINGS = [
    ("sigma 0.0 / tol 0.30", 0.0, 0.30, 34.0),
    ("sigma 0.0 / tol 0.45", 0.0, 0.45, 34.0),
    ("sigma 0.6 / tol 0.45", 0.6, 0.45, 34.0),
    ("sigma 0.6 / tol 0.80", 0.6, 0.80, 34.0),
]


def main() -> int:
    cell = 120 * SCALE
    pad = 14
    label_w = 170
    sheet = Image.new("RGB", (label_w + len(SETTINGS) * (cell + pad) + pad,
                              len(SHOW) * (cell + pad) + pad + 52), (22, 22, 24))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
        fontb = ImageFont.truetype("arialbd.ttf", 18)
    except OSError:
        font = fontb = ImageFont.load_default()
    dr.text((pad, pad), f"Vector trace vs source, {SCALE}x zoom "
                        f"(top: source pixels, bottom: traced SVG)", font=fontb,
            fill=(235, 235, 235))
    for k, (title, *_rest) in enumerate(SETTINGS):
        dr.text((label_w + k * (cell + pad) + pad, 34), title, font=font,
                fill=(160, 200, 255))

    for r, name in enumerate(SHOW):
        oy = 52 + r * (cell + pad) + pad
        dr.text((pad, oy + cell // 2), name, font=font, fill=(210, 210, 210))
        src = Image.open(PNG / f"{name}.src.png").convert("L")
        alpha = load_alpha(name, 0.0)
        h, w = alpha.shape
        for c, (_t, sigma, tol, corner) in enumerate(SETTINGS):
            ox = label_w + c * (cell + pad) + pad
            field = load_alpha(name, sigma)
            d, _ = trace_alpha(field, tol, corner)
            render = rasterise(parse_path(d), w, h, ss=3, scale=SCALE)
            top = src.resize((w * SCALE, h * SCALE), Image.LANCZOS).convert("RGB")
            bot = Image.fromarray((render * 255).astype(np.uint8), "L").convert("RGB")
            sc = min(cell / top.width, (cell // 2 - 6) / top.height)
            nw, nh = max(1, int(top.width * sc)), max(1, int(top.height * sc))
            top = top.resize((nw, nh), Image.LANCZOS)
            bot = bot.resize((nw, nh), Image.LANCZOS)
            dr.rectangle([ox - 2, oy - 2, ox + cell + 2, oy + cell + 2],
                         outline=(70, 70, 76))
            sheet.paste(top, (ox + (cell - nw) // 2, oy + (cell // 2 - nh) // 2))
            sheet.paste(bot, (ox + (cell - nw) // 2, oy + cell // 2 + 4))
    sheet.save(HERE / "zoom-compare.png")
    print("wrote zoom-compare.png", sheet.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
