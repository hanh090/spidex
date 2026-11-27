import unittest

from check_pack_release import issues_for_pack


class ReleaseGateTests(unittest.TestCase):
    def test_preview_needs_a_limitation_note(self):
        self.assertIn(
            "preview requires an English release note explaining its limitations",
            issues_for_pack("bird-test", {"releaseStatus": "preview"}, []),
        )

    def test_complete_rejects_known_template_and_licence_risks(self):
        row = {
            "sciName": "X y", "family": "Unknown",
            "keyFeatures": [{"en": "Diagnostic field markings of X y"}],
            "images": [{"credit": "species plate pending", "thumbUrl": "img/archetype.svg", "license": "CC-BY-NC"}],
        }
        issues = issues_for_pack("bird-test", {
            "releaseStatus": "complete", "speciesCount": 1,
            "contentReview": {"reviewer": "Reviewer", "date": "2026-11-27"},
        }, [row])
        self.assertTrue(any("template" in issue for issue in issues))
        self.assertTrue(any("placeholder" in issue for issue in issues))
        self.assertTrue(any("NonCommercial" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
