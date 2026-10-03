"""主控台界面图标走资料包通道：导出写 iconFiles、导入进素材库、安装落回 assets/icons/。

运行（在 asset-studio 目录下）：python -m unittest tests.test_icon_resources -v

和 test_bgm_resources.py 同一套路：这些字形是从原 App 截图里提取的界面素材，不进版本库
（.gitignore 的 /assets/* 与 *.svg），只能随 .atopack 分发。所以这里盯住四件事——
收集器只认规范命名的 .svg、导出/导入/安装的往返、打成包后版本号不变（附加字段）、
以及打包器与安装侧的类型白名单确实放行了 assets/icons/ 下的 SVG。
"""
from __future__ import annotations

import hashlib
import json
import shutil
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app.icon_resources import LIBRARY as ICON_LIBRARY
from app.icon_resources import checked_bytes, collect
from app.db import Database
from app.installer import apply_install, install_plan, installable_relative
from app.packages import export_compat, export_package, import_package, inspect_package
from tools.update_full_pack import update_full_pack

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".local" / "tests" / "icon-resources"

SVG_ONE = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>\n'
SVG_TWO = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M0 0h12v12H0z"/></svg>\n'


class IconResourceTests(unittest.TestCase):
    def setUp(self) -> None:
        shutil.rmtree(SCRATCH, ignore_errors=True)
        icons = SCRATCH / "ato" / "assets" / "icons"
        icons.mkdir(parents=True)
        self.source = SCRATCH / "ato"
        (self.source / "index.html").touch()
        (icons / "argo.svg").write_bytes(SVG_ONE)
        (icons / "argo-knowledge.svg").write_bytes(SVG_TWO)
        # 清单与不合规的名字（空格、大写后缀、非 SVG）应被忽略，而不是让整包导出失败。
        (icons / "manifest.json").write_text('{"count": 2}\n', encoding="utf-8")
        (icons / "带空格的 名字.svg").write_bytes(b"<svg/>")
        (icons / "UPPER.SVG").write_bytes(b"<svg/>")
        (icons / "notes.txt").write_text("note\n", encoding="utf-8")
        self.library = SCRATCH / "library"
        self.library.mkdir()
        self.db = Database(self.library / "db.sqlite")
        self.pack = SCRATCH / "icons.atopack"

    def tearDown(self) -> None:
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def test_collect_only_svg(self) -> None:
        targets = [target for target, _ in collect(self.source)]
        self.assertEqual(
            ["assets/icons/argo-knowledge.svg", "assets/icons/argo.svg"], targets
        )

    def test_export_inspect_import_install_roundtrip(self) -> None:
        without = SCRATCH / "without-icons.atopack"
        export_package(self.db, self.library, without, {"include_icons": False}, ato_root=self.source)
        export_package(self.db, self.library, self.pack, ato_root=self.source)
        result = inspect_package(self.db, self.pack)
        self.assertEqual(2, result["icon_files"])
        # iconFiles 是附加字段，不改变资料包版本号，老读取方会直接忽略。
        versions = []
        for path in (without, self.pack):
            with zipfile.ZipFile(path) as archive:
                versions.append(json.loads(archive.read("manifest.json").decode("utf-8"))["version"])
        self.assertEqual(versions[0], versions[1])

        with zipfile.ZipFile(self.pack) as archive:
            names = set(archive.namelist())
            self.assertIn("assets/icons/argo.svg", names)
            self.assertNotIn("assets/icons/manifest.json", names)
            self.assertNotIn("assets/icons/notes.txt", names)
            record = result["manifest"]["iconFiles"][0]
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "sha256": "0" * 64})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "assets/icons/../evil.svg"})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "assets/bgm/evil.svg"})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "story/data/evil.svg"})

        imported = import_package(self.db, self.library, self.pack)
        self.assertEqual(2, imported["icon_imported"])
        stored = self.library / ICON_LIBRARY / "assets" / "icons" / "argo.svg"
        self.assertEqual(SVG_ONE, stored.read_bytes())

        installed = SCRATCH / "installed"
        installed.mkdir()
        (installed / "index.html").touch()
        for folder in ("aibp", "map", "story"):
            (installed / folder).mkdir()
        plan = install_plan(self.db, self.library, installed)
        icon_entries = [entry for entry in plan["files"] if entry["item_id"] == "icons"]
        self.assertEqual(2, len(icon_entries))
        self.assertTrue(all(entry["direct_copy"] for entry in icon_entries))
        self.assertTrue(all(entry["status"] == "add" for entry in icon_entries))
        apply_install(self.db, self.library, installed, [])
        self.assertEqual(SVG_TWO, (installed / "assets" / "icons" / "argo-knowledge.svg").read_bytes())
        # 安装只落字形，不碰 assets/icons/ 里的清单。
        self.assertFalse((installed / "assets" / "icons" / "manifest.json").exists())

        again = install_plan(self.db, self.library, installed)
        self.assertTrue(all(entry["status"] == "same" for entry in again["files"] if entry["item_id"] == "icons"))

    def test_reexport_without_root_uses_library_copy(self) -> None:
        export_package(self.db, self.library, self.pack, ato_root=self.source)
        import_package(self.db, self.library, self.pack)
        shutil.rmtree(self.source / "assets" / "icons")  # 模拟只有素材库、根目录没放字形的机器
        second = SCRATCH / "second.atopack"
        export_package(self.db, self.library, second)
        with zipfile.ZipFile(second) as archive:
            self.assertEqual(SVG_ONE, archive.read("assets/icons/argo.svg"))

    def test_export_can_skip_icons(self) -> None:
        export_package(self.db, self.library, self.pack, {"include_icons": False}, ato_root=self.source)
        with zipfile.ZipFile(self.pack) as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        self.assertNotIn("iconFiles", manifest)

    def test_compat_zip_carries_icons(self) -> None:
        compat = SCRATCH / "compat.zip"
        export_compat(self.db, self.library, compat, {"include_stories": False}, None, self.source)
        with zipfile.ZipFile(compat) as archive:
            self.assertIn("assets/icons/argo.svg", archive.namelist())

    def test_install_whitelist_allows_only_icon_dir(self) -> None:
        """安装侧的 .svg 白名单只放行 assets/icons/，别处一律拒绝。"""
        self.assertEqual("assets/icons/argo.svg", installable_relative("assets/icons/argo.svg"))
        for bad in ("assets/argo.svg", "story/data/argo.svg", "assets/icons/../../index.html"):
            with self.assertRaises(ValueError):
                installable_relative(bad)

    def test_fan_pack_carries_icons(self) -> None:
        """打包引擎把 assets/icons/ 写进 iconFiles 段；--no-icons 时整段不出现。"""
        from tools.build_fan_pack import Reporter, build as build_fan_pack

        card = {
            "id": "common:card", "cycle": "common", "module": "决战版图",
            "subgroup": "战斗版图", "name": "决战版图", "number": "card",
            "sort_order": 1, "faces": {"front": "assets/cards/001.jpg"},
            "capture_required": True,
        }
        project = SCRATCH / "project"
        (project / "assets" / "cards").mkdir(parents=True)
        (project / "assets" / "icons").mkdir(parents=True)
        (project / "assets" / "cards" / "001.jpg").write_bytes(b"card-bytes")
        (project / "assets" / "icons" / "argo.svg").write_bytes(SVG_ONE)
        (project / "assets" / "icons" / "manifest.json").write_text("{}\n", encoding="utf-8")
        (project / "index.html").write_text("ATO", encoding="utf-8")

        catalog = {"source": {"catalog_version": "test-icons"}, "items": [card]}
        kwargs = {
            "ato_root": project, "library_path": None, "cycles": [], "modules": [],
            "complete_only": False, "include_story_data": False, "include_bgm": False,
            "include_story_files": False, "official_story": False, "official_scans": False,
            "official_assets": False, "skip_missing": False, "force": True, "dry_run": False,
            "compression_name": "store", "verify_mode": "full", "verify_sample": 32,
            "reporter": Reporter(quiet=True),
        }
        for name, include, expected in (
            ("with.atopack", True, 1),
            ("without.atopack", False, 0),
        ):
            output = SCRATCH / name
            with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
                result = build_fan_pack(output=output, include_icons=include, **kwargs)
            self.assertEqual(expected, result.icon_files)
            with zipfile.ZipFile(output) as archive:
                manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
                if include:
                    self.assertEqual("assets/icons/argo.svg", manifest["iconFiles"][0]["target"])
                    self.assertEqual(hashlib.sha256(SVG_ONE).hexdigest(),
                                     manifest["iconFiles"][0]["sha256"])
                    self.assertEqual(SVG_ONE, archive.read("assets/icons/argo.svg"))
                    self.assertTrue(manifest["build"]["iconsIncluded"])
                    self.assertNotIn("assets/icons/manifest.json", archive.namelist())
                else:
                    self.assertNotIn("iconFiles", manifest)

    def test_update_full_pack_carries_icons(self) -> None:
        """重建完整资料包（update_full_pack）同样要把 assets/icons/ 写进 iconFiles。"""
        card = {
            "id": "common:card", "cycle": "common", "module": "决战版图",
            "subgroup": "战斗版图", "name": "决战版图", "number": "card",
            "sort_order": 1, "faces": {"front": "assets/cards/001.jpg"},
            "capture_required": True,
        }
        entities = json.dumps({"entities": [{"id": "a", "name": "A"}]}).encode("utf-8")
        base = SCRATCH / "base.atopack"
        with zipfile.ZipFile(base, "w") as archive:
            archive.writestr("assets/cards/001.jpg", b"old card")
            archive.writestr("story/entity-index.json", entities)
            archive.writestr("manifest.json", json.dumps({
                "format": "ato-asset-pack", "version": 2, "items": [card],
                "assets": [{"itemId": "common:card", "face": "front",
                            "sha256": hashlib.sha256(b"old card").hexdigest(),
                            "member": "assets/cards/001.jpg", "mimeType": "image/jpeg",
                            "originalName": "001.jpg"}],
                "storyFiles": [{"kind": "entity-index", "member": "story/entity-index.json",
                                "target": "story/data/entity-index.json",
                                "sha256": hashlib.sha256(entities).hexdigest(),
                                "bytes": len(entities), "entityCount": 1}],
            }))

        overlay = SCRATCH / "overlay"
        (overlay / "assets" / "cards").mkdir(parents=True)
        (overlay / "assets" / "icons").mkdir(parents=True)
        (overlay / "assets" / "cards" / "001.jpg").write_bytes(b"current card")
        (overlay / "assets" / "icons" / "argo.svg").write_bytes(SVG_ONE)
        (overlay / "assets" / "icons" / "manifest.json").write_text("{}\n", encoding="utf-8")

        catalog = {"source": {"catalog_version": "test-icons"}, "items": [card]}
        destination = SCRATCH / "updated.atopack"
        with patch("tools.update_full_pack.fixed_catalog_payload", return_value=catalog):
            result = update_full_pack(base, destination, overlay)
        self.assertEqual(1, result["icon_files"])

        with zipfile.ZipFile(destination) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual("assets/icons/argo.svg", manifest["iconFiles"][0]["target"])
            self.assertEqual(hashlib.sha256(SVG_ONE).hexdigest(),
                             manifest["iconFiles"][0]["sha256"])
            self.assertEqual(SVG_ONE, archive.read("assets/icons/argo.svg"))
            self.assertTrue(manifest["build"]["iconsIncluded"])
            # 字形不进图片清单，只出现在 iconFiles 段；清单文件不随包分发。
            self.assertEqual(["assets/cards/001.jpg"], [a["member"] for a in manifest["assets"]])
            self.assertNotIn("assets/icons/manifest.json", archive.namelist())
            self.assertEqual(b"current card", archive.read("assets/cards/001.jpg"))
            # iconFiles 是附加字段，不改变资料包版本号。
            self.assertEqual(2, manifest["version"])


if __name__ == "__main__":
    unittest.main()
