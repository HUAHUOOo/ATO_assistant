"""Synthetic checks: optional local media must never leak into source releases."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "mixed_media_package_common", ROOT / "tools/packaging/package_common.py"
)
packaging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packaging)


class MixedMediaReleaseTest(unittest.TestCase):
    private_paths = (
        "story/assets/mixed-media/mapping.js",
        "story/assets/mixed-media/images/c1/synthetic.png",
        "story/assets/mixed-media/images/c5/nested/synthetic.txt",
    )
    source_paths = (
        "story/assets/mixed-media/renderer.js",
        "story/assets/mixed-media/styles.css",
        "story/assets/mixed-media/README.md",
    )

    def test_only_material_paths_are_excluded(self):
        for name in self.private_paths:
            with self.subTest(name=name):
                self.assertTrue(packaging.excluded(Path(name)))
                self.assertTrue(packaging.excluded(Path(name.upper())))
        for name in self.source_paths:
            with self.subTest(name=name):
                self.assertFalse(packaging.excluded(Path(name)))

    def test_export_retains_source_and_license_without_materials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "LICENSE").write_text(
                (ROOT / "LICENSE").read_text(encoding="utf-8"), encoding="utf-8"
            )
            for name in self.private_paths + self.source_paths:
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("synthetic fixture only\n", encoding="utf-8")
            destination = root / "export"
            with patch.object(packaging, "PROJECT_ROOT", source):
                packaging.copy_export_tree(destination)
            packaging.audit_export_tree(destination)
            for name in self.private_paths:
                self.assertFalse((destination / name).exists(), name)
            for name in self.source_paths:
                self.assertTrue((destination / name).is_file(), name)

    def test_independent_audit_rejects_manually_added_materials(self):
        for name in self.private_paths:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "LICENSE").write_text(
                    (ROOT / "LICENSE").read_text(encoding="utf-8"), encoding="utf-8"
                )
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("synthetic fixture only\n", encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "混排"):
                    packaging.audit_export_tree(root)

    def test_git_and_public_audit_guard_the_ledger(self):
        ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
        audit = (ROOT / "tools/audit-public-release.ps1").read_text(encoding="utf-8")
        for name in ("story/assets/mixed-media/mapping.js", "story/assets/mixed-media/images/"):
            self.assertIn("/" + name, ignored)
            self.assertIn("'" + name + "'", audit)


if __name__ == "__main__":
    unittest.main()
