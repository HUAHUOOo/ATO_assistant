#!/usr/bin/env python3
"""Build the shipping deliverables from the traced SVGs.

Produces:
  ato-icon-sprite.svg   <symbol> sprite for <use href="...#ato-icon-map">
  ato-icon-sheet.svg    visible labelled contact sheet
  icons-preview.png     raster of the same sheet, for quick review
  raster/<name>@Nx.png  transparent PNGs rendered from the vectors
  preview.html          self-contained preview at several sizes and colours
  manifest.json         name -> size / source location / path size
"""
from __future__ import annotations

import html
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
SVG = HERE / "svg"
RASTER = HERE / "raster"
RASTER.mkdir(exist_ok=True)

LABELS = {
    "godforms-summons": "Godforms & Summons", "campaign-notes": "Campaign Notes",
    "cargo-hold": "Cargo Hold", "choice-matrix": "Choice Matrix",
    "cryptic-languages": "Cryptic Languages", "fated-events": "Fated Events",
    "mnestis-theatre": "Mnestis Theatre", "binder-audio": "Binder Audio",
    "truth-machine": "Truth Machine",
}


def label(name: str) -> str:
    return LABELS.get(name, name.replace("-", " ").title())


def load() -> list[dict]:
    icons = json.loads((HERE / "icons.json").read_text(encoding="utf-8"))["glyphs"]
    out = []
    for ic in icons:
        name = ic["name"]
        text = (SVG / f"{name}.svg").read_text(encoding="utf-8")
        d = text.split('d="', 1)[1].rsplit('"', 1)[0]
        out.append({"name": name, "label": label(name), "d": d,
                    "w": ic["w"], "h": ic["h"], "screen": ic["screen"],
                    "source_cell": ic["source_cell"]})
    return out


# ------------------------------------------------------------------- SVG output
def write_sprite(icons: list[dict]) -> None:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">']
    for ic in icons:
        parts.append(f'  <symbol id="ato-icon-{ic["name"]}" '
                     f'viewBox="-0.5 -0.5 {ic["w"]} {ic["h"]}">'
                     f'<path fill="currentColor" fill-rule="evenodd" d="{ic["d"]}"/>'
                     f'</symbol>')
    parts.append("</svg>")
    (HERE / "ato-icon-sprite.svg").write_text("\n".join(parts) + "\n", encoding="utf-8")


def write_sheet(icons: list[dict]) -> None:
    cols, cell, pad, top = 6, 170, 18, 74
    rows = (len(icons) + cols - 1) // cols
    W = pad + cols * (cell + pad)
    H = top + rows * (cell + pad)
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'width="{W}" height="{H}">',
         f'<rect width="{W}" height="{H}" fill="#232326"/>',
         f'<text x="{pad}" y="40" fill="#ededed" font-family="Georgia,serif" '
         f'font-size="24">Aeon Trespass: Odyssey app icons</text>',
         f'<text x="{pad}" y="62" fill="#8b8b93" font-family="sans-serif" '
         f'font-size="13">{len(icons)} glyphs traced from the app screenshots '
         f'(white on transparent, currentColor)</text>']
    for i, ic in enumerate(icons):
        r, c = divmod(i, cols)
        ox = pad + c * (cell + pad)
        oy = top + r * (cell + pad)
        s = min((cell - 40) / ic["w"], (cell - 40) / ic["h"])
        tx = ox + (cell - ic["w"] * s) / 2
        ty = oy + (cell - 34 - ic["h"] * s) / 2
        p.append(f'<rect x="{ox}" y="{oy}" width="{cell}" height="{cell}" rx="6" '
                 f'fill="#2f2f33"/>')
        p.append(f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})">'
                 f'<path fill="#ffffff" fill-rule="evenodd" d="{ic["d"]}"/></g>')
        p.append(f'<text x="{ox + cell / 2:.0f}" y="{oy + cell - 11}" fill="#c9c9d1" '
                 f'font-family="Georgia,serif" font-size="12" text-anchor="middle">'
                 f'{html.escape(ic["label"])}</text>')
    p.append("</svg>")
    (HERE / "ato-icon-sheet.svg").write_text("\n".join(p) + "\n", encoding="utf-8")


# -------------------------------------------------------------- raster outputs
def to_image(d: str, w: int, h: int, scale: int, colour=(255, 255, 255)) -> Image.Image:
    a = rasterise(parse_path(d), w, h, ss=3, scale=scale)
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = colour
    rgba[..., 3] = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def write_rasters(icons: list[dict]) -> None:
    for stale in RASTER.glob("*.png"):
        stale.unlink()
    for ic in icons:
        for scale in (2, 4):
            img = to_image(ic["d"], ic["w"], ic["h"], scale)
            img.save(RASTER / f'{ic["name"]}@{scale}x.png')


def write_preview_png(icons: list[dict]) -> None:
    cols, cell, pad, top = 6, 150, 16, 76
    rows = (len(icons) + cols - 1) // cols
    W = pad + cols * (cell + pad)
    H = top + rows * (cell + pad)
    img = Image.new("RGB", (W, H), (35, 35, 38))
    dr = ImageDraw.Draw(img)
    try:
        fontb = ImageFont.truetype("georgia.ttf", 24)
        font = ImageFont.truetype("georgia.ttf", 13)
        small = ImageFont.truetype("arial.ttf", 12)
    except OSError:
        fontb = font = small = ImageFont.load_default()
    dr.text((pad, 22), "Aeon Trespass: Odyssey — app icons (vector)", font=fontb,
            fill=(237, 237, 237))
    dr.text((pad, 52), f"{len(icons)} glyphs traced from the app screenshots "
                       f"into resolution-independent SVG", font=small, fill=(139, 139, 147))
    for i, ic in enumerate(icons):
        r, c = divmod(i, cols)
        ox = pad + c * (cell + pad)
        oy = top + r * (cell + pad)
        dr.rectangle([ox, oy, ox + cell, oy + cell], fill=(47, 47, 51))
        icon = to_image(ic["d"], ic["w"], ic["h"], 1)
        s = min((cell - 44) / icon.width, (cell - 40) / icon.height)
        nw, nh = max(1, int(icon.width * s)), max(1, int(icon.height * s))
        icon = icon.resize((nw, nh), Image.LANCZOS)
        img.paste(icon, (ox + (cell - nw) // 2, oy + (cell - 30 - nh) // 2), icon)
        tw = dr.textlength(ic["label"], font=font)
        dr.text((ox + (cell - tw) / 2, oy + cell - 22), ic["label"], font=font,
                fill=(201, 201, 209))
    img.save(HERE / "icons-preview.png")
    print(f"wrote icons-preview.png ({img.width}x{img.height})")


# ------------------------------------------------------------------- preview.html
def write_html(icons: list[dict]) -> None:
    def inline(ic, px):
        s = px / max(ic["w"], ic["h"])
        return (f'<svg viewBox="-0.5 -0.5 {ic["w"]} {ic["h"]}" width="{ic["w"] * s:.1f}" '
                f'height="{ic["h"] * s:.1f}" aria-label="{ic["label"]}">'
                f'<path fill="currentColor" fill-rule="evenodd" d="{ic["d"]}"/></svg>')

    cards = "\n".join(
        f'''      <figure class="card" style="--w:{ic["w"]}px;--h:{ic["h"]}px">
        <div class="art">{inline(ic, 96)}</div>
        <figcaption>{html.escape(ic["label"])}<span>{ic["w"]}×{ic["h"]} · {ic["name"]}.svg</span></figcaption>
      </figure>''' for ic in icons)

    small = "\n".join(
        f'        <td><span class="tint">{inline(ic, 40)}</span></td>' for ic in icons)

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATO 图标 (SVG)</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; padding:32px; background:#17171a; color:#e9e9ee;
         font:15px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif; }}
  h1 {{ font:600 24px/1.3 Georgia,serif; margin:0 0 6px; }}
  p.lead {{ color:#9a9aa4; margin:0 0 28px; max-width:70ch; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(168px,1fr));
           gap:14px; }}
  .card {{ margin:0; background:#232327; border:1px solid #303036; border-radius:10px;
           padding:18px 12px 12px; display:flex; flex-direction:column;
           align-items:center; gap:12px; }}
  .art {{ height:104px; display:flex; align-items:center; justify-content:center;
          color:#fff; }}
  figcaption {{ font:13px Georgia,serif; text-align:center; color:#d6d6dd; }}
  figcaption span {{ display:block; font:11px/1.5 ui-monospace,monospace;
                     color:#7d7d88; margin-top:2px; }}
  h2 {{ font:600 17px Georgia,serif; margin:40px 0 12px; }}
  table {{ border-collapse:collapse; }}
  td {{ padding:7px 9px; }}
  .tint {{ color:#e2b45c; }}
  .sizes {{ display:flex; align-items:flex-end; gap:26px; flex-wrap:wrap;
            background:#232327; border:1px solid #303036; border-radius:10px;
            padding:20px; }}
  .sizes div {{ text-align:center; color:#fff; }}
  .sizes small {{ display:block; color:#7d7d88; font:11px ui-monospace,monospace;
                  margin-top:6px; }}
</style>
</head>
<body>
  <h1>Aeon Trespass: Odyssey — 界面图标</h1>
  <p class="lead">从两张 App 截图中提取的 {len(icons)} 个白色字形，已转成 SVG 矢量图。
     颜色由 <code>currentColor</code> 决定，可任意放大、改色、加描边。用浏览器缩放页面即可
     验证它们在任何尺寸下都保持锐利。</p>

  <h2>全部图标</h2>
  <div class="grid">
{cards}
  </div>

  <h2>同一批矢量，不同尺寸</h2>
  <div class="sizes">
    <div>{inline(icons[0], 20)}<small>20px</small></div>
    <div>{inline(icons[0], 32)}<small>32px</small></div>
    <div>{inline(icons[0], 64)}<small>64px</small></div>
    <div>{inline(icons[0], 128)}<small>128px</small></div>
    <div>{inline(icons[0], 224)}<small>224px</small></div>
  </div>

  <h2>改色（CSS color 即可）</h2>
  <table>
    <tr>
{small}
    </tr>
  </table>
</body>
</html>
"""
    (HERE / "preview.html").write_text(doc, encoding="utf-8")


def main() -> None:
    icons = load()
    write_sprite(icons)
    write_sheet(icons)
    write_preview_png(icons)
    write_rasters(icons)
    write_html(icons)
    (HERE / "manifest.json").write_text(json.dumps(
        [{k: v for k, v in ic.items() if k != "d"} for ic in icons],
        indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"built deliverables for {len(icons)} icons")


if __name__ == "__main__":
    main()
