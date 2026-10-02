"""PDF 导入：拇指图标标记的入口要单独成段，标记行留在新段正文开头。

运行：python -m unittest tools.test_import_storybook_pdf -v
"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "import-storybook-pdf.py"


def load_importer():
    spec = importlib.util.spec_from_file_location("import_storybook_pdf", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMPORTER = load_importer()


class StorybookPdfThumbHeadingTests(unittest.TestCase):
    def test_marker_line_is_recognised_as_a_heading(self):
        self.assertEqual(
            ("1355", "盐海珍珠 (Pearls of the sea of salt)"),
            IMPORTER.probable_entry_heading("（拇指）1355 盐海珍珠 (Pearls of the sea of salt)"),
        )
        self.assertEqual(("1359", ""), IMPORTER.probable_entry_heading("(拇指)1359"))

    def test_marker_without_a_number_is_not_a_heading(self):
        self.assertIsNone(IMPORTER.probable_entry_heading("（拇指）这不是编号行。"))
        self.assertIsNone(IMPORTER.probable_entry_heading("正常正文，不是标题"))

    def test_thumb_section_is_split_out_with_the_marker_first(self):
        pages = [{
            "page": 1,
            "text": "\n".join([
                "1354",
                "塔倒下了。",
                "（拇指）1355 盐海珍珠 (Pearls of the sea of salt)",
                "发现珍珠。",
                "1356",
                "后一段。",
            ]),
            "rawText": "",
            "words": [],
        }]
        entries = IMPORTER.split_entries_from_pages(pages, "main", "主线", [("main", "主线")])
        self.assertEqual(["1354", "1355", "1356"], [entry["id"] for entry in entries])
        self.assertNotIn("拇指", entries[0]["text"])
        self.assertTrue(entries[1]["text"].startswith("（拇指）1355 盐海珍珠 (Pearls of the sea of salt)"))
        self.assertIn("发现珍珠。", entries[1]["text"])
        self.assertNotIn("后一段。", entries[1]["text"])


if __name__ == "__main__":
    unittest.main()
