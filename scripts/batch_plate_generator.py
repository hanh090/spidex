#!/usr/bin/env python3
"""
Spidex Scientific Field Guide Plate Batch Generator.
Automates downloading reference photos and compiling scientific field guide plates
for the 50 Birds and 50 Butterflies of Vietnam.
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from PIL import Image

DATA_FILE = "data/vietnam_50_birds_50_butterflies.json"
PUB_DIR = "public/museum_specimens"
SPEC_DIR = "museum_specimens"

def load_dataset():
    if not os.path.exists(DATA_FILE):
        print(f"Error: {DATA_FILE} not found!")
        sys.exit(1)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_dataset(data):
    # Recalculate stats
    data["stats"]["readyBirds"] = sum(1 for b in data["birds"] if b["plateReady"])
    data["stats"]["readyButterflies"] = sum(1 for b in data["butterflies"] if b["plateReady"])
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def download_reference_photo(item, taxon_group):
    raw_slug = item["id"].replace("bvn-", "").replace("butterfly-", "").replace("bird_", "")
    prefix = "bird" if taxon_group == "bird" else "butterfly"
    out_name = f"{prefix}_{raw_slug}_raw.jpg"
    pub_path = os.path.join(PUB_DIR, out_name)
    spec_path = os.path.join(SPEC_DIR, out_name)

    if os.path.exists(pub_path) and os.path.getsize(pub_path) > 10000:
        return pub_path

    sci_name = item["sciName"]
    print(f"Searching reference photo for {sci_name} ({item['commonNameEn']})...", flush=True)

    # 1. Search iNaturalist research-grade observation
    query = urllib.parse.quote(sci_name)
    url = f"https://api.inaturalist.org/v1/observations?taxon_name={query}&quality_grade=research&photos=true&per_page=3"
    req = urllib.request.Request(url, headers={"User-Agent": "SpidexBatch/1.0"})
    
    photo_url = None
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            d = json.loads(resp.read().decode())
            results = d.get("results", [])
            for r in results:
                for p in r.get("photos", []):
                    u = p.get("url", "").replace("square", "large")
                    if u:
                        photo_url = u
                        break
                if photo_url:
                    break
    except Exception as e:
        print(f"  iNat search error for {sci_name}: {e}")

    # 2. Fallback to Wikimedia Commons
    if not photo_url:
        w_query = f"{sci_name} open wing" if taxon_group == "butterfly" else sci_name
        w_url = f"https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={urllib.parse.quote(w_query)}&gsrlimit=3&prop=imageinfo&iiprop=url|size&format=json"
        try:
            with urllib.request.urlopen(urllib.request.Request(w_url, headers={"User-Agent": "SpidexBatch/1.0"}), timeout=12) as resp:
                wd = json.loads(resp.read().decode())
                pages = wd.get("query", {}).get("pages", {})
                for pid, pdata in pages.items():
                    ii = pdata.get("imageinfo", [{}])[0]
                    u = ii.get("url")
                    if u and (u.lower().endswith(".jpg") or u.lower().endswith(".jpeg")):
                        photo_url = u
                        break
        except Exception as e:
            print(f"  Commons search error for {sci_name}: {e}")

    if photo_url:
        try:
            with urllib.request.urlopen(urllib.request.Request(photo_url, headers={"User-Agent": "SpidexBatch/1.0"}), timeout=20) as resp:
                os.makedirs(PUB_DIR, exist_ok=True)
                with open(pub_path, "wb") as f:
                    f.write(resp.read())
            # Normalize and resize
            im = Image.open(pub_path).convert("RGB")
            im.thumbnail((1200, 1200))
            im.save(pub_path, "JPEG", quality=90)
            im.save(spec_path, "JPEG", quality=90)
            print(f"  Downloaded & cached reference photo to {pub_path} ({os.path.getsize(pub_path)} bytes)")
            item["rawUrl"] = f"museum_specimens/{out_name}"
            return pub_path
        except Exception as e:
            print(f"  Download error: {e}")
            return None
    else:
        print(f"  Could not locate high-res photo for {sci_name}")
        return None

def generate_plate_with_api(item, taxon_group, api_key):
    slug = item["id"].replace("bvn-", "").replace("butterfly-", "").replace("bird_", "").replace("butterfly_", "")
    prefix = "bird" if taxon_group == "bird" else "butterfly"
    plate_name = f"{prefix}_{slug}_plate.jpg"
    pub_plate_path = os.path.join(PUB_DIR, plate_name)
    spec_plate_path = os.path.join(SPEC_DIR, plate_name)

    if os.path.exists(pub_plate_path) and os.path.getsize(pub_plate_path) > 10000:
        item["plateReady"] = True
        item["plateUrl"] = f"museum_specimens/{plate_name}"
        return pub_plate_path

    raw_path = download_reference_photo(item, taxon_group)
    if not raw_path or not os.path.exists(raw_path):
        print(f"  Cannot generate plate without reference photo for {item['sciName']}")
        return None

    print(f"Generating plate for {item['sciName']} ({item['commonNameEn']})...", flush=True)

    with open(raw_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    if taxon_group == "butterfly":
        prompt = (
            f"Natural history field guide illustration of the {item['commonNameEn']} butterfly ({item['sciName']}). "
            f"Redraw into a clean scientific color pencil and watercolor illustration on pure solid white background. "
            f"Biological presentation: dorsal view with symmetrical fully spread open wings displaying complete wing venation, "
            f"{item['fieldMarks']}. Clean standalone illustration. No text, no captions, no labels, no pins, no shadows, no frames."
        )
    else:
        prompt = (
            f"Natural history field guide illustration of the {item['commonNameEn']} ({item['sciName']}). "
            f"Redraw into a clean scientific color pencil and watercolor illustration on pure solid white background. "
            f"Biological presentation: standard specimen profile, lateral view displaying plumage, "
            f"{item['fieldMarks']}. Clean standalone illustration. No text, no captions, no labels, no pins, no shadows, no frames."
        )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": img_b64
                        }
                    }
                ]
            }
        ]
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                for p in parts:
                    if "inlineData" in p:
                        img_data = base64.b64decode(p["inlineData"]["data"])
                        with open(pub_plate_path, "wb") as f:
                            f.write(img_data)
                        with open(spec_plate_path, "wb") as f:
                            f.write(img_data)
                        item["plateReady"] = True
                        item["plateUrl"] = f"museum_specimens/{plate_name}"
                        print(f"  ✓ Successfully created plate: {pub_plate_path} ({len(img_data)} bytes)")
                        return pub_plate_path
    except Exception as e:
        print(f"  API generation error: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Batch generate Spidex field guide plates.")
    parser.add_argument("--taxon", choices=["bird", "butterfly", "all"], default="all", help="Taxon group to process")
    parser.add_argument("--fetch-photos-only", action="store_true", help="Download all missing reference photos without generating plates")
    parser.add_argument("--status", action="store_true", help="Show current generation progress")
    parser.add_argument("--api-key", help="Google Gemini / Vertex API key for high-speed batch generation")
    args = parser.parse_args()

    data = load_dataset()
    stats = data["stats"]

    if args.status:
        print("\n=== Spidex Vietnam Field Guide Plate Status ===")
        print(f"Birds of Vietnam:       {stats['readyBirds']}/{stats['totalBirds']} plates ready ({stats['readyBirds']/stats['totalBirds']*100:.1f}%)")
        print(f"Butterflies of Vietnam: {stats['readyButterflies']}/{stats['totalButterflies']} plates ready ({stats['readyButterflies']/stats['totalButterflies']*100:.1f}%)")
        total_ready = stats['readyBirds'] + stats['readyButterflies']
        total = stats['totalBirds'] + stats['totalButterflies']
        print(f"Total Progress:         {total_ready}/{total} plates ready ({total_ready/total*100:.1f}%)\n")
        return

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")

    items_to_process = []
    if args.taxon in ["bird", "all"]:
        for b in data["birds"]:
            items_to_process.append((b, "bird"))
    if args.taxon in ["butterfly", "all"]:
        for bf in data["butterflies"]:
            items_to_process.append((bf, "butterfly"))

    if args.fetch_photos_only or not api_key:
        if not api_key and not args.fetch_photos_only:
            print("\nNote: No GEMINI_API_KEY provided. Fetching reference photos only.")
            print("To generate remaining AI plates at high speed, provide: --api-key YOUR_KEY\n")

        print(f"Checking reference photos for {len(items_to_process)} species...")
        fetched_count = 0
        for item, group in items_to_process:
            res = download_reference_photo(item, group)
            if res:
                fetched_count += 1
        save_dataset(data)
        print(f"\nPhoto ingestion complete! {fetched_count}/{len(items_to_process)} reference photos are cached on disk.")
        return

    # Run plate generation with API key
    print(f"Starting batch plate generation with API key for {len(items_to_process)} species...")
    success_count = 0
    for item, group in items_to_process:
        if not item.get("plateReady"):
            res = generate_plate_with_api(item, group, api_key)
            if res:
                success_count += 1
                save_dataset(data)
                import time
                time.sleep(1)  # polite throttle

    save_dataset(data)
    print(f"\nBatch generation cycle finished! {success_count} new plates generated.")

if __name__ == "__main__":
    main()
