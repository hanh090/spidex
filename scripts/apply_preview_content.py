#!/usr/bin/env python3
"""Apply the committed GBIF family snapshot and remove unsupported pack claims.

The three affected checklists were compiled with family/name heuristics for
their traits and boilerplate for species accounts. This migration preserves
identities, plates with recorded reuse metadata, and sightings compatibility.
It only fills a family on a strict exact GBIF Backbone match. Run after
fetch_gbif_family_snapshot.py, then review the diff and release audit.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "public/packs"
SNAPSHOT = ROOT / "data/taxonomy/gbif-family-2026-11-27.json"
CLASSES = {"bird-th": "Aves", "butterfly-th": "Insecta", "butterfly-vn": "Insecta"}
THAILAND = {"bird-th", "butterfly-th"}
AFFECTED = ("bird-th", "butterfly-th", "butterfly-vn")
TARGET_VERSIONS = {"bird-th": 7, "butterfly-th": 4, "butterfly-vn": 3}
DISPLAYABLE_REFERENCE_LICENSES = {"cc-by", "cc-by-sa", "cc0", "pd"}
RELEASE_NOTES = {
    "bird-th": "Preview checklist: species-specific identification traits, habitat, seasonality and calls are not yet verified. Some plates are archetypes; photo-based plates with unclear or restricted reference rights are withheld pending review.",
    "butterfly-th": "Preview checklist: species-specific identification traits, habitat, seasonality and host plants are not yet verified. Some plates are archetypes; photo-based plates with unclear or restricted reference rights are withheld pending review.",
    "butterfly-vn": "Preview checklist: species-specific identification traits, habitat, seasonality and host plants are not yet verified. Plates with unrecorded reference rights have been replaced by archetypes pending review.",
}
SOURCES = {
    "bird-th": ["GBIF occurrence species facets and Backbone taxonomy (api.gbif.org)",
                "iNaturalist Thailand research-grade observation species counts (api.inaturalist.org)",
                "Spidex merged candidate checklist; geographic occurrence and field accounts not expert-vetted"],
    "butterfly-th": ["GBIF occurrence species facets and Backbone taxonomy (api.gbif.org)",
                     "iNaturalist Thailand research-grade observation species counts (api.inaturalist.org)",
                     "Spidex merged candidate checklist; geographic occurrence and field accounts not expert-vetted"],
    "butterfly-vn": ["Spidex compilation from cached Indochina butterfly list and iNaturalist/GBIF observations",
                     "Source lineage and species-level field accounts require expert review"],
}


def verified_family(match: dict, pack: str, name: str) -> str | None:
    """Reject fuzzy, higher-rank, cross-class and changed-name assignments."""
    if pack not in CLASSES or match.get("pack") != pack or match.get("name") != name:
        return None
    if (match.get("matchType") != "EXACT" or match.get("rank") != "SPECIES"
            or match.get("canonicalName", "").casefold() != name.casefold()
            or match.get("class") != CLASSES[pack]
            or (match.get("confidence") or 0) < 95
            or match.get("status") not in {"ACCEPTED", "SYNONYM"}):
        return None
    family = match.get("family")
    return family if isinstance(family, str) and family.endswith("idae") else None


def archetype(pack: str, row: dict) -> str:
    """Choose a drawing already present in the pack; never invent a plate."""
    from feed_th_plates_into_packs import bird_archetype, butterfly_archetype

    if pack == "bird-th":
        return bird_archetype(row.get("family"), row["sciName"])
    return butterfly_archetype(row.get("family"), row["sciName"].split()[0])


def remove_templates(pack: str, row: dict) -> None:
    if pack in THAILAND:
        row["keyFeatures"] = [feature for feature in row.get("keyFeatures", [])
                              if not (feature.get("en", "").startswith("Diagnostic field markings of ")
                                      or feature.get("en", "").startswith("Belongs to family "))]
        if row.get("habitat", {}).get("en") == "Native regional ecosystem and forest canopy":
            row.pop("habitat")
        fields = row.get("taxonFields", {})
        if fields.get("call", {}).get("en") == "Distinctive vocalization in natural habitat":
            fields.pop("call")
        if fields.get("hostPlants", {}).get("en", "").startswith("Associated with "):
            fields.pop("hostPlants")
    else:
        row["keyFeatures"] = [feature for feature in row.get("keyFeatures", [])
                              if not (feature.get("en", "").startswith("Family: ")
                                      or feature.get("en", "").startswith("Status in Vietnam: "))]
        if row.get("habitat", {}).get("en") == "Tropical rainforest, clearings and forest edges of Vietnam":
            row.pop("habitat")
        if row.get("taxonFields", {}).get("hostPlants", {}).get("en", "").startswith("Caterpillar host plants associated with family "):
            row["taxonFields"].pop("hostPlants")
    # These values were inferred from family/name or written as all 12 months,
    # not measured for a species. Keep the schema but do not offer a false key.
    provenance = row.get("provenance") or {}
    if not (provenance.get("traits") or {}).get("sourceUrl"):
        row["traits"] = {}
    if row.get("months") == list(range(1, 13)) and not (provenance.get("seasonality") or {}).get("sourceUrl"):
        row["months"] = []
    if row.get("status", {}).get("en") in {"Native", "Strictly protected (CITES / Red Data Book)"} and not (provenance.get("status") or {}).get("sourceUrl"):
        row.pop("status")


def withhold_unverified_plate(pack: str, row: dict) -> bool:
    if pack not in AFFECTED:
        return False
    plate = row.get("provenance", {}).get("plate", {})
    license_code = (plate.get("referenceLicense") or "").lower()
    images = row.get("images", [])
    if not images:
        return False
    already_archetype = all("archetype" in image.get("thumbUrl", "") for image in images)
    if license_code in {"cc-by-nd", "cc-by-nc-nd"} and already_archetype:
        plate["placeholder"] = True
        plate["withheldReason"] = "NoDerivatives reference"
        return False
    if already_archetype:
        return False
    if license_code in DISPLAYABLE_REFERENCE_LICENSES:
        return False
    # An absent or restricted reference licence is not a documented grant to redraw.
    path = archetype(pack, row)
    if not (PACKS / pack / path).exists():
        raise ValueError(f"{pack}: missing fallback {path} for {row['sciName']}")
    aspect = "profile" if pack == "bird-th" else "dorsal"
    row["images"] = [{"id": f"{row['id']}-1", "aspect": aspect,
                      "credit": "Spidex archetype drawing - species plate pending",
                      "license": "CC-BY-SA-4.0", "thumbUrl": path, "fullUrl": path}]
    plate["placeholder"] = True
    plate["withheldReason"] = "reference licence not recorded" if not license_code else license_code
    return True


def apply_pack(pack: str, matches: dict[tuple[str, str], dict], write: bool) -> Counter:
    path = PACKS / pack / "species.ndjson"
    original = path.read_text()
    rows = [json.loads(line) for line in original.splitlines() if line.strip()]
    stats: Counter = Counter()
    for row in rows:
        family = verified_family(matches.get((pack, row["sciName"]), {}), pack, row["sciName"])
        if row.get("family") == "Unknown":
            if family:
                row["family"] = family
                row.setdefault("provenance", {})["family"] = {
                    "source": "GBIF Backbone", "usageKey": matches[(pack, row["sciName"])]["usageKey"],
                    "matchedName": row["sciName"], "snapshot": SNAPSHOT.name,
                }
                stats["familiesFilled"] += 1
            else:
                stats["familiesUnresolved"] += 1
        elif pack == "butterfly-vn":
            if family == row["family"]:
                stats["familiesVerified"] += 1
            elif family and row["family"] == "Nymphalidae":
                previous = row["family"]
                row["family"] = family
                row.setdefault("provenance", {})["family"] = {
                    "source": "GBIF Backbone", "usageKey": matches[(pack, row["sciName"])]["usageKey"],
                    "matchedName": row["sciName"], "snapshot": SNAPSHOT.name,
                    "previousFamily": previous,
                }
                row["provenance"].pop("familyConflict", None)
                stats["familiesCorrected"] += 1
            elif family:
                row.setdefault("provenance", {})["familyConflict"] = {
                    "existingFamily": row["family"], "gbifFamily": family,
                    "usageKey": matches[(pack, row["sciName"])]["usageKey"],
                    "snapshot": SNAPSHOT.name,
                }
                stats["familiesConflicting"] += 1
            else:
                stats["familiesUnmatched"] += 1
        remove_templates(pack, row)
        if withhold_unverified_plate(pack, row):
            stats["platesWithheld"] += 1
        if row.get("provenance", {}).get("plate", {}).get("placeholder"):
            stats["placeholderPlates"] += 1
    if write:
        revised = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"
        manifest_path = PACKS / pack / "pack.json"
        manifest = json.loads(manifest_path.read_text())
        if manifest["version"] > TARGET_VERSIONS[pack]:
            raise ValueError(f"{pack}: refusing to rewrite a later pack version")
        if revised != original or manifest["traitSchema"]["traits"]:
            path.write_text(revised)
            manifest["version"] = TARGET_VERSIONS[pack]
            manifest["traitSchema"]["traits"] = []
        manifest["releaseNotes"]["en"] = RELEASE_NOTES[pack]
        manifest["license"] = "Mixed; see item-level licences and provenance"
        manifest["sources"] = SOURCES[pack]
        if revised != original or manifest_path.read_text() != json.dumps(manifest, ensure_ascii=False, indent=2) + "\n":
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    stats["accounts"] = len(rows)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Apply changes and bump pack versions")
    args = parser.parse_args()
    snapshot = json.loads(SNAPSHOT.read_text())
    matches = {(m["pack"], m["name"]): m for m in snapshot["matches"]}
    for pack in AFFECTED:
        print(pack, dict(apply_pack(pack, matches, args.write)))


if __name__ == "__main__":
    main()
