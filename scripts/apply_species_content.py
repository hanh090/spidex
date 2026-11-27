#!/usr/bin/env python3
"""Apply the committed open species-content snapshot to the audited preview packs.

Only exact scientific-name matches are applied. Values are structured facts
(wingspan, controlled habitat categories, regional month records, hostplants,
and bird measurements); no source prose is copied. Missing evidence stays empty.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "public/packs"
SNAPSHOT = ROOT / "data/content/species-content-2026-11-27.json"
_SNAPSHOT_DATA = None
BUTTERFLIES = ("butterfly-th", "butterfly-vn")
AFFECTED = ("bird-th", "butterfly-th", "butterfly-vn")
TARGET_VERSIONS = {"bird-th": 8, "butterfly-th": 5, "butterfly-vn": 4}
SNAPSHOT_ID = "species-content-2026-11-27"

SIZE_BINS = (
    ("tiny", 0.0, 30.0, {"en": "< 30 mm", "de": "< 30 mm", "vi": "< 30 mm"}),
    ("small", 30.0, 50.0, {"en": "30–50 mm", "de": "30–50 mm", "vi": "30–50 mm"}),
    ("med", 50.0, 90.0, {"en": "50–90 mm", "de": "50–90 mm", "vi": "50–90 mm"}),
    ("large", 90.0, float("inf"), {"en": "> 90 mm", "de": "> 90 mm", "vi": "> 90 mm"}),
)
HABITAT_DENSITY = {"1": "dense habitat", "2": "semi-open habitat", "3": "open habitat"}
MIGRATION = {"1": "sedentary", "2": "partially migratory", "3": "migratory"}
USELESS_AFFINITIES = {
    "No evidence for edge associations",
    "No evidence for moisture association",
}

RELEASE_NOTES = {
    "bird-th": "Preview checklist: AVONET supplies exact-match species habitat categories and measurements for part of the list. Visual identification traits, calls and seasonality remain unverified; absent fields mean no verified species-level source. Some plates are archetypes while rights review continues.",
    "butterfly-th": "Preview checklist: LepTraits and the NHM HOSTS archive supply exact-match wingspan, habitat-affinity, phenology or host-plant facts for part of the list. Visual identification traits remain unverified and regional phenology coverage is sparse; absent fields mean no verified species-level source. Some plates are archetypes while rights review continues.",
    "butterfly-vn": "Preview checklist: LepTraits and the NHM HOSTS archive supply exact-match wingspan, habitat-affinity, phenology or host-plant facts for part of the list. Visual identification traits remain unverified and regional phenology coverage is sparse; absent fields mean no verified species-level source. Plates with unrecorded reference rights remain archetypes.",
}


def source_ref(key: str, extra: dict | None = None) -> dict:
    global _SNAPSHOT_DATA
    if _SNAPSHOT_DATA is None:
        _SNAPSHOT_DATA = json.loads(SNAPSHOT.read_text())
    data = _SNAPSHOT_DATA["sources"][key]
    out = {
        "source": data["title"],
        "sourceUrl": data["sourceUrl"],
        "license": data["license"],
        "licenseUrl": data["licenseUrl"],
        "snapshot": SNAPSHOT_ID,
    }
    if extra:
        out.update(extra)
    return out


def pipeline_generated(row: dict) -> bool:
    provenance = row.get("provenance") or {}
    return any((provenance.get(key) or {}).get("snapshot") == SNAPSHOT_ID for key in ("content", "traits", "seasonality", "hostPlants"))


def size_values(wingspan_cm: dict) -> list[str]:
    lower = wingspan_cm.get("lower")
    upper = wingspan_cm.get("upper", lower)
    if lower is None:
        return []
    low_mm, high_mm = float(lower) * 10, float(upper) * 10
    values = []
    for value, bin_low, bin_high, _label in SIZE_BINS:
        # Intersect the approximate source range with each display bin.
        if high_mm >= bin_low and low_mm < bin_high:
            values.append(value)
    return values


def mm_range(wingspan_cm: dict) -> str | None:
    lower = wingspan_cm.get("lower")
    upper = wingspan_cm.get("upper", lower)
    if lower is None:
        return None
    def fmt(cm):
        value = float(cm) * 10
        return str(int(round(value))) if abs(value - round(value)) < 0.05 else f"{value:.1f}".rstrip("0").rstrip(".")
    return fmt(lower) if lower == upper else f"{fmt(lower)}–{fmt(upper)}"


def habitat_from_leptraits(lep: dict) -> str | None:
    parts = []
    for key, label in (
        ("canopyAffinity", "canopy"),
        ("edgeAffinity", "forest edge"),
        ("moistureAffinity", "moisture"),
        ("disturbanceAffinity", "disturbance"),
    ):
        value = lep.get(key)
        if value and value not in USELESS_AFFINITIES:
            parts.append(f"{label}: {value}")
    return "; ".join(parts) if parts else None


def hostplant_text(item: dict) -> tuple[str | None, dict | None]:
    hosts = item.get("hosts")
    if hosts and hosts.get("plants"):
        plants = hosts["plants"]
        names = [plant["name"] for plant in plants]
        shown = names[:12]
        text = ", ".join(shown)
        if len(names) > len(shown):
            text += f", +{len(names) - len(shown)} more recorded in HOSTS"
        return text, source_ref("hosts", {
            "match": hosts["match"],
            "rowIds": hosts["rowIds"][:80],
            "recordedPlantCount": len(names),
        })
    lep = item.get("leptraits") or {}
    families = lep.get("hostplantFamilies") or []
    if families:
        return "Recorded host plant families: " + ", ".join(families[:8]), source_ref("leptraits", {"match": lep.get("match")})
    return None, None


def apply_butterfly(pack: str, row: dict, species: dict) -> Counter:
    stats: Counter = Counter()
    item = species.get(row["sciName"], {})
    lep = item.get("leptraits") or {}
    provenance = row.setdefault("provenance", {})
    replace = pipeline_generated(row)
    if replace:
        if (provenance.get("traits") or {}).get("snapshot") == SNAPSHOT_ID:
            row["traits"] = {}
        row["keyFeatures"] = []
        row.pop("habitat", None)
        if (provenance.get("seasonality") or {}).get("snapshot") == SNAPSHOT_ID:
            row["months"] = []
        if (provenance.get("hostPlants") or {}).get("snapshot") == SNAPSHOT_ID:
            (row.get("taxonFields") or {}).pop("hostPlants", None)

    if lep:
        sizes = size_values(lep.get("wingspanCm") or {})
        if sizes and (replace or not row.get("traits")):
            row["traits"] = {"size": sizes}
            provenance["traits"] = source_ref("leptraits", {"match": lep.get("match"), "fact": "wingspan range"})
            stats["traits"] += 1
        content_sources = []
        features = []
        wingspan = mm_range(lep.get("wingspanCm") or {})
        if wingspan:
            features.append({"en": f"Wingspan {wingspan} mm"})
        habitat = habitat_from_leptraits(lep)
        if (features or habitat) and (replace or not row.get("keyFeatures")):
            row["keyFeatures"] = features
        if habitat and (replace or not row.get("habitat")):
            row["habitat"] = {"en": habitat}
        if features or habitat:
            content_sources.append(source_ref("leptraits", {"match": lep.get("match"), "scope": "global species consensus; regional variation possible"}))
            stats["leptraitsAccounts"] += 1
    else:
        content_sources = []

    host_text, host_source = hostplant_text(item)
    if host_text and (replace or not (row.get("taxonFields") or {}).get("hostPlants")):
        row.setdefault("taxonFields", {})["hostPlants"] = {"en": host_text}
        provenance["hostPlants"] = host_source
        stats["hostPlants"] += 1
        if host_source:
            content_sources.append(host_source)

    regional = (item.get("regionalPhenology") or {}).get(pack)
    if regional and (replace or not row.get("months")):
        row["months"] = regional["months"]
        provenance["seasonality"] = source_ref("leptraits", {
            "match": lep.get("match", "exact scientific name"),
            "scope": regional["scope"],
            "recordIds": regional["recordIds"],
            "resourceIds": regional["resourceIds"],
        })
        stats["months"] += 1

    if content_sources:
        urls = []
        for source in content_sources:
            if source["sourceUrl"] not in urls:
                urls.append(source["sourceUrl"])
        provenance["content"] = {
            "snapshot": SNAPSHOT_ID,
            "source": "Structured species facts; no prose copied",
            "sourceUrls": urls,
            "sources": content_sources,
        }
    return stats


def apply_bird(row: dict, species: dict) -> Counter:
    stats: Counter = Counter()
    bird = (species.get(row["sciName"], {}) or {}).get("avonet")
    if not bird:
        return stats
    provenance = row.setdefault("provenance", {})
    replace = pipeline_generated(row)
    if replace:
        row["keyFeatures"] = []
        row.pop("habitat", None)

    features = []
    measurements = []
    if bird.get("inference") == "NO":
        if bird.get("massG") and bird.get("massSource") in {"Dunning", "Updated_literature", "Updated_live.sample", "DataFromSplit"}:
            measurements.append(f"mass {bird['massG']:g} g")
        if bird.get("wingLengthMm"):
            measurements.append(f"wing {bird['wingLengthMm']:g} mm")
        if bird.get("beakLengthCulmenMm"):
            measurements.append(f"culmen {bird['beakLengthCulmenMm']:g} mm")
    if measurements:
        features.append({"en": "Species-average measurements: " + "; ".join(measurements)})
        stats["measurements"] += 1
    migration = MIGRATION.get(str(bird.get("migration") or ""))
    if migration:
        features.append({"en": f"Migration category: {migration}"})
        stats["migration"] += 1
    if features and (replace or not row.get("keyFeatures")):
        row["keyFeatures"] = features

    density = HABITAT_DENSITY.get(str(bird.get("habitatDensity") or ""))
    habitat_parts = [part for part in (bird.get("habitat"), density) if part and part != "NA"]
    if habitat_parts and (replace or not row.get("habitat")):
        row["habitat"] = {"en": "; ".join(habitat_parts)}
        stats["habitat"] += 1

    if features or habitat_parts:
        source = source_ref("avonet", {"match": bird.get("match"), "totalIndividuals": bird.get("totalIndividuals")})
        provenance["content"] = {
            "snapshot": SNAPSHOT_ID,
            "source": "Structured species facts; no prose copied",
            "sourceUrls": [source["sourceUrl"]],
            "sources": [source],
        }
    return stats


def butterfly_schema() -> list[dict]:
    return [{
        "key": "size",
        "label": {"en": "Wingspan", "de": "Flügelspannweite", "vi": "Sải cánh"},
        "type": "multi",
        "render": "chip",
        "options": [{"v": value, "label": label} for value, _low, _high, label in SIZE_BINS],
    }]


def apply_pack(pack: str, species: dict, write: bool) -> Counter:
    path = PACKS / pack / "species.ndjson"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    stats: Counter = Counter()
    for row in rows:
        if pack in BUTTERFLIES:
            stats.update(apply_butterfly(pack, row, species))
        else:
            stats.update(apply_bird(row, species))
    stats["accounts"] = len(rows)
    if not write:
        return stats

    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    manifest_path = PACKS / pack / "pack.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest["version"] > TARGET_VERSIONS[pack]:
        raise ValueError(f"{pack}: refusing to rewrite a later pack version")
    manifest["version"] = TARGET_VERSIONS[pack]
    manifest["releaseNotes"]["en"] = RELEASE_NOTES[pack]
    additions = {
        "bird-th": ["AVONET species averages and ecological categories (Tobias et al. 2022; CC BY 4.0)"],
        "butterfly-th": ["LepTraits 1.0 species trait data (Shirey et al. 2022; CC0)", "HOSTS Lepidopteran hostplants archive (Natural History Museum 2023; CC0)"],
        "butterfly-vn": ["LepTraits 1.0 species trait data (Shirey et al. 2022; CC0)", "HOSTS Lepidopteran hostplants archive (Natural History Museum 2023; CC0)"],
    }[pack]
    for source in additions:
        if source not in manifest["sources"]:
            manifest["sources"].append(source)
    if pack in BUTTERFLIES:
        manifest["traitSchema"]["traits"] = butterfly_schema()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    snapshot = json.loads(SNAPSHOT.read_text())
    if snapshot.get("snapshot") != SNAPSHOT_ID:
        raise SystemExit("snapshot id mismatch")
    for pack in AFFECTED:
        print(pack, dict(apply_pack(pack, snapshot["species"], args.write)))


if __name__ == "__main__":
    main()
