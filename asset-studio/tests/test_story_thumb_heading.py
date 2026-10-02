"""拇指图标标记的段落：标记行里的编号要另起一段，标记本身留在新段开头。

运行（在 asset-studio 目录下）：.venv/Scripts/python -m unittest tests.test_story_thumb_heading -v
"""
from __future__ import annotations

import unittest

from app.stories import parse_entry_heading, split_segments


class StoryThumbHeadingTests(unittest.TestCase):
    def test_thumb_marked_number_starts_its_own_segment(self) -> None:
        text = "\n".join([
            "1353",
            "上一个段落。",
            "",
            "1354",
            "塔倒下了。",
            "",
            "（拇指）1355 盐海珍珠 (Pearls of the sea of salt)",
            "这一片荒地曾经是海洋的一部分。",
            "",
            "1356",
            "故事还没有结束。",
        ])
        segments = split_segments(text, "main", "主线故事")
        self.assertEqual(["1353", "1354", "1355", "1356"], [item["entry_number"] for item in segments])

        carrier = segments[1]
        self.assertEqual("1354", carrier["entry_number"])
        self.assertIn("塔倒下了。", carrier["body"])
        self.assertNotIn("拇指", carrier["body"])

        thumb = segments[2]
        self.assertEqual("1355", thumb["title"])
        self.assertTrue(thumb["body"].startswith("（拇指）1355 盐海珍珠 (Pearls of the sea of salt)"))
        self.assertIn("这一片荒地曾经是海洋的一部分。", thumb["body"])
        self.assertNotIn("故事还没有结束。", thumb["body"])

    def test_halfwidth_marker_without_title(self) -> None:
        text = "1358\n前一段正文。\n(拇指)1359\n有一个非常具体的方法可以到达这里。"
        segments = split_segments(text, "main", "主线故事")
        self.assertEqual(["1358", "1359"], [item["entry_number"] for item in segments])
        self.assertEqual("1359", segments[1]["title"])
        self.assertTrue(segments[1]["body"].startswith("(拇指)1359"))
        self.assertNotIn("拇指", segments[0]["body"])

    def test_marker_without_a_number_stays_in_the_body(self) -> None:
        text = "0001\n他竖起拇指。\n（拇指）这不是编号行。"
        segments = split_segments(text, "main", "主线故事")
        self.assertEqual(["0001"], [item["entry_number"] for item in segments])
        self.assertIn("（拇指）这不是编号行。", segments[0]["body"])

    def test_plain_headings_keep_their_titles(self) -> None:
        self.assertEqual(
            {"entry_number": "0012", "title": "被盗的呼吸", "heading_line": ""},
            parse_entry_heading("0012: 被盗的呼吸"),
        )
        self.assertEqual(
            {"entry_number": "0011", "title": "0011", "heading_line": "（拇指）0011"},
            parse_entry_heading("（拇指）0011"),
        )
        self.assertIsNone(parse_entry_heading("正常正文，不是标题"))


if __name__ == "__main__":
    unittest.main()
