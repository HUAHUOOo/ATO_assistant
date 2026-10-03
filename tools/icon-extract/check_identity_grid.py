#!/usr/bin/env python3
"""Structural check: the identity grid must stay well-formed after the mark edits."""
from __future__ import annotations

import sys
from pathlib import Path

from lxml import html as LH

ROOT = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
doc = LH.fromstring((ROOT / "record" / "index.html").read_text(encoding="utf-8"))

grid = doc.get_element_by_id("identityGridPanel")
kids = [c for c in grid if c.tag is not None]
print(f"#identityGridPanel children: {len(kids)}")
for c in kids:
    field = c.get("data-cycle-field") or "(always)"
    label = " ".join(c.text_content().split())[:34]
    print(f"   <{c.tag}> {c.get('class') or '-':22s} field={field:16s} {label!r}")

names = doc.xpath('//*[hasclass("identity-mark-name")]') if False else []
names = [e for e in doc.iter() if e.get("class") == "identity-mark-name"]
print("\nmark fields:", [e.text_content().strip() for e in names])
hidden = [e.get("data-cycle-bind") for e in doc.iter()
          if e.tag == "input" and e.get("type") == "hidden"]
print("hidden binds:", hidden)
print("reapMark/sowMark inputs left:",
      doc.xpath('//input[@data-cycle-bind="reapMark" or @data-cycle-bind="sowMark"]'))
