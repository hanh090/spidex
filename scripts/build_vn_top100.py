#!/usr/bin/env python3
"""Build the Vietnam top-50 butterflies + top-50 birds dataset.

Commonness is taken from iNaturalist research-grade observation counts inside
Vietnam, so the ranking reflects what a person actually encounters rather than
a taxonomic checklist order. Reference photos are resolved through the shared
open-licence lookup; species with no commercially reusable photo are kept in
the set and flagged for a placeholder.
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inat_photo

OUT_JSON = "data/vietnam_top100_common.json"
RAW_DIR = "public/museum_specimens"
VIETNAM = inat_photo.VIETNAM_PLACE_ID
TAXA = [("butterfly", 47224, 50), ("bird", 3, 50)]

# Reuse the hand-written diagnostic notes already curated for the first 100.
LEGACY = "data/vietnam_50_birds_50_butterflies.json"


def load_legacy_marks():
    if not os.path.exists(LEGACY):
        return {}
    with open(LEGACY, "r", encoding="utf-8") as fh:
        d = json.load(fh)
    marks = {}
    for group in ("birds", "butterflies"):
        for item in d.get(group, []):
            if item.get("fieldMarks"):
                marks[item["sciName"]] = item["fieldMarks"]
    return marks


def api(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": inat_photo.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"  [WARN] {exc}")
        return None


def top_species(taxon_id, limit):
    """Most-observed research-grade species in Vietnam, descending."""
    out, page = [], 1
    while len(out) < limit:
        data = api(
            f"https://api.inaturalist.org/v1/observations/species_counts"
            f"?place_id={VIETNAM}&taxon_id={taxon_id}&quality_grade=research"
            f"&per_page=100&page={page}"
        )
        if not data or not data.get("results"):
            break
        for row in data["results"]:
            t = row["taxon"]
            # Species rank only - genus/subfamily aggregates are not plateable.
            if t.get("rank") != "species":
                continue
            out.append({
                "sciName": t["name"],
                "commonNameEn": t.get("preferred_common_name") or t["name"],
                "observations": row["count"],
                "taxonId": t["id"],
            })
            if len(out) >= limit:
                break
        page += 1
        time.sleep(1)
    return out


def vietnamese_name(taxon_id):
    data = api(f"https://api.inaturalist.org/v1/taxa/{taxon_id}?locale=vi")
    if not data or not data.get("results"):
        return ""
    name = data["results"][0].get("preferred_common_name") or ""
    return name


def main():
    marks = load_legacy_marks()
    os.makedirs(RAW_DIR, exist_ok=True)
    dataset = {"version": 1, "title": "Vietnam Top 100 Most-Observed Species",
               "source": f"iNaturalist research-grade observation counts, place_id={VIETNAM} (Vietnam)",
               "butterflies": [], "birds": []}

    for taxon, taxon_id, limit in TAXA:
        bucket = "butterflies" if taxon == "butterfly" else "birds"
        print(f"\n=== {taxon.upper()}: ranking top {limit} in Vietnam ===")
        species = top_species(taxon_id, limit)
        for idx, sp in enumerate(species, 1):
            slug = sp["sciName"].lower().replace(" ", "_")
            raw_name = f"{taxon}_{slug}_raw.jpg"
            raw_path = os.path.join(RAW_DIR, raw_name)
            entry = {
                "index": idx,
                "taxon": taxon,
                "sciName": sp["sciName"],
                "commonNameEn": sp["commonNameEn"],
                "commonNameVi": vietnamese_name(sp["taxonId"]),
                "observations": sp["observations"],
                "fieldMarks": marks.get(sp["sciName"], ""),
                "rawUrl": f"museum_specimens/{raw_name}",
                "plateUrl": f"museum_specimens/{taxon}_{slug}_plate.jpg",
                "plateReady": False,
                "placeholder": False,
            }
            # A file on disk is not enough: plates from the pre-licence-filter era
            # left raw photos behind whose licence was never recorded. Only treat a
            # cached photo as usable when this dataset already vouches for it.
            cached_ok = (os.path.exists(raw_path) and os.path.getsize(raw_path) > 10000
                         and entry.get("license") in ("cc0", "cc-by", "cc-by-sa"))
            if cached_ok:
                entry["photoStatus"] = "cached"
            else:
                photo = inat_photo.find_photo(sp["sciName"])
                if photo:
                    try:
                        inat_photo.download(photo, raw_path)
                        entry.update({
                            "photoStatus": "ok",
                            "license": photo["license"],
                            "attribution": photo["attribution"],
                            "observer": photo["observer"],
                            "photoSource": photo["source"],
                        })
                    except Exception as exc:
                        entry["photoStatus"] = f"download-failed: {exc}"
                else:
                    # No commercially reusable photo -> placeholder, redraw later.
                    entry["photoStatus"] = "no-open-license-photo"
                    entry["placeholder"] = True
            flag = entry["photoStatus"]
            print(f"  {idx:3d}. {sp['sciName']:34s} obs={sp['observations']:5d}  {flag}")
            dataset[bucket].append(entry)

    dataset["stats"] = {
        "butterflies": len(dataset["butterflies"]),
        "birds": len(dataset["birds"]),
        "needPlaceholder": sum(1 for g in ("butterflies", "birds")
                               for e in dataset[g] if e["placeholder"]),
    }
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, indent=2, ensure_ascii=False)
    print(f"\nWrote {OUT_JSON}: {dataset['stats']}")


if __name__ == "__main__":
    main()
