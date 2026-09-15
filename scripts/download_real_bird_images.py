#!/usr/bin/env python3
"""
Automated downloader for real observational field photos of the Birds of Vietnam.
Sources high-resolution research-grade Creative Commons photos from:
1. iNaturalist API (Vietnam place_id=6847 prioritized, fallback to global research observations)
2. Wikimedia Commons API (secondary fallback)

Saves photos into:
- public/museum_specimens/bird_{slug}_raw.jpg
- public/packs/bird-vn/img/bird-{slug}.jpg
- dist/packs/bird-vn/img/bird-{slug}.jpg
Updates data/checklists/vietnam_birds_master_checklist.json with metadata and license attribution.
"""
import os
import sys
import json
import re
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inat_photo

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
CHECKLIST_FILE = os.path.join(PROJECT_ROOT, "data/checklists/vietnam_birds_master_checklist.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
PACK_IMG_PUB = os.path.join(PROJECT_ROOT, "public/packs/bird-vn/img")
PACK_IMG_DIST = os.path.join(PROJECT_ROOT, "dist/packs/bird-vn/img")

USER_AGENT = "SpidexFieldGuide/2.0 (Biodiversity Research; contact: team@spidex.io)"

def slugify(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')

def fetch_json_with_retry(url, headers, retries=2):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            break
        except Exception:
            if attempt < retries:
                time.sleep(1.0)
                continue
            break
    return None

TAXON_SYNONYMS = {
    "Treron phyayrei": "Treron phayrei",
    "Todirhamphus chloris": "Todiramphus chloris",
    "Lophura edwardsi": "Lophura edwardsi",
    "Merops leschenaultia": "Merops leschenaulti",
    "Locustella mendelli": "Locustella mandelli",
    "Tephrodornis gularis": "Tephrodornis virgatus",
    "Gypsophila brevicaudatus": "Gypsophila brevicaudata",
}

def get_inat_photo(sci_name):
    """Open-licence, highest-resolution reference photo via the shared lookup.

    Falls through to Wikimedia Commons only when iNaturalist has nothing
    commercially reusable for the species.
    """
    clean_name = TAXON_SYNONYMS.get(sci_name.strip(), sci_name.strip())
    headers = {"User-Agent": USER_AGENT}
    q = urllib.parse.quote(clean_name)

    photo = inat_photo.find_photo(clean_name)
    if photo:
        return photo

    # 3. Try Wikimedia Commons fallback
    w_url = f"https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={q}&gsrlimit=3&prop=imageinfo&iiprop=url|size|extmetadata&format=json"
    try:
        req = urllib.request.Request(w_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            wd = json.loads(r.read().decode("utf-8"))
            pages = wd.get("query", {}).get("pages", {})
            for pid, pdata in pages.items():
                ii = pdata.get("imageinfo", [{}])[0]
                u = ii.get("url")
                if u and (u.lower().endswith(".jpg") or u.lower().endswith(".jpeg")):
                    meta = ii.get("extmetadata", {})
                    artist = meta.get("Artist", {}).get("value", "")
                    license_name = meta.get("LicenseShortName", {}).get("value", "CC-BY-SA")
                    return {
                        "url": u,
                        "attribution": artist,
                        "license": license_name,
                        "source": "Wikimedia Commons",
                        "observer": artist
                    }
    except Exception:
        pass

    return None

def download_and_process_photo(photo_meta, slug):
    url = photo_meta["url"]
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw_bytes = resp.read()
    
    im = Image.open(io.BytesIO(raw_bytes))
    if im.mode != "RGB":
        im = im.convert("RGB")
    
    # Thumbnail to max 1200x1200 maintaining aspect ratio
    im.thumbnail((1200, 1200), getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS)
    
    spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
    pub_pack_path = os.path.join(PACK_IMG_PUB, f"bird-{slug}.jpg")
    dist_pack_path = os.path.join(PACK_IMG_DIST, f"bird-{slug}.jpg")
    
    os.makedirs(SPECIMENS_DIR, exist_ok=True)
    os.makedirs(PACK_IMG_PUB, exist_ok=True)
    os.makedirs(PACK_IMG_DIST, exist_ok=True)
    
    im.save(spec_path, format="JPEG", quality=90)
    im.save(pub_pack_path, format="JPEG", quality=90)
    im.save(dist_pack_path, format="JPEG", quality=90)
    
    return spec_path, os.path.getsize(spec_path)

def process_species(species_item):
    sci_name = species_item["sciName"].strip()
    slug = slugify(sci_name)
    spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
    
    # If already exists and valid, skip download
    if os.path.exists(spec_path) and os.path.getsize(spec_path) > 10000:
        return {
            "index": species_item["index"],
            "sciName": sci_name,
            "status": "already_exists",
            "size": os.path.getsize(spec_path)
        }
    
    photo_info = get_inat_photo(sci_name)
    if not photo_info:
        return {
            "index": species_item["index"],
            "sciName": sci_name,
            "status": "not_found"
        }
    
    try:
        saved_path, size = download_and_process_photo(photo_info, slug)
        return {
            "index": species_item["index"],
            "sciName": sci_name,
            "status": "success",
            "size": size,
            "meta": photo_info,
            "slug": slug
        }
    except Exception as e:
        return {
            "index": species_item["index"],
            "sciName": sci_name,
            "status": f"error: {str(e)}"
        }

def main():
    parser = argparse.ArgumentParser(description="Download real bird observation photos for Vietnam checklist.")
    parser.add_argument("--limit", type=int, default=50, help="Number of species to download in this batch (default: 50, use 0 for all).")
    parser.add_argument("--start", type=int, default=1, help="Start species index (default: 1).")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads (default: 4).")
    args = parser.parse_args()

    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
        master_data = json.load(f)
    
    species_list = master_data["species"]
    print(f"Loaded master checklist with {len(species_list)} species.")
    
    # Filter candidates
    candidates = []
    for sp in species_list:
        if sp["index"] < args.start:
            continue
        slug = slugify(sp["sciName"])
        spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
        if not os.path.exists(spec_path) or os.path.getsize(spec_path) < 10000:
            candidates.append(sp)
    
    if args.limit > 0:
        candidates = candidates[:args.limit]
    
    print(f"Targeting {len(candidates)} species for photo download (workers: {args.workers})...\n")
    
    success_count = 0
    not_found_count = 0
    t0 = time.time()
    
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_species, sp): sp for sp in candidates}
        for i, future in enumerate(as_completed(futures), 1):
            res = future.result()
            idx = res["index"]
            sci = res["sciName"]
            st = res["status"]
            if st == "success":
                success_count += 1
                meta = res["meta"]
                print(f"[{i}/{len(candidates)}] ✓ #{idx} {sci} -> {meta['source']} ({res['size']} B)")
                try:
                    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
                        cdata = json.load(f)
                    for sp in cdata["species"]:
                        if sp["index"] == idx:
                            sp["hasReferencePhoto"] = True
                            sp["referencePhotoUrl"] = f"museum_specimens/bird_{res['slug']}_raw.jpg"
                            sp["photoSource"] = meta["source"]
                            sp["photoLicense"] = meta["license"]
                            sp["photoCredit"] = meta["attribution"]
                            break
                    tmp = CHECKLIST_FILE + f".tmp_{idx}"
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump(cdata, f, indent=2, ensure_ascii=False)
                    os.replace(tmp, CHECKLIST_FILE)
                except Exception as ex:
                    print(f"  Warning: Checklist save error for #{idx}: {ex}")
            elif st == "already_exists":
                success_count += 1
                print(f"[{i}/{len(candidates)}] = #{idx} {sci} (already exists)")
            else:
                not_found_count += 1
                print(f"[{i}/{len(candidates)}] ✗ #{idx} {sci} -> {st}")
            
            time.sleep(0.15) # Polite delay
    
    elapsed = time.time() - t0
    print(f"\n==========================================")
    print(f"Batch completed in {elapsed:.1f}s!")
    print(f"Successfully downloaded: {success_count} photos")
    print(f"Not found or failed: {not_found_count}")
    print(f"Master checklist saved to {CHECKLIST_FILE}")

if __name__ == "__main__":
    main()
