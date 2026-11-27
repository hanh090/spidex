#!/usr/bin/env python3
"""Build the small, auditable species-content snapshot used by the pack migration.

The snapshot contains only factual structured values for species in the three
audited preview packs. It does not copy prose or artwork. Run with `--fetch` to
refresh upstream files into data/source-cache (gitignored); without it the
script verifies and reads the files already there.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/source-cache"
OUT = ROOT / "data/content/species-content-2026-11-27.json"
PACKS = ("bird-th", "butterfly-th", "butterfly-vn")
MONTH_COLUMNS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

LEPTRAIT_COMMIT = "9702e22fc540ac7f25a174542a253cc81f83719c"
HOSTS_COMMIT = "96aea53c9d64112b76f41e4d9b4d2628b203907a"
INPUTS = {
    "leptraits-consensus": {
        "file": "leptraits-consensus.csv",
        "url": f"https://raw.githubusercontent.com/RiesLabGU/LepTraits/{LEPTRAIT_COMMIT}/consensus/consensus.csv",
    },
    "leptraits-records": {
        "file": "leptraits-records.csv",
        "url": f"https://raw.githubusercontent.com/RiesLabGU/LepTraits/{LEPTRAIT_COMMIT}/records/records.csv",
    },
    "leptraits-books": {
        "file": "leptraits-book-data.csv",
        "url": f"https://raw.githubusercontent.com/RiesLabGU/LepTraits/{LEPTRAIT_COMMIT}/misc/miscData/book_data.csv",
    },
    "hosts": {
        "file": "hosts-nhm-resource.csv",
        "url": f"https://raw.githubusercontent.com/globalbioticinteractions/HOSTS/{HOSTS_COMMIT}/resource.csv",
    },
    "avonet": {
        "file": "avonet-ELEData.zip",
        "url": "https://ndownloader.figshare.com/files/38429873",
    },
}

SOURCE_METADATA = {
    "leptraits": {
        "title": "LepTraits 1.0: A globally comprehensive dataset of butterfly traits",
        "citation": "Shirey et al. (2022), Scientific Data 9:382, doi:10.1038/s41597-022-01473-5",
        "datasetDoi": "10.6084/m9.figshare.19874602.v1",
        "sourceUrl": "https://doi.org/10.6084/m9.figshare.19874602.v1",
        "license": "CC0-1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "rightsNote": "Structured species-trait facts; no prose or artwork is copied. Consensus traits are global and can vary by region.",
    },
    "hosts": {
        "title": "HOSTS - a Database of the World's Lepidopteran Hostplants",
        "citation": "Robinson, Ackery, Kitching, Beccaloni & Hernández (2023), Natural History Museum, doi:10.5519/qd.bsucrxdz",
        "datasetDoi": "10.5519/qd.bsucrxdz",
        "sourceUrl": "https://data.nhm.ac.uk/dataset/hosts",
        "license": "CC0-1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "rightsNote": "Caterpillar hostplant association facts only; no prose or artwork is copied. The archival dataset is no longer updated.",
    },
    "avonet": {
        "title": "AVONET: morphological, ecological and geographical data for all birds",
        "citation": "Tobias et al. (2022), Ecology Letters 25:581-597, doi:10.1111/ele.13898",
        "datasetDoi": "10.6084/m9.figshare.16586228.v7",
        "sourceUrl": "https://doi.org/10.6084/m9.figshare.16586228.v7",
        "license": "CC-BY-4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "rightsNote": "Attribution is required. Structured species-average measurements and ecological categories only; no prose or artwork is copied.",
    },
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_inputs() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for item in INPUTS.values():
        dest = CACHE / item["file"]
        if dest.exists() and dest.stat().st_size:
            continue
        print(f"fetch {item['url']} -> {dest.relative_to(ROOT)}")
        req = urllib.request.Request(item["url"], headers={"User-Agent": "Spidex content-source audit/1.0"})
        with urllib.request.urlopen(req, timeout=120) as response, dest.open("wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)


def read_csv(path: Path, encoding="utf-8") -> list[dict]:
    return list(csv.DictReader(io.StringIO(path.read_text(encoding=encoding))))


def valid_number(value: str) -> float | None:
    try:
        if value in ("", "NA", None):
            return None
        return float(value)
    except ValueError:
        return None


def clean_epithet(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z][a-z0-9-]+", value or ""))


def plant_name(row: dict) -> str | None:
    genus = (row.get("Hostplant Genus") or "").strip()
    species = (row.get("Hostplant Species") or "").strip()
    subspecies = (row.get("Hostplant Subspecies/var") or "").strip()
    family = (row.get("Hostplant Family") or "").strip()
    if genus and species and species.lower() not in {"sp", "spp", "species"}:
        name = f"{genus} {species}"
        if subspecies and subspecies.lower() not in {"sp", "spp"}:
            name += f" {subspecies}"
        return name
    if genus:
        return genus
    return family or None


def consensus_rows(rows: list[dict], name: str) -> list[dict]:
    exact = [row for row in rows if row.get("verbatimSpecies") == name]
    if exact:
        return exact
    candidates = [row for row in rows if row.get("Species") == name]
    if len(candidates) == 1:
        return candidates
    # Duplicates usually mean the authors harmonized different verbatim synonyms.
    # Use them only when every content-bearing field agrees; otherwise leave the
    # species uncorrected rather than guessing which taxon concept applies.
    fields = ("WS_L", "WS_U", "CanopyAffinity", "EdgeAffinity", "MoistureAffinity", "DisturbanceAffinity")
    if candidates and all(all(row.get(f) == candidates[0].get(f) for f in fields) for row in candidates):
        return candidates[:1]
    return []


def merge_leptraits(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    lows = [n for n in (valid_number(row.get("WS_L", "")) for row in rows) if n is not None]
    ups = [n for n in (valid_number(row.get("WS_U", "")) for row in rows) if n is not None]
    out: dict = {}
    if lows or ups:
        out["wingspanCm"] = {"lower": min(lows or ups), "upper": max(ups or lows)}
    for source, target in (
        ("CanopyAffinity", "canopyAffinity"),
        ("EdgeAffinity", "edgeAffinity"),
        ("MoistureAffinity", "moistureAffinity"),
        ("DisturbanceAffinity", "disturbanceAffinity"),
        ("Voltinism", "voltinism"),
    ):
        values = [row.get(source, "") for row in rows if row.get(source, "") not in ("", "NA", "Unspecified", "Code not clear")]
        if values:
            out[target] = Counter(values).most_common(1)[0][0]
    families: list[str] = []
    for row in rows:
        for field in ("SoleHostplantFamily", "PrimaryHostplantFamily", "SecondaryHostplantFamily", "EqualHostplantFamily"):
            for value in re.split(r"[;,]", row.get(field, "")):
                value = value.strip()
                if value and value != "NA" and value not in families:
                    families.append(value)
    if families:
        out["hostplantFamilies"] = families
    return out or None


def extract() -> dict:
    missing = [str(CACHE / item["file"]) for item in INPUTS.values() if not (CACHE / item["file"]).exists()]
    if missing:
        raise SystemExit("missing source cache files; run with --fetch first: " + ", ".join(missing))

    species_names: dict[str, list[str]] = {}
    for pack in PACKS:
        rows = [json.loads(line) for line in (ROOT / "public/packs" / pack / "species.ndjson").read_text().splitlines() if line.strip()]
        species_names[pack] = [row["sciName"] for row in rows]
    all_names = sorted(set().union(*(set(v) for v in species_names.values())))

    consensus = read_csv(CACHE / INPUTS["leptraits-consensus"]["file"])
    records = read_csv(CACHE / INPUTS["leptraits-records"]["file"])
    books = {row["ResourceID"]: row for row in read_csv(CACHE / INPUTS["leptraits-books"]["file"], encoding="cp1252")}

    lep_by_species: dict[str, list[dict]] = defaultdict(list)
    for row in consensus:
        lep_by_species[row.get("Species", "")].append(row)

    regional_resources: dict[str, dict] = {}
    for pack, code in (("butterfly-th", "THA-OO"), ("butterfly-vn", "VIE-OO")):
        direct = {rid for rid, book in books.items() if code in book.get("WGS_Regions", "")}
        indochina = {rid for rid, book in books.items() if "41 Indo-China" in book.get("WGS_Regions", "")}
        regional_resources[pack] = {
            "direct": sorted(direct),
            "regional": sorted(direct | indochina),
            "titles": {rid: books[rid]["ResourceTitle"] for rid in sorted(direct | indochina)},
        }
    record_index: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in records:
        genus, species = row.get("Genus", ""), row.get("Species", "")
        if genus != "NA" and species != "NA":
            record_index[(row.get("ResourceID", ""), f"{genus} {species}")].append(row)

    hosts_index: dict[str, dict] = {}
    with (CACHE / INPUTS["hosts"]["file"]).open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            genus = (row.get("Insect Genus") or "").strip()
            epithet = (row.get("Insect Species") or "").strip()
            if not genus or not clean_epithet(epithet):
                continue
            if (row.get("Lab Rearing") or "").strip():
                continue
            insect = f"{genus} {epithet}"
            plant = plant_name(row)
            if not plant:
                continue
            entry = hosts_index.setdefault(insect, {"plants": {}, "rowIds": []})
            plant_entry = entry["plants"].setdefault(plant, {"family": (row.get("Hostplant Family") or "").strip(), "rowIds": []})
            host_id = row.get("HOSTS ID") or row.get("_id") or ""
            if host_id:
                plant_entry["rowIds"].append(host_id)
                entry["rowIds"].append(host_id)

    with zipfile.ZipFile(CACHE / INPUTS["avonet"]["file"]) as archive:
        avonet_text = archive.read("ELEData/TraitData/AVONET1_BirdLife.csv").decode("utf-8")
    avonet_rows = {row["Species1"]: row for row in csv.DictReader(io.StringIO(avonet_text))}

    species: dict[str, dict] = {}
    for name in all_names:
        item: dict = {}
        lep = merge_leptraits(consensus_rows(lep_by_species.get(name, []), name))
        if lep:
            lep["match"] = "exact scientific name"
            item["leptraits"] = lep

        for pack in ("butterfly-th", "butterfly-vn"):
            rows = [row for rid in regional_resources[pack]["regional"] for row in record_index.get((rid, name), [])]
            months = sorted({i + 1 for row in rows for i, col in enumerate(MONTH_COLUMNS) if row.get(col) == "1"})
            if months:
                resource_ids = sorted({row["ResourceID"] for row in rows if row.get("ResourceID")})
                direct_ids = set(regional_resources[pack]["direct"])
                country = "Thailand" if pack == "butterfly-th" else "Vietnam"
                if set(resource_ids) <= direct_ids:
                    scope = f"resources explicitly covering {country}"
                elif set(resource_ids) & direct_ids:
                    scope = f"resources explicitly covering {country} plus broader regional resources"
                else:
                    scope = "regional resources covering Indo-China; not necessarily country-specific"
                item.setdefault("regionalPhenology", {})[pack] = {
                    "months": months,
                    "recordIds": sorted({row["RecordID"] for row in rows if row.get("RecordID")}),
                    "resourceIds": resource_ids,
                    "scope": scope,
                }

        if name in hosts_index:
            plants = []
            for plant, data in hosts_index[name]["plants"].items():
                plants.append({"name": plant, "family": data["family"], "rowIds": sorted(set(data["rowIds"]), key=int)})
            plants.sort(key=lambda p: (0 if len(p["name"].split()) >= 2 else 1, p["name"].lower()))
            item["hosts"] = {
                "plants": plants,
                "rowIds": sorted(set(hosts_index[name]["rowIds"]), key=int),
                "match": "exact insect binomial",
            }

        bird = avonet_rows.get(name)
        if bird:
            item["avonet"] = {
                "habitat": bird.get("Habitat"),
                "habitatDensity": bird.get("Habitat.Density"),
                "migration": bird.get("Migration"),
                "trophicNiche": bird.get("Trophic.Niche"),
                "primaryLifestyle": bird.get("Primary.Lifestyle"),
                "massG": valid_number(bird.get("Mass", "")),
                "wingLengthMm": valid_number(bird.get("Wing.Length", "")),
                "beakLengthCulmenMm": valid_number(bird.get("Beak.Length_Culmen", "")),
                "inference": bird.get("Inference"),
                "totalIndividuals": int(bird.get("Total.individuals") or 0),
                "match": "exact BirdLife scientific name",
            }
        if item:
            species[name] = item

    return {
        "snapshot": "species-content-2026-11-27",
        "created": "2026-11-27",
        "packs": PACKS,
        "sources": SOURCE_METADATA,
        "upstreamFiles": {key: {"url": item["url"], "file": item["file"], "sha256": sha256(CACHE / item["file"])} for key, item in INPUTS.items()},
        "regionalResources": regional_resources,
        "species": species,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="download missing upstream files into data/source-cache")
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    if args.fetch:
        fetch_inputs()
    data = extract()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    counts = {}
    for pack in PACKS:
        rows = [json.loads(line) for line in (ROOT / "public/packs" / pack / "species.ndjson").read_text().splitlines() if line.strip()]
        names = [row["sciName"] for row in rows]
        counts[pack] = {
            "species": len(names),
            "leptraits": sum(bool(data["species"].get(n, {}).get("leptraits")) for n in names),
            "hosts": sum(bool(data["species"].get(n, {}).get("hosts")) for n in names),
            "regionalPhenology": sum(bool(data["species"].get(n, {}).get("regionalPhenology", {}).get(pack)) for n in names),
            "avonet": sum(bool(data["species"].get(n, {}).get("avonet")) for n in names),
        }
    print(json.dumps(counts, indent=2, sort_keys=True))
    print(f"wrote {args.output.relative_to(ROOT)} ({len(data['species'])} species keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
