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
ARTIFACT_DIR = "/Users/hanhle/.gemini/antigravity-cli/brain/1adceb6d-d470-4ab8-9149-d2088781da4c"

def get_openrouter_key():
    env_paths = [
        "/Users/hanhle/projects/gabo/flexlane-api/.env.dev",
        "/Users/hanhle/projects/personal-stuff/vinanonwoven/.claude/.env",
        "/Users/hanhle/projects/gabo/flexlane-api-main/.env.dev"
    ]
    for p in env_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    if "sk-or-v1-" in line:
                        parts = line.strip().split("=", 1)
                        if len(parts) == 2:
                            val = parts[1].strip().strip("\"'")
                            if val:
                                return val
    return os.environ.get("OPENROUTER_API_KEY")

def get_openrouter_credits(key):
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/credits",
        headers={"Authorization": f"Bearer {key}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return data.get("data", {})
    except Exception as e:
        print(f"Error fetching credits: {e}")
        return {}

def generate_plate_openrouter(item, taxon_group, key):
    slug = item["id"].replace("bvn-", "").replace("butterfly-", "").replace("bird_", "").replace("butterfly_", "")
    prefix = "bird" if taxon_group == "bird" else "butterfly"
    raw_name = f"{prefix}_{slug}_raw.jpg"
    plate_name = f"{prefix}_{slug}_plate.jpg"
    raw_path = os.path.join(PUB_DIR, raw_name)
    pub_plate = os.path.join(PUB_DIR, plate_name)
    spec_plate = os.path.join(SPEC_DIR, plate_name)
    artifact_plate = os.path.join(ARTIFACT_DIR, plate_name)

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

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spidex.io",
        "X-Title": "Spidex Field Guide"
    }

    payload = {
        "model": "google/gemini-2.5-flash-image",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}"
                        }
                    }
                ]
            }
        ],
        "modalities": ["image", "text"]
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers
    )

    print(f"  Requesting plate via OpenRouter for {item['sciName']} ({item['commonNameEn']})...", flush=True)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            elapsed = time.time() - t0
            res = json.loads(resp.read().decode("utf-8"))
            choice = res.get("choices", [{}])[0]
            msg = choice.get("message", {})
            images = msg.get("images", [])
            if not images:
                print(f"  [ERROR] No images in OpenRouter response (content: {msg.get('content')})")
                return False

            img_url = images[0].get("image_url", {}).get("url", "")
            if not img_url.startswith("data:image/"):
                print(f"  [ERROR] Unexpected image URL format: {img_url[:60]}")
                return False

            # Extract base64
            header, b64_data = img_url.split(",", 1)
            img_bytes = base64.b64decode(b64_data)

            # Save
            with open(pub_plate, "wb") as f:
                f.write(img_bytes)
            with open(spec_plate, "wb") as f:
                f.write(img_bytes)
            with open(artifact_plate, "wb") as f:
                f.write(img_bytes)

            item["plateReady"] = True
            item["plateUrl"] = f"museum_specimens/{plate_name}"
            print(f"  [SUCCESS] Generated {plate_name} ({len(img_bytes)} bytes in {elapsed:.1f}s)")
            return True
    except urllib.error.HTTPError as e:
        print(f"  [HTTP ERROR] {e.code}: {e.read().decode('utf-8')[:300]}")
        return False
    except Exception as e:
        print(f"  [ERROR] {e}")
        return False

def main():
    key = get_openrouter_key()
    if not key:
        print("Error: Could not find OpenRouter API key in gabo or env!")
        sys.exit(1)

    print(f"Located OpenRouter API key: {key[:14]}...{key[-4:]}")
    init_credits = get_openrouter_credits(key)
    print(f"Initial OpenRouter Credits: total=${init_credits.get('total_credits')}, used=${init_credits.get('total_usage')}")
    rem_before = float(init_credits.get('total_credits', 0)) - float(init_credits.get('total_usage', 0))
    print(f"Initial Balance Available: ${rem_before:.4f} USD\n")

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 10 target species (5 birds + 5 butterflies)
    unready_birds = [b for b in data["birds"] if not b.get("plateReady")][:5]
    unready_butterflies = [bf for bf in data["butterflies"] if not bf.get("plateReady")][:5]
    targets = [(b, "bird") for b in unready_birds] + [(bf, "butterfly") for bf in unready_butterflies]

    print(f"Starting OpenRouter batch generation for {len(targets)} species...")
    success_count = 0
    for idx, (item, group) in enumerate(targets, 1):
        print(f"\n[{idx}/{len(targets)}] Processing [{group.upper()}] {item['commonNameEn']} ({item['sciName']}):")
        ok = generate_plate_openrouter(item, group, key)
        if ok:
            success_count += 1
            # Recalculate stats and save progress
            data["stats"]["readyBirds"] = sum(1 for b in data["birds"] if b.get("plateReady"))
            data["stats"]["readyButterflies"] = sum(1 for b in data["butterflies"] if b.get("plateReady"))
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        time.sleep(2)  # courteous delay

    end_credits = get_openrouter_credits(key)
    print("\n==========================================")
    print(f"OpenRouter 10-Plate Batch Complete! {success_count}/{len(targets)} generated successfully.")
    print(f"Total Ready Birds: {data['stats']['readyBirds']}/50")
    print(f"Total Ready Butterflies: {data['stats']['readyButterflies']}/50")
    print(f"Total Ready Collection: {data['stats']['readyBirds'] + data['stats']['readyButterflies']}/100")
    
    if end_credits:
        used_now = float(end_credits.get('total_usage', 0))
        used_diff = used_now - float(init_credits.get('total_usage', 0))
        rem_after = float(end_credits.get('total_credits', 0)) - used_now
        print(f"\nOpenRouter Usage Summary:")
        print(f"  Cost for this batch: ${used_diff:.4f} USD")
        print(f"  Remaining Balance:   ${rem_after:.4f} USD")
    print("==========================================")

if __name__ == "__main__":
    main()
