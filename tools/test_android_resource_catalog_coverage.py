"""Exercise exploration coverage across multiple hidden cards and all five cycles."""
from __future__ import annotations

import unittest

from test_android_resource_catalog import check_exploration_catalog


class ExplorationCoverageTests(unittest.TestCase):
    def setUp(self):
        blocks = []
        self.targets = {}
        for name, offset in (("explorationDecks", 100), ("hiddenExplorationCards", 200)):
            lines = [f"    const {name} = {{"]
            for cycle in range(1, 6):
                ids = [str(offset + cycle * 10 + card) for card in range(2)]
                cards = ", ".join(f'{{ id: "{card_id}", name: "Card" }}' for card_id in ids)
                if name == "explorationDecks":
                    cards = '{ id: "start", cards: [' + cards + '] }'
                lines.append(f"      c{cycle}: [{cards}],")
                for card_id in ids:
                    self.targets[(f"c{cycle}:exploration:cards:{card_id}", "front")] = (
                        f"assets/exploration-cards/c{cycle}/{card_id}.png"
                    )
            lines.append("    };")
            blocks.append("\n".join(lines))
        self.source = "\n".join(blocks)

    def test_checks_all_cards_in_all_cycles(self):
        self.assertEqual(check_exploration_catalog(self.targets, self.source), (10, 10))

    def test_any_missing_card_fails(self):
        for key in self.targets:
            with self.subTest(key=key):
                incomplete = dict(self.targets)
                del incomplete[key]
                with self.assertRaisesRegex(AssertionError, "missing/mismatched"):
                    check_exploration_catalog(incomplete, self.source)

    def test_any_wrong_cycle_or_face_path_fails(self):
        for key in self.targets:
            with self.subTest(key=key):
                incorrect = dict(self.targets)
                incorrect[key] = "assets/exploration-cards/c1/wrong.png"
                with self.assertRaisesRegex(AssertionError, "missing/mismatched"):
                    check_exploration_catalog(incorrect, self.source)

    def test_duplicate_declarations_fail(self):
        duplicate = self.source.replace('id: "211"', 'id: "210"')
        with self.assertRaisesRegex(AssertionError, "Duplicate card"):
            check_exploration_catalog(self.targets, duplicate)

    def test_generated_decks_are_fully_checked(self):
        source = self.source.replace(
            '{ id: "start", cards: [{ id: "130", name: "Card" }, { id: "131", name: "Card" }] }',
            '{ id: "main", cards: Array.from({ length: 2 }, (_, index) => { '
            'const id = String(130 + index); return { id, name: "Card" }; }) }',
        )
        self.assertEqual(check_exploration_catalog(self.targets, source), (10, 10))
        del self.targets[("c3:exploration:cards:131", "front")]
        with self.assertRaisesRegex(AssertionError, "missing/mismatched"):
            check_exploration_catalog(self.targets, source)


if __name__ == "__main__":
    unittest.main()
