import unittest

from check_pack_release import issues_for_pack, preview_content_issues


class ReleaseGateTests(unittest.TestCase):
    def test_preview_needs_a_limitation_note(self):
        self.assertIn(
            "preview requires an English release note explaining its limitations",
            issues_for_pack("bird-test", {"releaseStatus": "preview"}, []),
        )

    def test_preview_count_must_match(self):
        issues = issues_for_pack("bird-th", {"releaseStatus": "preview", "speciesCount": 2,
                                             "releaseNotes": {"en": "Checklist pending review"}}, [{}])
        self.assertIn("speciesCount does not match species.ndjson", issues)

    def test_audited_preview_requires_honest_licence_scope(self):
        issues = issues_for_pack("butterfly-vn", {"releaseStatus": "preview", "speciesCount": 0,
                                                  "releaseNotes": {"en": "Pending review"},
                                                  "license": "CC-BY-SA-4.0"}, [])
        self.assertTrue(any("single licence" in issue for issue in issues))

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

    def test_preview_rejects_unsourced_traits_and_unlicensed_plate(self):
        for license_code in ("all-rights-reserved", "cc-by-nc", "cc-by-nc-sa", None):
            row = {"sciName": "X y", "traits": {"size": "small"},
                   "images": [{"thumbUrl": "img/x.jpg"}],
                   "provenance": {"plate": {"referenceLicense": license_code}}}
            issues = preview_content_issues("butterfly-th", {"traitSchema": {"traits": [{}]}}, [row])
            self.assertTrue(any("traits" in issue for issue in issues))
            self.assertTrue(any("derivative grant" in issue for issue in issues))

    def test_complete_audited_guide_needs_species_sources_and_key(self):
        row = {"sciName": "X y", "family": "Papilionidae", "keyFeatures": [],
               "images": [{"credit": "Artist", "thumbUrl": "img/x.jpg", "license": "CC-BY"}]}
        issues = issues_for_pack("butterfly-th", {
            "releaseStatus": "complete", "speciesCount": 1,
            "contentReview": {"reviewer": "Reviewer", "date": "2026-11-27"},
            "traitSchema": {"traits": []},
        }, [row])
        self.assertTrue(any("identification key" in issue for issue in issues))
        self.assertTrue(any("sourced identification traits" in issue for issue in issues))
        self.assertTrue(any("sourced markings and habitat" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
