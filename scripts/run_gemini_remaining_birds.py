#!/usr/bin/env python3
"""
Generate the remaining 12 bird specimen plates using Google Gemini (gemini-2.5-flash-image).
Completes the Vietnam 50 Birds master checklist to 100% (50/50).
"""
import os
import sys
import json
import base64
import time
import urllib.request
import urllib.error
from PIL import Image
import io

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
DATA_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
PACK_IMG_PUB = os.path.join(PROJECT_ROOT, "public/packs/bird-vn/img")
PACK_IMG_DIST = os.path.join(PROJECT_ROOT, "dist/packs/bird-vn/img")

def get_gemini_key():
    env_paths = [
        "/Users/hanhle/projects/gabo/flexlane-api/.env.dev",
        "/Users/hanhle/projects/personal-stuff/vinanonwoven/.claude/.env",
        "/Users/hanhle/projects/gabo/flexlane-api-main/.env.dev"
    ]
    for p in env_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("GEMINI_API_KEY="):
                        return line.split("=", 1)[1].strip().strip("\"'")
    return os.environ.get("GEMINI_API_KEY")

NEGATIVE_PROMPT = (
    "CRITICAL REQUIREMENT: Strictly NO text, NO letters, NO words, NO Latin species names, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. The parchment background around the bird "
    "must be completely blank and empty. Single centered bird only."
)

SPECIES_PROMPTS = {
    "pied_hornbill": (
        "A high quality scientific natural history field guide specimen plate of a single Oriental Pied-Hornbill bird (Anthracoceros albirostris). "
        "Clean lateral profile view of a single bird perched naturally on a simple weathered branch, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Large ivory-yellow casque and bill with black base, mostly black body with white belly and white trailing edges to wings. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "fairy_pitta": (
        "A high quality scientific natural history field guide specimen plate of a single Fairy Pitta bird (Pitta nympha). "
        "Clean lateral profile view of a single plump jewel-toned bird perched alertly on a low mossy tree root, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Vivid emerald-green back, brilliant cobalt-blue rump, black crown with broad chestnut-buff superciliary stripes, creamy buff breast and flanks, and striking bright scarlet-red lower belly and vent. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "red_junglefowl": (
        "A high quality scientific natural history field guide specimen plate of a single male Red Junglefowl (Gallus gallus). "
        "Full lateral profile view of a majestic wild rooster standing naturally on a subtle clean ground contour, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Bright red fleshy serrated crown comb and throat wattles, brilliant golden-orange lanceolate neck hackles, iridescent greenish-black arched sickle tail feathers, and dark slate legs. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "white_breasted_waterhen": (
        "A high quality scientific natural history field guide specimen plate of a single White-breasted Waterhen bird (Amaurornis phoenicurus). "
        "Lateral profile view of a single bird standing naturally on long greenish-yellow legs on a subtle clean ground contour, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Striking clean white face, throat, and breast contrasting sharply with dark slate-grey upperparts, wings, and crown; rich warm rufous-cinnamon undertail coverts, greenish bill with a small red spot at the base. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "grey_heron": (
        "A high quality scientific natural history field guide specimen plate of a single Grey Heron bird (Ardea cinerea). "
        "Full lateral profile view of a tall elegant wading bird standing alert on long slender legs on a subtle clean ground contour, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Ash-grey back and wings, long curved white neck with double row of black streaks down the front, pure white head with a prominent black superciliary stripe ending in long black crest plumes, powerful dagger-shaped yellowish bill. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "night_heron": (
        "A high quality scientific natural history field guide specimen plate of a single adult Black-crowned Night-Heron bird (Nycticorax nycticorax). "
        "Lateral profile view of a stocky, compact heron perched naturally on a clean low branch, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Glossy black crown and mantle, contrasting pale grey wings, pure white face, throat, and underparts, vivid ruby-red eyes, and 2-3 long slender white ribbon-like breeding plumes extending from the nape. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "cinnamon_bittern": (
        "A high quality scientific natural history field guide specimen plate of a single Cinnamon Bittern bird (Ixobrychus cinnamomeus). "
        "Lateral profile view of a slender bittern standing alert in an upright posture on a subtle clean ground contour or low reed stem, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Rich warm cinnamon-chestnut back and wings, buff-rufous underparts with a median dark streak down the throat and breast, sharp yellow dagger bill, and greenish-yellow legs. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "cattle_egret": (
        "A high quality scientific natural history field guide specimen plate of a single Cattle Egret bird (Bubulcus ibis / Bubulcus coromandus). "
        "Lateral profile view of a compact, stocky egret standing naturally on clean legs on a subtle ground contour, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Mostly snow-white plumage with rich golden-buff wash and breeding plumes on the crown, chest, and mantle; short stout yellow bill, and dark legs. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "pied_fantail": (
        "A high quality scientific natural history field guide specimen plate of a single Malaysian Pied Fantail bird (Rhipidura javanica). "
        "Lateral profile view of an energetic small flycatcher perched on a slender twig, cocking its broad fan-shaped tail upright, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Dark sooty-blackish upperparts, distinctive white supercilium eyebrow stripe, broad black breast-band above clean white belly, and wide fan tail feathers prominently tipped with clean white. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "white_rumped_shama": (
        "A high quality scientific natural history field guide specimen plate of a single male White-rumped Shama bird (Copsychus malabaricus). "
        "Full lateral profile view of an elegant songbird perched alertly on an angled twig, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Glossy iridescent blue-black head, back, and wings; rich deep orange-chestnut underparts; brilliant pure white rump patch; and exceptionally long graduated black tail with white outer feathers. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "plaintive_cuckoo": (
        "A high quality scientific natural history field guide specimen plate of a single adult Plaintive Cuckoo bird (Cacomantis merulinus). "
        "Lateral profile view of a slender cuckoo perched quietly on a thin tree branch, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Soft ash-grey head, neck, and upper breast; warm rufous-orange lower belly and vent; grey-brown back and wings; and dark tail feathers tipped and barred with white. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
    "lesser_coucal": (
        "A high quality scientific natural history field guide specimen plate of a single Lesser Coucal bird (Centropus bengalensis). "
        "Lateral profile view of a handsome cuckoo perched naturally on a weathered twig, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
        "Key diagnostic features: Glossy purplish-black head, neck, and underparts; rich warm chestnut-rufous wings and mantle; long broad black tail with slight green sheen; and a stout curved black bill. "
        "Crisp plumage feather textures, authentic botanical illustration aesthetic, no background clutter. " + NEGATIVE_PROMPT
    ),
}

def call_gemini(key, prompt, raw_img_path):
    with open(raw_img_path, "rb") as f:
        b64_img = base64.b64encode(f.read()).decode("utf-8")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": b64_img
                        }
                    }
                ]
            }
        ]
    }
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers={"Content-Type": "application/json"})
    
    with urllib.request.urlopen(req, timeout=90) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    
    parts = res.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    for p in parts:
        if "inlineData" in p:
            return base64.b64decode(p["inlineData"]["data"])
    return None

def save_as_standard_plate(raw_bytes, slug):
    im = Image.open(io.BytesIO(raw_bytes))
    if im.mode != "RGB":
        im = im.convert("RGB")
    
    im_resized = im.resize((1024, 1024), getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS)
    
    spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")
    pub_pack_path = os.path.join(PACK_IMG_PUB, f"bird-{slug}.jpg")
    dist_pack_path = os.path.join(PACK_IMG_DIST, f"bird-{slug}.jpg")
    
    os.makedirs(SPECIMENS_DIR, exist_ok=True)
    os.makedirs(PACK_IMG_PUB, exist_ok=True)
    os.makedirs(PACK_IMG_DIST, exist_ok=True)
    
    im_resized.save(spec_path, format="JPEG", quality=95)
    im_resized.save(pub_pack_path, format="JPEG", quality=95)
    im_resized.save(dist_pack_path, format="JPEG", quality=95)
    
    print(f"  [SAVED] {spec_path} (1024x1024)")
    print(f"  [SAVED] {pub_pack_path}")
    print(f"  [SAVED] {dist_pack_path}")

def main():
    key = get_gemini_key()
    if not key:
        print("ERROR: Gemini API key not found!")
        sys.exit(1)
    
    print(f"Using Gemini API Key: {key[:6]}...{key[-4:]}")
    
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        master_data = json.load(f)
    
    pending_birds = [b for b in master_data["birds"] if not b.get("plateReady")]
    print(f"Found {len(pending_birds)} pending birds to generate with Gemini.")
    
    success_count = 0
    
    for i, bird in enumerate(pending_birds, 1):
        slug = bird["id"].replace("bvn-bird_", "")
        print(f"\n[{i}/{len(pending_birds)}] Processing {bird['sciName']} ({bird['commonNameEn']}) [slug: {slug}]...")
        
        # Check if already generated in /tmp for hornbill
        if slug == "pied_hornbill" and os.path.exists("/tmp/test_hornbill_gemini.png"):
            print("  Re-using pilot test image from /tmp/test_hornbill_gemini.png...")
            with open("/tmp/test_hornbill_gemini.png", "rb") as f:
                img_bytes = f.read()
            save_as_standard_plate(img_bytes, slug)
            bird["plateReady"] = True
            bird["plateUrl"] = f"museum_specimens/bird_{slug}_plate.jpg"
            success_count += 1
            # Save progress after each item
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(master_data, f, indent=2, ensure_ascii=False)
            continue
            
        raw_path = os.path.join(PROJECT_ROOT, "public", bird["rawUrl"])
        if not os.path.exists(raw_path):
            print(f"  ERROR: Raw file not found: {raw_path}")
            continue
            
        prompt = SPECIES_PROMPTS.get(slug)
        if not prompt:
            print(f"  ERROR: No prompt configured for slug: {slug}")
            continue
            
        print("  Calling Gemini 2.5 Flash Image API...", flush=True)
        t0 = time.time()
        try:
            img_bytes = call_gemini(key, prompt, raw_path)
            elapsed = time.time() - t0
            if img_bytes:
                print(f"  Received {len(img_bytes)} bytes in {elapsed:.1f}s.")
                save_as_standard_plate(img_bytes, slug)
                bird["plateReady"] = True
                bird["plateUrl"] = f"museum_specimens/bird_{slug}_plate.jpg"
                success_count += 1
                # Save progress after each item
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(master_data, f, indent=2, ensure_ascii=False)
            else:
                print("  ERROR: No image bytes returned by Gemini.")
        except Exception as e:
            print(f"  ERROR calling Gemini: {e}")
        
        time.sleep(2.5)
    
    print(f"\nFinished! Total new plates: {success_count}/{len(pending_birds)}")

if __name__ == "__main__":
    main()
