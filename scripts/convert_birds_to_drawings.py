#!/usr/bin/env python3
"""
Convert real bird observation photos into high-quality scientific specimen drawings using Google Gemini 2.5 Flash Image.
Follows the Spidex Natural History botanical illustration aesthetic on solid blank off-white museum parchment.
Strictly NO text, NO labels, NO pins, NO borders.
"""
import os
import sys
import json
import base64
import time
import re
import argparse
import urllib.request
import urllib.error
from PIL import Image
import io

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
CHECKLIST_FILE = os.path.join(PROJECT_ROOT, "data/checklists/vietnam_birds_master_checklist.json")
V50_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")
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

def slugify(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')

STRICT_NEGATIVE_PROMPT = (
    "CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, "
    "NO contact shadow, NO dark halo beneath the bird or perch. The parchment background around the bird "
    "must be completely flat, empty, and uniformly solid warm off-white antique paper. "
    "Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. Single centered bird only."
)

def get_pose_description(family, order):
    fam = family.lower()
    ord_name = order.lower()
    if any(k in fam for k in ["anatidae", "phasianidae", "rallidae", "gruidae", "charadriidae", "scolopacidae", "ardeidae", "ciconiidae", "burhinidae", "glareolidae", "jacanidae", "turnicidae"]) or \
       any(k in ord_name for k in ["anseriformes", "galliformes", "gruiformes", "charadriiformes", "ciconiiformes"]):
        return "standing alert and naturally in lateral profile on a subtle clean ground contour"
    elif any(k in fam for k in ["podicipedidae", "anhingidae", "phalacrocoracidae"]):
        return "standing alert on a clean riverbank rock or low perch in lateral profile"
    elif any(k in fam for k in ["accipitridae", "falconidae", "strigidae", "tytonidae", "pandionidae"]):
        return "perched upright and alert on a sturdy weathered tree branch in lateral profile"
    else:
        return "perched naturally and gracefully on a slender clean wooden twig in lateral profile"

def build_prompt(sci_name, common_en, common_vi, family, order):
    pose = get_pose_description(family, order)
    prompt = (
        f"A high quality scientific natural history field guide specimen plate of a single {common_en} bird ({sci_name}). "
        f"Large, prominent specimen occupying 75% to 85% of the frame. Clean lateral profile view of a single bird {pose}, centered on a pure solid flat blank off-white museum parchment background. "
        f"Authentic botanical illustration aesthetic, crisp plumage feather textures, accurate natural coloration and morphology faithfully based on the reference photo, no background clutter. "
        f"{STRICT_NEGATIVE_PROMPT}"
    )
    return prompt

def prepare_square_b64(raw_img_path):
    with Image.open(raw_img_path) as im:
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        if w == h:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=95)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
        
        # Use standard off-white museum parchment for padding canvas
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (248, 246, 240))
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        canvas.thumbnail((1024, 1024), resample)
        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=95)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

def call_gemini(key, prompt, raw_img_path):
    b64_img = prepare_square_b64(raw_img_path)

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

def save_standard_plate(raw_bytes, slug):
    im = Image.open(io.BytesIO(raw_bytes))
    if im.mode != "RGB":
        im = im.convert("RGB")
    
    if im.size == (1024, 1024):
        final_im = im
    else:
        w, h = im.size
        corners = [
            im.getpixel((5, 5)),
            im.getpixel((w - 6, 5)),
            im.getpixel((5, h - 6)),
            im.getpixel((w - 6, h - 6))
        ]
        bg_color = (
            sum(c[0] for c in corners) // 4,
            sum(c[1] for c in corners) // 4,
            sum(c[2] for c in corners) // 4
        )
        resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        im.thumbnail((1024, 1024), resample)
        final_im = Image.new("RGB", (1024, 1024), bg_color)
        final_im.paste(im, ((1024 - im.width) // 2, (1024 - im.height) // 2))
    
    spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")
    pub_pack_path = os.path.join(PACK_IMG_PUB, f"bird-{slug}.jpg")
    dist_pack_path = os.path.join(PACK_IMG_DIST, f"bird-{slug}.jpg")
    
    os.makedirs(SPECIMENS_DIR, exist_ok=True)
    os.makedirs(PACK_IMG_PUB, exist_ok=True)
    os.makedirs(PACK_IMG_DIST, exist_ok=True)
    
    final_im.save(spec_path, format="JPEG", quality=95)
    final_im.save(pub_pack_path, format="JPEG", quality=95)
    final_im.save(dist_pack_path, format="JPEG", quality=95)
    
    return spec_path

def is_valid_standard_plate(path):
    if not os.path.exists(path) or os.path.getsize(path) < 10000:
        return False
    try:
        with Image.open(path) as im:
            return im.format == "JPEG" and im.size == (1024, 1024)
    except Exception:
        return False

def main():
    parser = argparse.ArgumentParser(description="Convert real bird photos into scientific specimen drawings using Gemini 2.5 Flash.")
    parser.add_argument("--limit", type=int, default=20, help="Number of birds to draw in this run (default: 20, use 0 for all).")
    parser.add_argument("--redraw-gpt5", action="store_true", help="Also redraw the 10 birds previously generated with gpt-5-mini.")
    args = parser.parse_args()

    key = get_gemini_key()
    if not key:
        print("ERROR: Gemini API key not found in env or gabo .env files!")
        sys.exit(1)
    
    print(f"Using Gemini API Key: {key[:6]}...{key[-4:]}")

    # Load master checklist
    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
        master_data = json.load(f)
    species_list = master_data["species"]

    # Load V50
    with open(V50_FILE, "r", encoding="utf-8") as f:
        v50_data = json.load(f)

    # 1. Check if user wants to replace GPT-5-mini birds
    gpt5_birds_to_redraw = []
    if args.redraw_gpt5:
        GPT5_BIRD_IDS = {
            "bvn-bird_white_eye", "bvn-bird_white_wagtail", "bvn-bird_black_naped_oriole",
            "bvn-bird_golden_fronted_leafbird", "bvn-bird_fork_tailed_sunbird",
            "bvn-bird_blue_tailed_bee_eater", "bvn-bird_scarlet_backed_flowerpecker",
            "bvn-bird_yellow_bellied_prinia", "bvn-bird_white_shouldered_starling",
            "bvn-bird_crested_kingfisher"
        }
        for b in v50_data["birds"]:
            if b["id"] in GPT5_BIRD_IDS:
                slug = b["id"].replace("bvn-bird_", "")
                raw_path = os.path.join(PROJECT_ROOT, "public", b["rawUrl"])
                if os.path.exists(raw_path):
                    gpt5_birds_to_redraw.append({
                        "id": b["id"],
                        "sciName": b["sciName"],
                        "commonNameEn": b["commonNameEn"],
                        "commonNameVi": b["commonNameVi"],
                        "family": b.get("family", ""),
                        "order": "Passeriformes",
                        "slug": slug,
                        "rawPath": raw_path,
                        "is_v50": True
                    })
        print(f"Found {len(gpt5_birds_to_redraw)} gpt-5-mini birds to re-draw with Gemini.")

    # 2. Find master checklist species that have raw photos but no plate yet
    checklist_candidates = []
    for sp in species_list:
        sci = sp["sciName"].strip()
        slug = slugify(sci)
        plate_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")
        
        # Check if raw photo exists
        raw_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
        if not os.path.exists(raw_path) and sp.get("referencePhotoUrl"):
            alt_raw = os.path.join(PROJECT_ROOT, "public", sp["referencePhotoUrl"])
            if os.path.exists(alt_raw):
                raw_path = alt_raw
                
        if os.path.exists(raw_path) and not is_valid_standard_plate(plate_path):
            checklist_candidates.append({
                "index": sp["index"],
                "sciName": sci,
                "commonNameEn": sp["commonNameEn"],
                "commonNameVi": sp["commonNameVi"],
                "family": sp.get("family", ""),
                "order": sp.get("order", "Aves"),
                "slug": slug,
                "rawPath": raw_path,
                "is_v50": False
            })

    print(f"Found {len(checklist_candidates)} master species with real photos ready for drawing.")
    
    # Assemble queue
    queue = gpt5_birds_to_redraw + checklist_candidates
    if args.limit > 0:
        queue = queue[:args.limit]
    
    print(f"\nProcessing queue of {len(queue)} species with Gemini 2.5 Flash Image...\n", flush=True)

    success_count = 0
    t0 = time.time()

    for i, item in enumerate(queue, 1):
        sci = item["sciName"]
        en = item["commonNameEn"]
        vi = item["commonNameVi"]
        slug = item["slug"]
        raw = item["rawPath"]
        
        print(f"[{i}/{len(queue)}] Drawing: {sci} ({en} / {vi}) [slug: {slug}]...", flush=True)
        prompt = build_prompt(sci, en, vi, item["family"], item["order"])
        
        call_start = time.time()
        try:
            img_bytes = call_gemini(key, prompt, raw)
            elapsed = time.time() - call_start
            if img_bytes:
                saved = save_standard_plate(img_bytes, slug)
                success_count += 1
                print(f"  ✓ Saved 1024x1024 plate to {saved} ({len(img_bytes)} B from Gemini in {elapsed:.1f}s)", flush=True)
                
                # Save progress after each successful drawing atomically
                try:
                    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
                        cdata = json.load(f)
                    for sp in cdata["species"]:
                        if sp["sciName"].strip().lower() == sci.lower():
                            sp["hasMuseumPlate"] = True
                            sp["museumPlateUrl"] = f"museum_specimens/bird_{slug}_plate.jpg"
                            break
                    ctmp = CHECKLIST_FILE + f".tmp_draw_{slug}"
                    with open(ctmp, "w", encoding="utf-8") as f:
                        json.dump(cdata, f, indent=2, ensure_ascii=False)
                    os.replace(ctmp, CHECKLIST_FILE)
                except Exception as ex:
                    print(f"  Warning: Checklist save error for {sci}: {ex}")

                try:
                    with open(V50_FILE, "r", encoding="utf-8") as f:
                        vdata = json.load(f)
                    for vb in vdata["birds"]:
                        if vb["sciName"].strip().lower() == sci.lower() or vb.get("id") == item.get("id"):
                            vb["plateReady"] = True
                            vb["plateUrl"] = f"museum_specimens/bird_{slug}_plate.jpg"
                            vb["modelEngine"] = "gemini-flash"
                            break
                    vtmp = V50_FILE + f".tmp_draw_{slug}"
                    with open(vtmp, "w", encoding="utf-8") as f:
                        json.dump(vdata, f, indent=2, ensure_ascii=False)
                    os.replace(vtmp, V50_FILE)
                except Exception as ex:
                    print(f"  Warning: V50 save error for {sci}: {ex}")
            else:
                print(f"  ✗ No image bytes returned by Gemini for {sci}", flush=True)
        except Exception as e:
            print(f"  ✗ Error calling Gemini: {e}", flush=True)
        
        # Polite rate limit: 2 seconds between calls
        time.sleep(2.0)

    total_time = time.time() - t0
    print(f"\n==========================================")
    print(f"Completed batch of {success_count}/{len(queue)} species in {total_time:.1f}s!")
    print(f"Updated checklist and master datasets.")

if __name__ == "__main__":
    main()
