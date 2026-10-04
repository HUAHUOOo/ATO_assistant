"""Check the Android import allowlist, optionally inside a built APK.

Run: python tools/test_android_resource_catalog.py [path/to/app.apk]
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

from export_android import asset_studio_catalog

ROOT = Path(__file__).resolve().parents[1]


def check_catalog(catalog: dict) -> None:
    assert catalog["format"] == "ato-android-resource-catalog"
    targets = {}
    for item in catalog["items"]:
        for face, target in item["faces"].items():
            key = (item["id"], face)
            assert key not in targets, f"Duplicate Android catalog entry: {key}"
            targets[key] = target

    template_targets = [target for target in targets.values()
                        if target == "aibp/ps/other/trait/custom_trait_blank.jpg"]
    assert len(template_targets) == 1, "APK lacks the custom trait template import mapping"
    assert not any(target.startswith("technology/images/tech_tree_pages/")
                   for target in targets.values()), "APK still requests obsolete technology tree backgrounds"
    assert any(target.startswith("technology/images/titans/") for target in targets.values())
    assert any(target.startswith("technology/images/gear_cards/") for target in targets.values())

    # C5 战斗版图（story/images/battles/c5/*.jpg）：六场战斗的原页扫描已删除，改用从
    # 补充页裁出的版图块；它们随 .atopack 分发，APK 名单必须能对上这 8 张。
    c5_boards = sorted(
        target for target in targets.values() if target.startswith("story/images/battles/c5/")
    )
    assert len(c5_boards) == 8, f"APK 名单里的 C5 战斗版图不是 8 张：{len(c5_boards)}"
    assert all(re.fullmatch(r"story/images/battles/c5/[a-z0-9-]+\.jpg", target) for target in c5_boards)

    # C5 补充页扫描：只剩 153-173（174-185 是已删除的战斗原页），且全部登记进名单。
    c5_pages = sorted(
        target for target in targets.values() if target.startswith("story/images/c5/supplement-pages/")
    )
    assert len(c5_pages) == 21, f"APK 名单里的 C5 补充页不是 21 页：{len(c5_pages)}"
    deprecated = [target for target in c5_pages if re.search(r"page-1[78][4-9]|page-18[0-5]", target)]
    assert not deprecated, f"APK 名单里仍留着已删除的 C5 战斗原页（174-185）：{deprecated[:3]}"

    # 密语字形（巴别语／塞壬语，story/assets/cryptic/glyphs/*.png）：字形本身不进版本库，
    # 只在本地由 .atopack 的 crypticFiles 段分发，但 APK 名单必须一直引用它们——名单缺项
    # 的话，安卓会把资料包里的字形整段静默跳过。名单来自随源码发布的 glyph-catalog.js，
    # 所以在只有路径名单、没有 PNG 的干净检出里同样成立。
    glyph_targets = sorted(
        target for item in catalog["items"] if item["id"].startswith("common:")
        for target in item["faces"].values()
        if target.startswith("story/assets/cryptic/glyphs/")
    )
    assert len(glyph_targets) == 84, f"APK 名单里的密语字形不是 84 个：{len(glyph_targets)}"
    assert sum(1 for target in glyph_targets if "/babelian-" in target) == 58
    assert sum(1 for target in glyph_targets if "/siren-" in target) == 26
    assert all(re.fullmatch(r"story/assets/cryptic/glyphs/[A-Za-z0-9][A-Za-z0-9._-]*\.png", target)
               for target in glyph_targets), "密语字形目标路径不合规"

    source = (ROOT / "index.html").read_text(encoding="utf-8")
    block = re.search(r"const hiddenExplorationCards = \{([\s\S]*?)\n    \};", source)
    assert block, "Hidden exploration catalog not found; update this coverage check."
    cycles = re.findall(r"(c\d+):\s*\[([^\]]*)\]", block[1])
    assert {cycle for cycle, _ in cycles} == {"c1", "c2", "c3", "c4", "c5"}
    checked = 0
    for cycle, cards in cycles:
        for card_id in re.findall(r'id:\s*"([^\"]+)"', cards):
            key = (f"{cycle}:exploration:cards:{card_id}", "front")
            expected = f"assets/exploration-cards/{cycle}/{card_id}.png"
            assert targets.get(key) == expected, f"Android import catalog missing/mismatched: {key}"
            checked += 1
    assert checked, "No hidden exploration entries checked."
    declared = json.loads((ROOT / "aibp/ps/other/3b6e9d20/catalog.json").read_text(encoding="utf-8"))["targets"]
    assert declared, "Supplemental resource list is empty"
    # 模拟 GitHub 的干净检出：只有路径名单，没有任何 .bin 文件。
    sys.path.insert(0, str(ROOT / "asset-studio"))
    from app.fixed_catalog import collect_supplemental_resources
    with tempfile.TemporaryDirectory(dir=ROOT) as directory:
        checkout = Path(directory)
        manifest = checkout / "aibp/ps/other/3b6e9d20/catalog.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({"version": 1, "targets": declared}), encoding="utf-8")
        items, paths = collect_supplemental_resources(checkout)
        assert paths == {f"aibp/ps/other/{path}" for path in declared}
        for item in items:
            assert targets.get((item.id, "front")) == item.faces["front"], "APK lacks binary import mapping"
    print(f"Android resource catalog passed: {len(targets)} mappings, {checked} hidden exploration entries.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with zipfile.ZipFile(sys.argv[1]) as apk:
            check_catalog(json.loads(apk.read("assets/atopack-catalog.json")))
    else:
        check_catalog(asset_studio_catalog())
