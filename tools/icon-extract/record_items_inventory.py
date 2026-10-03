#!/usr/bin/env python3
"""Inventory every labelled item on the record page, static and JS-rendered."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "record" / "index.html"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

html = PAGE.read_text(encoding="utf-8")

print("=== 静态：identity-grid 的字段 ===")
m = re.search(r'<div class="panel-body identity-grid" id="identityGridPanel">(.*?)\n          </div>',
              html, re.S)
if m:
    blk = m.group(1)
    for lab in re.finditer(r'<label([^>]*)>\s*([^<]+?)\s*<input', blk):
        cycle = re.search(r'data-cycle-field="([^"]*)"', lab.group(1))
        note = re.sub(r'\s+', ' ', lab.group(2)).strip()
        print(f"   {note:<14} cycles={cycle.group(1) if cycle else '-'}")
    for div in re.finditer(r'<div class="identity-mark-field">(.*?)</div>', blk, re.S):
        lab = re.search(r'<label>([^<]+)<input', div.group(1))
        if lab:
            print(f"   {lab.group(1).strip():<14} cycles=c4 (mark)")

print("\n=== 静态：notes-grid 的字段 ===")
m = re.search(r'<div class="panel-body notes-grid">(.*?)\n          </div>', html, re.S)
if m:
    for lab in re.finditer(r'<label[^>]*>\s*([^<]+?)\s*<textarea', m.group(1)):
        print("   ", lab.group(1).strip())

print("\n=== JS：renderTrack 生成的轨道标题 ===")
for call in re.finditer(r'renderTrack\(\s*elements\.(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',
                        html):
    print(f"   {call.group(2):<10} {call.group(3):<12} -> elements.{call.group(1)}")

print("\n=== JS：其它生成出来的可见标签 ===")
for pat, label in [(r'renderCrewCounterCard\(grid,\s*"(\w+)",\s*"([^"]+)"', 'crew counter'),
                   (r'renderTrack\(\s*[^,]+,\s*"([^"]+)"', 'track'),
                   (r'\[\s*"(rare|echoes|priests|core)"\s*,\s*"([^"]+)"', 'resource')]:
    hits = re.findall(pat, html)
    if hits:
        print(f"   {label}: {hits[:8]}")

print("\n=== 是否存在“阿尔戈号知识 / Argo Knowledge”字段 ===")
for m2 in re.finditer(r'.{0,40}(阿尔戈号知识|argoKnowledge|knowledge).{0,40}', html):
    s = m2.group(0).replace("\n", " ")
    if 'Nymph' in s or 'nymph' in s:
        continue
    print("   ", s.strip()[:110])
