"""密语字形（巴别语／塞壬语）走资料包通道：导出写 crypticFiles、导入进素材库、安装落回工程目录。

运行（在 asset-studio 目录下）：python -m unittest tests.test_cryptic_resources -v

和 test_icon_resources.py / test_bgm_resources.py 同一套路：这些 PNG 是第三方字形素材，
不进版本库（.gitignore 的 *.png），只能随 .atopack 分发。这里盯住五件事——
收集器只认规范命名的 .png、导出/导入/安装的往返、打成包后版本号不变（附加字段）、
打包器与安装侧的类型白名单确实放行了 story/assets/cryptic/glyphs/ 下的 PNG，
以及内置清单把 84 张字形登记成「不需要拍摄」的条目（这样它们才会进 APK 名单）。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app.cryptic_resources import GLYPH_DIR, LIBRARY as CRYPTIC_LIBRARY
from app.cryptic_resources import checked_bytes, collect, glyph_names
from app.db import Database
from app.fixed_catalog import fixed_catalog_payload
from app.installer import apply_install, install_plan, installable_relative
from app.packages import export_compat, export_package, import_package, inspect_package
from tools.update_full_pack import update_full_pack

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".local" / "tests" / "cryptic-resources"

PNG_ONE = b"\x89PNG\r\n\x1a\n" + b"babelian-one" * 4
PNG_TWO = b"\x89PNG\r\n\x1a\n" + b"siren-one" * 4


class CrypticResourceTests(unittest.TestCase):
    def setUp(self) -> None:
        shutil.rmtree(SCRATCH, ignore_errors=True)
        glyphs = SCRATCH / "ato" / "story" / "assets" / "cryptic" / "glyphs"
        glyphs.mkdir(parents=True)
        self.source = SCRATCH / "ato"
        (self.source / "index.html").touch()
        (glyphs / "babelian-01.png").write_bytes(PNG_ONE)
        (glyphs / "siren-01.png").write_bytes(PNG_TWO)
        # 不合规的名字与其它格式应被忽略，而不是让整包导出失败。
        (glyphs / "带空格的 名字.png").write_bytes(PNG_ONE)
        (glyphs / "UPPER.PNG").write_bytes(PNG_ONE)
        (glyphs / "notes.txt").write_text("note\n", encoding="utf-8")
        (self.source / "story" / "assets" / "cryptic" / "glyph-catalog.js").write_text(
            'const data={"babelian":[{"index":0,"src":"./assets/cryptic/glyphs/babelian-01.png"}]};',
            encoding="utf-8",
        )
        self.library = SCRATCH / "library"
        self.library.mkdir()
        self.db = Database(self.library / "db.sqlite")
        self.pack = SCRATCH / "cryptic.atopack"

    def tearDown(self) -> None:
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def test_collect_only_png(self) -> None:
        targets = [target for target, _ in collect(self.source)]
        self.assertEqual(
            [f"{GLYPH_DIR}/babelian-01.png", f"{GLYPH_DIR}/siren-01.png"], targets
        )

    def test_glyph_names_come_from_glyph_catalog(self) -> None:
        """清单来自随源码发布的 glyph-catalog.js，不依赖本地有没有 PNG。"""
        self.assertEqual(("babelian-01.png",), glyph_names(self.source))
        shutil.rmtree(self.source / "story" / "assets" / "cryptic" / "glyphs")
        self.assertEqual(("babelian-01.png",), glyph_names(self.source))
        (self.source / "story" / "assets" / "cryptic" / "glyph-catalog.js").unlink()
        self.assertEqual((), glyph_names(self.source))

    def test_export_inspect_import_install_roundtrip(self) -> None:
        without = SCRATCH / "without-cryptic.atopack"
        export_package(self.db, self.library, without, {"include_cryptic": False}, ato_root=self.source)
        export_package(self.db, self.library, self.pack, ato_root=self.source)
        result = inspect_package(self.db, self.pack)
        self.assertEqual(2, result["cryptic_files"])
        # crypticFiles 是附加字段，不改变资料包版本号，老读取方会直接忽略。
        versions = []
        for path in (without, self.pack):
            with zipfile.ZipFile(path) as archive:
                versions.append(json.loads(archive.read("manifest.json").decode("utf-8"))["version"])
        self.assertEqual(versions[0], versions[1])

        with zipfile.ZipFile(self.pack) as archive:
            names = set(archive.namelist())
            self.assertIn(f"{GLYPH_DIR}/babelian-01.png", names)
            self.assertNotIn(f"{GLYPH_DIR}/notes.txt", names)
            self.assertNotIn(f"{GLYPH_DIR}/UPPER.PNG", names)
            record = result["manifest"]["crypticFiles"][0]
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "sha256": "0" * 64})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "story/assets/cryptic/../evil.png"})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "assets/icons/argo.svg"})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "target": "story/data/evil.png"})
            with self.assertRaises(ValueError):
                checked_bytes(archive, {**record, "member": "story/data/elsewhere.png"})

        imported = import_package(self.db, self.library, self.pack)
        self.assertEqual(2, imported["cryptic_imported"])
        stored = self.library / CRYPTIC_LIBRARY / GLYPH_DIR / "babelian-01.png"
        self.assertEqual(PNG_ONE, stored.read_bytes())

        installed = SCRATCH / "installed"
        installed.mkdir()
        (installed / "index.html").touch()
        for folder in ("aibp", "map", "story"):
            (installed / folder).mkdir()
        plan = install_plan(self.db, self.library, installed)
        cryptic_entries = [entry for entry in plan["files"] if entry["item_id"] == "cryptic"]
        self.assertEqual(2, len(cryptic_entries))
        self.assertTrue(all(entry["direct_copy"] for entry in cryptic_entries))
        self.assertTrue(all(entry["status"] == "add" for entry in cryptic_entries))
        apply_install(self.db, self.library, installed, [])
        self.assertEqual(
            PNG_TWO, (installed / GLYPH_DIR / "siren-01.png").read_bytes()
        )
        # 安装只落字形，不碰同目录下的清单文件。
        self.assertFalse((installed / GLYPH_DIR / "notes.txt").exists())

        again = install_plan(self.db, self.library, installed)
        self.assertTrue(all(entry["status"] == "same" for entry in again["files"] if entry["item_id"] == "cryptic"))

    def test_reexport_without_root_uses_library_copy(self) -> None:
        export_package(self.db, self.library, self.pack, ato_root=self.source)
        import_package(self.db, self.library, self.pack)
        shutil.rmtree(self.source / "story" / "assets" / "cryptic" / "glyphs")
        second = SCRATCH / "second.atopack"
        export_package(self.db, self.library, second)
        with zipfile.ZipFile(second) as archive:
            self.assertEqual(PNG_ONE, archive.read(f"{GLYPH_DIR}/babelian-01.png"))

    def test_export_can_skip_cryptic(self) -> None:
        export_package(self.db, self.library, self.pack, {"include_cryptic": False}, ato_root=self.source)
        with zipfile.ZipFile(self.pack) as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        self.assertNotIn("crypticFiles", manifest)

    def test_compat_zip_carries_cryptic(self) -> None:
        compat = SCRATCH / "compat.zip"
        export_compat(self.db, self.library, compat, {"include_stories": False}, None, self.source)
        with zipfile.ZipFile(compat) as archive:
            self.assertIn(f"{GLYPH_DIR}/babelian-01.png", archive.namelist())

    def test_install_whitelist_keeps_existing_image_paths(self) -> None:
        """密语字形落回固定前缀；story/ 下既有的 PNG 目录项不受影响。"""
        self.assertEqual(
            f"{GLYPH_DIR}/babelian-01.png", installable_relative(f"{GLYPH_DIR}/babelian-01.png")
        )
        for bad in (
            f"{GLYPH_DIR}/../../../../index.png",
            f"{GLYPH_DIR}/babelian-01.svg",
            "story/assets/cryptic/glyphs",
        ):
            with self.assertRaises(ValueError):
                installable_relative(bad)
        # 内置清单里本来就有的图片目标（含 story/ 下的 PNG）照旧通过。
        for good in (
            "story/images/OO/DY1P5.png",
            "story/images/battles/c1/001.jpg",
            "assets/cards/001.jpg",
            "assets/icons/argo.svg",
        ):
            self.assertEqual(good, installable_relative(good))

    def test_catalog_lists_every_glyph_without_capture(self) -> None:
        """内置清单登记全部字形，capture_required=False（字形不该出现在拍摄清单里）。"""
        payload = fixed_catalog_payload()
        glyphs = [item for item in payload["items"] if item["module"] == "密语字形"]
        self.assertEqual(84, len(glyphs))
        self.assertEqual(58, sum(1 for item in glyphs if item["number"].startswith("babelian-")))
        self.assertEqual(26, sum(1 for item in glyphs if item["number"].startswith("siren-")))
        for item in glyphs:
            self.assertFalse(item["capture_required"])
            self.assertEqual(f"{GLYPH_DIR}/{item['number']}", item["faces"]["front"])

    def test_fan_pack_carries_cryptic(self) -> None:
        """打包引擎把字形写进 crypticFiles 段；--no-cryptic 时整段不出现。"""
        from tools.build_fan_pack import Reporter, build as build_fan_pack

        card = {
            "id": "common:card", "cycle": "common", "module": "决战版图",
            "subgroup": "战斗版图", "name": "决战版图", "number": "card",
            "sort_order": 1, "faces": {"front": "assets/cards/001.jpg"},
            "capture_required": True,
        }
        project = SCRATCH / "project"
        (project / "assets" / "cards").mkdir(parents=True)
        (project / GLYPH_DIR).mkdir(parents=True)
        (project / "assets" / "cards" / "001.jpg").write_bytes(b"card-bytes")
        (project / GLYPH_DIR / "babelian-01.png").write_bytes(PNG_ONE)
        (project / GLYPH_DIR / "notes.txt").write_text("note\n", encoding="utf-8")
        (project / "index.html").write_text("ATO", encoding="utf-8")

        catalog = {"source": {"catalog_version": "test-cryptic"}, "items": [card]}
        kwargs = {
            "ato_root": project, "library_path": None, "cycles": [], "modules": [],
            "complete_only": False, "include_story_data": False, "include_bgm": False,
            "include_icons": False, "include_story_files": False, "official_story": False,
            "official_scans": False, "official_assets": False, "skip_missing": False,
            "force": True, "dry_run": False, "compression_name": "store",
            "verify_mode": "full", "verify_sample": 32, "reporter": Reporter(quiet=True),
        }
        for name, include, expected in (
            ("with.atopack", True, 1),
            ("without.atopack", False, 0),
        ):
            output = SCRATCH / name
            with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
                result = build_fan_pack(output=output, include_cryptic=include, **kwargs)
            self.assertEqual(expected, result.cryptic_files)
            with zipfile.ZipFile(output) as archive:
                manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
                if include:
                    target = f"{GLYPH_DIR}/babelian-01.png"
                    self.assertEqual(target, manifest["crypticFiles"][0]["target"])
                    self.assertEqual(hashlib.sha256(PNG_ONE).hexdigest(),
                                     manifest["crypticFiles"][0]["sha256"])
                    self.assertEqual("image/png", manifest["crypticFiles"][0]["mimeType"])
                    self.assertEqual(PNG_ONE, archive.read(target))
                    self.assertTrue(manifest["build"]["crypticIncluded"])
                    self.assertNotIn(f"{GLYPH_DIR}/notes.txt", archive.namelist())
                else:
                    self.assertNotIn("crypticFiles", manifest)

    def test_incremental_export_reuses_and_updates_glyphs(self) -> None:
        """增量打包：未改动的字形搬旧字节、改动的重读、新增的补进来。

        字形和 BGM / 界面图标一样排在图片清单之外，走 reuse_plain_file 的
        「mtime 一致 → 直接复用；否则大小 + CRC32 复核」这条路径，所以这里既盯住
        「复用没把新字节漏掉」，也盯住「新增一张字形要真的进包」。
        """
        from tools.build_fan_pack import Reporter, build as build_fan_pack

        card = {
            "id": "common:card", "cycle": "common", "module": "决战版图",
            "subgroup": "战斗版图", "name": "决战版图", "number": "card",
            "sort_order": 1, "faces": {"front": "assets/cards/001.jpg"},
            "capture_required": True,
        }
        project = SCRATCH / "incr-project"
        glyphs = project / GLYPH_DIR
        (project / "assets" / "cards").mkdir(parents=True)
        glyphs.mkdir(parents=True)
        (project / "assets" / "cards" / "001.jpg").write_bytes(b"card-bytes")
        (project / "index.html").write_text("ATO", encoding="utf-8")
        babelian = glyphs / "babelian-01.png"
        siren = glyphs / "siren-01.png"
        babelian.write_bytes(PNG_ONE)
        siren.write_bytes(PNG_TWO)

        catalog = {"source": {"catalog_version": "test-cryptic"}, "items": [card]}
        kwargs = {
            "ato_root": project, "library_path": None, "cycles": [], "modules": [],
            "complete_only": False, "include_story_data": False, "include_bgm": False,
            "include_icons": False, "include_story_files": False, "official_story": False,
            "official_scans": False, "official_assets": False, "skip_missing": False,
            "force": True, "dry_run": False, "compression_name": "store",
            "verify_mode": "full", "verify_sample": 32, "reporter": Reporter(quiet=True),
        }
        base = SCRATCH / "incremental-base.atopack"
        with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
            first = build_fan_pack(output=base, **kwargs)
        self.assertEqual(2, first.cryptic_files)
        with zipfile.ZipFile(base) as archive:
            base_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        base_digests = {
            str(entry["member"]): str(entry["sha256"])
            for section in ("resourceFiles", "bgmFiles", "iconFiles", "crypticFiles")
            for entry in base_manifest.get(section, []) or []
        }

        # 1) 改一张字形的内容；2) 再新增一张。两种变化都必须反映到新包里。
        changed = b"\x89PNG\r\n\x1a\n" + b"babelian-one-changed" * 4
        babelian.write_bytes(changed)
        added = glyphs / "siren-02.png"
        added.write_bytes(b"\x89PNG\r\n\x1a\n" + b"siren-two" * 4)

        second = SCRATCH / "incremental-second.atopack"
        with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
            result = build_fan_pack(output=second, incremental_from=base, **kwargs)

        self.assertEqual(3, result.cryptic_files)
        self.assertGreater(result.reused_members, 0, "未改动的成员应从底包复用")
        babelian_target = f"{GLYPH_DIR}/babelian-01.png"
        siren_target = f"{GLYPH_DIR}/siren-01.png"
        added_target = f"{GLYPH_DIR}/siren-02.png"
        with zipfile.ZipFile(base) as archive:
            old_siren = archive.read(siren_target)
        with zipfile.ZipFile(second) as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            entries = {str(entry["target"]): entry for entry in manifest["crypticFiles"]}
            self.assertEqual({babelian_target, siren_target, added_target}, set(entries))
            # 改动的字形：包内字节与哈希都是当前磁盘内容，不是底包那份。
            self.assertEqual(changed, archive.read(babelian_target))
            self.assertEqual(hashlib.sha256(changed).hexdigest(), entries[babelian_target]["sha256"])
            self.assertEqual(len(changed), entries[babelian_target]["bytes"])
            self.assertNotEqual(base_digests[babelian_target], entries[babelian_target]["sha256"])
            # 未改动的字形：字节与哈希沿用底包。
            self.assertEqual(old_siren, archive.read(siren_target))
            self.assertEqual(base_digests[siren_target], entries[siren_target]["sha256"])
            # 新增的字形：哈希与字节都是新算的。
            self.assertEqual(hashlib.sha256(added.read_bytes()).hexdigest(), entries[added_target]["sha256"])
            self.assertEqual(added.read_bytes(), archive.read(added_target))

    def test_incremental_export_detects_stale_bytes_with_same_mtime(self) -> None:
        """源文件内容变了但 mtime 没变时，大小 + CRC32 复核必须拦下底包的旧字节。"""
        from tools.build_fan_pack import Reporter, build as build_fan_pack

        card = {
            "id": "common:card", "cycle": "common", "module": "决战版图",
            "subgroup": "战斗版图", "name": "决战版图", "number": "card",
            "sort_order": 1, "faces": {"front": "assets/cards/001.jpg"},
            "capture_required": True,
        }
        project = SCRATCH / "crc-project"
        glyphs = project / GLYPH_DIR
        (project / "assets" / "cards").mkdir(parents=True)
        glyphs.mkdir(parents=True)
        (project / "assets" / "cards" / "001.jpg").write_bytes(b"card-bytes")
        (project / "index.html").write_text("ATO", encoding="utf-8")
        glyph = glyphs / "babelian-01.png"
        glyph.write_bytes(PNG_ONE)

        catalog = {"source": {"catalog_version": "test-cryptic"}, "items": [card]}
        kwargs = {
            "ato_root": project, "library_path": None, "cycles": [], "modules": [],
            "complete_only": False, "include_story_data": False, "include_bgm": False,
            "include_icons": False, "include_story_files": False, "official_story": False,
            "official_scans": False, "official_assets": False, "skip_missing": False,
            "force": True, "dry_run": False, "compression_name": "store",
            "verify_mode": "full", "verify_sample": 32, "reporter": Reporter(quiet=True),
        }
        base = SCRATCH / "crc-base.atopack"
        with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
            build_fan_pack(output=base, **kwargs)

        # 同样长度、同样 mtime，仅内容不同：mtime 那条捷径会误判，CRC32 兜底必须把它挡住。
        stat = glyph.stat()
        replacement = b"\x89PNG\r\n\x1a\n" + b"X" * (len(PNG_ONE) - 8)
        self.assertEqual(len(PNG_ONE), len(replacement))
        glyph.write_bytes(replacement)
        os.utime(glyph, ns=(stat.st_atime_ns, stat.st_mtime_ns))

        second = SCRATCH / "crc-second.atopack"
        with patch("tools.build_fan_pack.fixed_catalog_payload", return_value=catalog):
            build_fan_pack(output=second, incremental_from=base, **kwargs)

        target = f"{GLYPH_DIR}/babelian-01.png"
        with zipfile.ZipFile(second) as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            entry = next(e for e in manifest["crypticFiles"] if e["target"] == target)
            self.assertEqual(hashlib.sha256(replacement).hexdigest(), entry["sha256"])
            self.assertEqual(replacement, archive.read(target), "不能搬底包里的旧字节")

    def test_update_full_pack_carries_cryptic(self) -> None:
        """重建完整资料包（update_full_pack）同样要把字形写进 crypticFiles。"""
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
        (overlay / GLYPH_DIR).mkdir(parents=True)
        (overlay / "assets" / "cards" / "001.jpg").write_bytes(b"current card")
        (overlay / GLYPH_DIR / "babelian-01.png").write_bytes(PNG_ONE)
        (overlay / GLYPH_DIR / "notes.txt").write_text("note\n", encoding="utf-8")

        catalog = {"source": {"catalog_version": "test-cryptic"}, "items": [card]}
        destination = SCRATCH / "updated.atopack"
        with patch("tools.update_full_pack.fixed_catalog_payload", return_value=catalog):
            result = update_full_pack(base, destination, overlay)
        self.assertEqual(1, result["cryptic_files"])

        with zipfile.ZipFile(destination) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            target = f"{GLYPH_DIR}/babelian-01.png"
            self.assertEqual(target, manifest["crypticFiles"][0]["target"])
            self.assertEqual(hashlib.sha256(PNG_ONE).hexdigest(),
                             manifest["crypticFiles"][0]["sha256"])
            self.assertEqual(PNG_ONE, archive.read(target))
            self.assertTrue(manifest["build"]["crypticIncluded"])
            # 字形不进图片清单，只出现在 crypticFiles 段；非 PNG 不随包分发。
            self.assertEqual(["assets/cards/001.jpg"], [a["member"] for a in manifest["assets"]])
            self.assertNotIn(f"{GLYPH_DIR}/notes.txt", archive.namelist())
            self.assertEqual(b"current card", archive.read("assets/cards/001.jpg"))
            # crypticFiles 是附加字段，不改变资料包版本号。
            self.assertEqual(2, manifest["version"])


if __name__ == "__main__":
    unittest.main()
