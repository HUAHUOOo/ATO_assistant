#!/usr/bin/env python3
"""Verify the record-sheet module headings carry exactly one icon each.

过时提醒（2026-10-03）：本脚本检查的是**旧的**内联 `<svg class="panel-icon">` 方案。
图标后来改成了外部字形文件（`assets/icons/<name>.svg` + CSS
`mask-image: var(--icon-src)`），所以这里现在必然报 CHECKS FAILED —— 那是方案变了，
不是图标坏了。要查新方案，去确认每个 `--icon-src` 指向的文件存在即可。

另外：无头 Chrome 不渲染 `mask-image`（实测同一个字形文件用普通 `<img>` 能显示，
自定义属性和直接写 url 两种遮罩写法都是空白），所以别指望用截图验证图标。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from lxml import html as LH

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
CSS = ROOT / "record" / "record.css"

# module title -> glyph it must use
EXPECTED = {
    "循环记录": "timeline",
    "泰坦列表": "titans",
    "神之形态与宁芙": "godforms-summons",
    "船体与船员": "argo",
    "敌人": "evolution",
    "外交": "diplomacy",
    "冒险": "adventures",
    "抉择矩阵": "choice-matrix",
    "资源": "cargo-hold",
    "笔记": "campaign-notes",
}

doc = LH.fromstring(PAGE.read_text(encoding="utf-8"))
panels = doc.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " panel ")]')
print(f"panels on the page: {len(panels)}")

ok = True
seen: set[str] = set()

# every .panel must own exactly one panel-icon, and the title must match
for p in panels:
    icons = p.xpath('.//svg[contains(@class,"panel-icon")]')
    texts = [t.strip() for t in p.xpath(
        './/h2[contains(@class,"")]//text() | .//summary//text()') if t.strip()]
    label = next((t for t in texts if t in EXPECTED), None)
    if label is None:
        # panels without a matched title still must not carry a stray icon
        if icons:
            print(f"  note: a panel has {len(icons)} icon(s) but no known title")
        continue
    seen.add(label)
    n = len(icons)
    status = "OK " if n == 1 else "BAD"
    if n != 1:
        ok = False
    # lxml lowercases attributes
    vb = next((v for k, v in icons[0].items() if k.lower() == "viewbox"), "") if icons else ""
    exp = ROOT / "tools" / "icon-extract" / "svg" / f"{EXPECTED[label]}.svg"
    exp_vb = re.search(r'viewBox="([^"]+)"', exp.read_text(encoding="utf-8")).group(1)
    if vb != exp_vb:
        ok = False
        status = "BAD"
    style = (icons[0].get("style") or "") if icons else ""
    size = re.search(r"--panel-icon-w:(\d+)px;--panel-icon-h:(\d+)px", style)
    w, h = (float(v) for v in exp_vb.split()[2:])
    s = min(17.0 / ((w * h) ** 0.5), 17.0 * 1.25 / max(w, h))
    want = (max(1, round(w * s)), max(1, round(h * s)))
    got = (int(size.group(1)), int(size.group(2))) if size else None
    if got != want:
        ok = False
        status = "BAD"
    print(f"  {status} {label:<10} icons={n} glyph={EXPECTED[label]:<17} "
          f"size={got} want={want}")

missing = set(EXPECTED) - seen
extra = seen - set(EXPECTED)
print(f"all expected modules found: {not missing} (missing: {missing or 'none'})")
if extra:
    print(f"  unexpected: {extra}")

total = len(doc.xpath('//svg[contains(@class,"panel-icon")]'))
print(f"total panel icons: {total} (expect {len(EXPECTED)})")
if total != len(EXPECTED):
    ok = False

css = CSS.read_text(encoding="utf-8")
for token in ["/* 模块标题图标", ".panel-icon {", "width: var(--panel-icon-w, 17px)",
              ".panel-heading.compact {", ".panel-heading.compact h2 {"]:
    hit = token in css
    ok &= hit
    print(f"  css {'OK ' if hit else 'BAD'} {token}")

print("\nALL CHECKS PASSED" if ok and not missing else "\nCHECKS FAILED")
sys.exit(0 if ok and not missing else 1)
