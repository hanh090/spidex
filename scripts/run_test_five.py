#!/usr/bin/env python3
import os
import sys
import json
import base64
import time
import urllib.request
import urllib.error
from PIL import Image

DATA_FILE = "data/vietnam_50_birds_50_butterflies.json"
PUB_DIR = "public/museum_specimens"
SPEC_DIR = "museum_specimens"

def get_api_key():
    env_paths = [
        "/Users/hanhle/projects/gabo/gabo-crawler/.env",
        "/Users/hanhle/projects/gabo/flexlane-api/.env.marketing"
    ]
    for p in env_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("GEMINI_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip("\"'")
                        if val:
                            return val
    return os.environ.get("GEMINI_API_KEY")

def generate_plate(item, taxon_group, api_key):
    slug = item["id"].replace("bvn-", "").replace("butterfly-", "").replace("bird_", "").replace("butterfly_", "")
    prefix = "bird" if taxon_group == "bird" else "butterfly"
    raw_name = f"{prefix}_{slug}_raw.jpg"
    plate_name = f"{prefix}_{slug}_plate.jpg"
    raw_path = os.path.join(PUB_DIR, raw_name)
    pub_plate = os.path.join(PUB_DIR, plate_name)
    spec_plate = os.path.join(SPEC_DIR, plate_name)

    if os.path.exists(pub_plate) and os.path.getsize(pub_plate) > 10000:
        print(f"  [SKIPPED] {plate_name} already exists ({os.path.getsize(pub_plate)} bytes)")
        item["plateReady"] = True
        item["plateUrl"] = f"museum_specimens/{plate_name}"
        return True

    if not os.path.exists(raw_path):
        print(f"  [ERROR] Raw photo not found: {raw_path}")
        return False

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

    print(f"  Generating plate for {item['sciName']} ({item['commonNameEn']})...", flush=True)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            candidates = res.get("candidates", [])
            if not candidates:
                print("  [ERROR] No candidates in API response")
                return False

            parts = candidates[0].get("content", {}).get("parts", [])
            for p in parts:
                if "inlineData" in p:
                    b64_data = p["inlineData"].get("data", "")
                    img_bytes = base64.b64decode(b64_data)
                    with open(pub_plate, "wb") as out_f:
                        out_f.write(img_bytes)
                    with open(spec_plate, "wb") as out_f:
                        out_f.write(img_bytes)
                    item["plateReady"] = True
                    item["plateUrl"] = f"museum_specimens/{plate_name}"
                    print(f"  [SUCCESS] Created {pub_plate} ({len(img_bytes)} bytes)")
                    return True
            print("  [WARN] No inlineData found in parts")
            return False
    except urllib.error.HTTPError as e:
        print(f"  [HTTP ERROR] {e.code}: {e.read().decode('utf-8')[:300]}")
        return False
    except Exception as e:
        print(f"  [ERROR] {e}")
        return False

def main():
    api_key = get_api_key()
    if not api_key:
        print("Error: Could not locate GEMINI_API_KEY in gabo project or environment!")
        sys.exit(1)
    print("Located valid GEMINI_API_KEY from gabo project.")

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    test_targets = [
        ("bvn-bird_spotted_dove", "bird"),
        ("bvn-bird_chinese_pond_heron", "bird"),
        ("bvn-bird_greater_coucal", "bird"),
        ("butterfly-butterfly_parantica_aglea", "butterfly"),
        ("butterfly-butterfly_elymnias_hypermnestra", "butterfly")
    ]

    success_count = 0
    for target_id, group in test_targets:
        items = data["birds"] if group == "bird" else data["butterflies"]
        match = next((x for x in items if x["id"] == target_id), None)
        if not match:
            print(f"Target {target_id} not found in dataset!")
            continue

        print(f"\nProcessing [{group.upper()}] {match['commonNameEn']} ({match['sciName']}):")
        ok = generate_plate(match, group, api_key)
        if ok:
            success_count += 1
        time.sleep(2)

    data["stats"]["readyBirds"] = sum(1 for b in data["birds"] if b.get("plateReady"))
    data["stats"]["readyButterflies"] = sum(1 for b in data["butterflies"] if b.get("plateReady"))

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n==========================================")
    print(f"Test batch completed! {success_count}/{len(test_targets)} plates ready.")
    print(f"Total ready birds: {data['stats']['readyBirds']}/50")
    print(f"Total ready butterflies: {data['stats']['readyButterflies']}/50")
    print(f"==========================================")

if __name__ == "__main__":
    main()
