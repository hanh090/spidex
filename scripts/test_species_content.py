import json
import unittest
from pathlib import Path

from apply_species_content import size_values
from check_pack_release import preview_content_issues

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data/content/species-content-2026-11-27.json"
PACKS = ROOT / "public/packs"


def rows(pack):
    return [json.loads(line) for line in (PACKS / pack / "species.ndjson").read_text().splitlines() if line.strip()]


class SpeciesContentTests(unittest.TestCase):
    def test_snapshot_sources_are_reusable_and_upstream_files_are_fixed(self):
        snapshot = json.loads(SNAPSHOT.read_text())
        self.assertEqual(snapshot["snapshot"], "species-content-2026-11-27")
        for key, source in snapshot["sources"].items():
            self.assertIn(source["license"], {"CC0-1.0", "CC-BY-4.0"})
            self.assertNotIn("NC", source["license"])
            self.assertNotIn("ND", source["license"])
            self.assertTrue(source["sourceUrl"].startswith("https://"))
            self.assertIn("no prose", source["rightsNote"].lower())
        for item in snapshot["upstreamFiles"].values():
            self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(item["url"].startswith("https://"))

    def test_wingspan_bins_include_every_intersecting_range(self):
        self.assertEqual(size_values({"lower": 2.0, "upper": 4.0}), ["tiny", "small"])
        self.assertEqual(size_values({"lower": 3.3, "upper": 4.25}), ["small"])
        self.assertEqual(size_values({"lower": 6.38, "upper": 9.33}), ["med", "large"])
        self.assertEqual(size_values({"lower": 12.0, "upper": 15.5}), ["large"])

    def test_applied_coverage_is_exact_and_does_not_overclaim(self):
        expected = {
            "bird-th": {"keyFeatures": 1221, "habitat": 1221, "traits": 0, "months": 0, "hostPlants": 0, "placeholder": 1408},
            "butterfly-th": {"keyFeatures": 926, "habitat": 609, "traits": 923, "months": 59, "hostPlants": 655, "placeholder": 946},
            "butterfly-vn": {"keyFeatures": 770, "habitat": 753, "traits": 769, "months": 69, "hostPlants": 764, "placeholder": 1429},
        }
        for pack, counts in expected.items():
            data = rows(pack)
            self.assertEqual(sum(bool(row.get("keyFeatures")) for row in data), counts["keyFeatures"], pack)
            self.assertEqual(sum(bool(row.get("habitat")) for row in data), counts["habitat"], pack)
            self.assertEqual(sum(bool(row.get("traits")) for row in data), counts["traits"], pack)
            self.assertEqual(sum(bool(row.get("months")) for row in data), counts["months"], pack)
            self.assertEqual(sum(bool((row.get("taxonFields") or {}).get("hostPlants")) for row in data), counts["hostPlants"], pack)
            self.assertEqual(sum(bool((row.get("provenance") or {}).get("plate", {}).get("placeholder")) for row in data), counts["placeholder"], pack)
            manifest = json.loads((PACKS / pack / "pack.json").read_text())
            self.assertEqual(manifest["releaseStatus"], "preview")
            self.assertIn("unverified", manifest["releaseNotes"]["en"])

    def test_every_applied_fact_has_machine_readable_source_and_open_license(self):
        for pack in ("bird-th", "butterfly-th", "butterfly-vn"):
            for row in rows(pack):
                provenance = row.get("provenance") or {}
                if row.get("traits"):
                    trait_source = provenance.get("traits") or {}
                    self.assertTrue(trait_source.get("sourceUrl"), row["sciName"])
                    self.assertNotIn("NC", trait_source.get("license", ""))
                if row.get("keyFeatures") or row.get("habitat") or row.get("taxonFields"):
                    content = provenance.get("content") or {}
                    self.assertTrue(content.get("sourceUrls"), row["sciName"])
                    for source in content.get("sources", []):
                        self.assertNotIn("NC", source.get("license", ""))
                        self.assertNotIn("ND", source.get("license", ""))
                if row.get("months"):
                    seasonality = provenance.get("seasonality") or {}
                    self.assertTrue(seasonality.get("sourceUrl"), row["sciName"])
                    self.assertTrue(seasonality.get("recordIds"), row["sciName"])

    def test_lab_rearing_only_host_rows_are_not_used_as_field_hosts(self):
        snapshot = json.loads(SNAPSHOT.read_text())["species"]
        for name in ("Udara dilectus", "Elymnias casiphone", "Lethe scanda", "Mycalesis maianeas", "Mycalesis anaxioides", "Thauria aliris", "Zeuxidia doubledayi"):
            self.assertFalse(snapshot.get(name, {}).get("hosts"), name)

    def test_release_gate_accepts_multiple_fact_sources_but_still_requires_one(self):
        row = {"sciName": "X y", "keyFeatures": [{"en": "Wingspan 30 mm"}], "images": [],
               "provenance": {"content": {"sourceUrls": ["https://example.org/facts"]}}}
        self.assertFalse(any("field account" in issue for issue in preview_content_issues("butterfly-th", {"traitSchema": {"traits": []}}, [row])))
        row["provenance"] = {}
        self.assertTrue(any("field account" in issue for issue in preview_content_issues("butterfly-th", {"traitSchema": {"traits": []}}, [row])))


if __name__ == "__main__":
    unittest.main()
