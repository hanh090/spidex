import unittest
import json
from pathlib import Path

from apply_preview_content import PACKS, SNAPSHOT, remove_templates, verified_family, withhold_unverified_plate


class PreviewContentTests(unittest.TestCase):
    def test_committed_family_provenance_resolves_to_strict_snapshot(self):
        snapshot = json.loads(Path(SNAPSHOT).read_text())
        matches = {(item["pack"], item["name"]): item for item in snapshot["matches"]}
        corrections = 0
        for pack in ("bird-th", "butterfly-th", "butterfly-vn"):
            for line in (PACKS / pack / "species.ndjson").read_text().splitlines():
                row = json.loads(line)
                family_source = (row.get("provenance") or {}).get("family") or {}
                if family_source.get("source") != "GBIF Backbone":
                    continue
                match = matches[(pack, row["sciName"])]
                self.assertEqual(row["family"], verified_family(match, pack, row["sciName"]))
                self.assertEqual(family_source["usageKey"], match["usageKey"])
                corrections += 1
        self.assertEqual(corrections, 904)

    def test_only_strict_exact_backbone_family_is_applied(self):
        match = {"pack": "butterfly-th", "name": "Papilio demoleus",
                 "matchType": "EXACT", "rank": "SPECIES", "confidence": 99,
                 "canonicalName": "Papilio demoleus", "family": "Papilionidae",
                 "class": "Insecta", "status": "ACCEPTED"}
        self.assertEqual(verified_family(match, "butterfly-th", "Papilio demoleus"), "Papilionidae")
        for field, bad in (("matchType", "FUZZY"), ("rank", "GENUS"),
                           ("canonicalName", "Papilio polytes"), ("class", "Aves"),
                           ("status", "DOUBTFUL"), ("confidence", 80)):
            self.assertIsNone(verified_family({**match, field: bad}, "butterfly-th", "Papilio demoleus"))

    def test_removes_only_known_generated_claims(self):
        row = {"sciName": "X y", "keyFeatures": [
            {"en": "Diagnostic field markings of X y"}, {"en": "Verified red wing spot"}],
            "habitat": {"en": "Native regional ecosystem and forest canopy"},
            "taxonFields": {"hostPlants": {"en": "Associated with Unknown host flora"}},
            "traits": {"colour": ["brown"]}, "months": list(range(1, 13)),
            "status": {"en": "Native"}}
        remove_templates("butterfly-th", row)
        self.assertEqual(row["keyFeatures"], [{"en": "Verified red wing spot"}])
        self.assertNotIn("habitat", row)
        self.assertEqual(row["traits"], {})
        self.assertEqual(row["months"], [])
        self.assertNotIn("status", row)

    def test_withholds_unlicensed_reference_and_keeps_audit_metadata(self):
        for license_code in ("all-rights-reserved", "cc-by-nc", "cc-by-nc-sa", None):
            row = {"id": "but-x-y", "sciName": "X y", "family": "Unknown",
                   "images": [{"thumbUrl": "img/x.jpg", "license": "CC-BY-SA-4.0"}],
                   "provenance": {"plate": {"referenceLicense": license_code,
                                            "referencePhotoUrl": "https://example.org/photo"}}}
            self.assertTrue(withhold_unverified_plate("butterfly-th", row))
            self.assertIn("archetype", row["images"][0]["thumbUrl"])
            self.assertTrue(row["provenance"]["plate"]["placeholder"])
            self.assertEqual(row["provenance"]["plate"]["referencePhotoUrl"], "https://example.org/photo")


if __name__ == "__main__":
    unittest.main()
