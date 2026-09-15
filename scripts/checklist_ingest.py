#!/usr/bin/env python3
"""
Scientific Checklist Ingest Engine for Spidex.
Pulls complete species checklists from GBIF and iNaturalist for specified regions and taxa.
Uses concurrent requests for fast ingestion of 1,000+ species.
"""
import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "Spidex-Scientific-Checklist/1.0 (https://github.com/hanh090/spidex; biodiversity-bot)"

CONFIGS = {
    "butterfly-vn": {
        "region": "VN",
        "region_name": {"en": "Vietnam", "vi": "Việt Nam"},
        "taxon_name": "butterfly",
        "taxon_group": "lepidoptera",
        "gbif_taxon_key": 7017,  # Superfamily Papilionoidea (True butterflies)
        "inat_place_id": 7183,
        "inat_taxon_id": 47224,
    },
    "bird-vn": {
        "region": "VN",
        "region_name": {"en": "Vietnam", "vi": "Việt Nam"},
        "taxon_name": "bird",
        "taxon_group": "aves",
        "gbif_taxon_key": 212,  # Class Aves
        "inat_place_id": 7183,
        "inat_taxon_id": 3,
    },
    "bird-th": {
        "region": "TH",
        "region_name": {"en": "Thailand", "vi": "Thái Lan"},
        "taxon_name": "bird",
        "taxon_group": "aves",
        "gbif_taxon_key": 212,
        "inat_place_id": 6967,
        "inat_taxon_id": 3,
    },
    "butterfly-sg": {
        "region": "SG",
        "region_name": {"en": "Singapore", "vi": "Singapore"},
        "taxon_name": "butterfly",
        "taxon_group": "lepidoptera",
        "gbif_taxon_key": 7017,
        "inat_place_id": 6734,
        "inat_taxon_id": 47224,
    },
    "butterfly-th": {
        "region": "TH",
        "region_name": {"en": "Thailand", "vi": "Thái Lan"},
        "taxon_name": "butterfly",
        "taxon_group": "lepidoptera",
        "gbif_taxon_key": 7017,
        "inat_place_id": 6967,
        "inat_taxon_id": 47224,
    },
}

def api_get(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                return None
            time.sleep(0.3 * (attempt + 1))
    return None

def lookup_single_gbif_species(item):
    species_key = item.get("name")
    occurrence_count = item.get("count", 0)
    sp_url = f"https://api.gbif.org/v1/species/{species_key}"
    sp_data = api_get(sp_url)
    if not sp_data or sp_data.get("rank") != "SPECIES":
        return None
    
    sci_name = sp_data.get("canonicalName") or sp_data.get("scientificName")
    return {
        "gbif_key": species_key,
        "sci_name": sci_name,
        "canonical_name": sp_data.get("canonicalName", sci_name),
        "taxonomic_status": sp_data.get("taxonomicStatus", "ACCEPTED"),
        "family": sp_data.get("family", "Unknown"),
        "genus": sp_data.get("genus", ""),
        "gbif_occurrences": occurrence_count,
    }

def fetch_gbif_species_checklist(country_code, gbif_taxon_key, max_species=2500):
    print(f"Querying GBIF occurrences for country={country_code}, taxonKey={gbif_taxon_key}...", flush=True)
    url = (
        f"https://api.gbif.org/v1/occurrence/search?"
        f"country={country_code}&taxonKey={gbif_taxon_key}&facet=speciesKey&facetLimit={max_species}&limit=0"
    )
    data = api_get(url)
    if not data or "facets" not in data or not data["facets"]:
        return []
    
    counts = data["facets"][0].get("counts", [])
    print(f"Found {len(counts)} candidate species keys in GBIF. Fetching taxonomy in parallel...", flush=True)
    
    species_list = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(lookup_single_gbif_species, it): it for it in counts}
        done_count = 0
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                species_list.append(res)
            done_count += 1
            if done_count % 50 == 0 or done_count == len(counts):
                print(f"  GBIF progress: {done_count}/{len(counts)} resolved ({len(species_list)} valid species)", flush=True)
                
    return species_list

def fetch_inat_page(place_id, inat_taxon_id, page=1, per_page=100):
    url = (
        f"https://api.inaturalist.org/v1/observations/species_counts?"
        f"place_id={place_id}&taxon_id={inat_taxon_id}&quality_grade=research&page={page}&per_page={per_page}"
    )
    data = api_get(url)
    if not data:
        return 0, []
    
    total = data.get("total_results", 0)
    results = []
    for item in data.get("results", []):
        count = item.get("count", 0)
        taxon = item.get("taxon", {})
        sci_name = taxon.get("name")
        common_name = taxon.get("preferred_common_name")
        family = ""
        for anc in taxon.get("ancestors", []):
            if anc.get("rank") == "family":
                family = anc.get("name")
                break
                
        default_photo = taxon.get("default_photo", {})
        photo_info = None
        if default_photo:
            photo_info = {
                "id": default_photo.get("id"),
                "url": default_photo.get("medium_url") or default_photo.get("url"),
                "license": default_photo.get("license_code"),
                "attribution": default_photo.get("attribution"),
            }
            
        results.append({
            "inat_id": taxon.get("id"),
            "sci_name": sci_name,
            "common_name_en": common_name,
            "family": family,
            "inat_observations": count,
            "photo": photo_info,
            "wikipedia_url": taxon.get("wikipedia_url"),
        })
    return total, results

def get_all_inat_species(place_id, inat_taxon_id, max_results=1500):
    print(f"Querying iNaturalist place_id={place_id}, taxon_id={inat_taxon_id}...", flush=True)
    all_results = []
    page = 1
    per_page = 100
    while len(all_results) < max_results:
        total, results = fetch_inat_page(place_id, inat_taxon_id, page=page, per_page=per_page)
        if not results:
            break
        all_results.extend(results)
        print(f"  iNat progress: page {page} fetched ({len(all_results)}/{total} species)", flush=True)
        if len(all_results) >= total:
            break
        page += 1
        time.sleep(0.3)
    return all_results

def merge_checklists(pack_key, out_dir):
    cfg = CONFIGS[pack_key]
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. Fetch iNaturalist observed species with photos & common names
    inat_species = get_all_inat_species(cfg["inat_place_id"], cfg["inat_taxon_id"])
    
    # 2. Query GBIF occurrence species checklist in parallel
    gbif_species = fetch_gbif_species_checklist(cfg["region"], cfg["gbif_taxon_key"])
    
    # Merge datasets
    merged = {}
    for sp in gbif_species:
        name_key = sp["sci_name"].strip().lower()
        merged[name_key] = {
            "sciName": sp["sci_name"],
            "canonicalName": sp["canonical_name"],
            "family": sp["family"],
            "genus": sp["genus"],
            "gbifKey": sp["gbif_key"],
            "gbifOccurrences": sp["gbif_occurrences"],
            "inatObservations": 0,
            "commonNames": {},
            "photos": [],
        }
        
    for sp in inat_species:
        name_key = sp["sci_name"].strip().lower()
        if name_key in merged:
            merged[name_key]["inatObservations"] = sp["inat_observations"]
            if sp.get("common_name_en"):
                merged[name_key]["commonNames"]["en"] = sp["common_name_en"]
            if sp.get("photo"):
                merged[name_key]["photos"].append(sp["photo"])
            if sp.get("family") and merged[name_key]["family"] == "Unknown":
                merged[name_key]["family"] = sp["family"]
        else:
            merged[name_key] = {
                "sciName": sp["sci_name"],
                "canonicalName": sp["sci_name"],
                "family": sp["family"] or "Unknown",
                "genus": sp["sci_name"].split()[0] if " " in sp["sci_name"] else "",
                "gbifKey": None,
                "gbifOccurrences": 0,
                "inatObservations": sp["inat_observations"],
                "commonNames": {"en": sp["common_name_en"]} if sp.get("common_name_en") else {},
                "photos": [sp["photo"]] if sp.get("photo") else [],
            }
            
    sorted_species = sorted(
        merged.values(),
        key=lambda x: (x["inatObservations"] + x["gbifOccurrences"]),
        reverse=True
    )
    
    output_file = os.path.join(out_dir, f"{pack_key}_checklist.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump({
            "pack_id": pack_key,
            "region": cfg["region"],
            "taxon_group": cfg["taxon_group"],
            "total_species": len(sorted_species),
            "species": sorted_species
        }, f, indent=2, ensure_ascii=False)
        
    print(f"\n=======================================================", flush=True)
    print(f"Successfully generated scientific checklist: {output_file}", flush=True)
    print(f"Total verified species for {pack_key}: {len(sorted_species)}", flush=True)
    print(f"=======================================================\n", flush=True)
    return output_file

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest scientific checklists for Spidex packs.")
    parser.add_argument("pack", choices=list(CONFIGS.keys()), help="Target pack key")
    parser.add_argument("--out-dir", default="data/checklists", help="Output directory")
    args = parser.parse_args()
    merge_checklists(args.pack, args.out_dir)
