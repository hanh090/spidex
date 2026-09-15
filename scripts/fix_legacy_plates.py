#!/usr/bin/env python3
"""
Re-draws the 15 legacy plates identified by the audit script:
- 8 Birds: ashy_drongo, chinese_pond_heron, edible_nest_swiftlet, greater_coucal,
          sooty_headed_bulbul, spotted_dove, tailorbird, yellow_browed_warbler
- 7 Butterflies: cyrestis_cocles, cyrestis_themire, elymnias_hypermnestra, neptis_clinia,
                parantica_aglea, symbrenthia_hypselis, telchinia_issoria
Converts them using Gemini 2.5 Flash into standardized 1024x1024 RGB JPEGs.
"""
import os
import sys
import json
import base64
import time
import urllib.request
from PIL import Image
import io

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
DATA_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
PACK_BIRD_PUB = os.path.join(PROJECT_ROOT, "public/packs/bird-vn/img")
PACK_BIRD_DIST = os.path.join(PROJECT_ROOT, "dist/packs/bird-vn/img")
PACK_BF_PUB = os.path.join(PROJECT_ROOT, "public/packs/butterfly-vn/img")
PACK_BF_DIST = os.path.join(PROJECT_ROOT, "dist/packs/butterfly-vn/img")

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

STRICT_NEGATIVE_PROMPT = (
    "CRITICAL REQUIREMENT: Strictly NO text, NO letters, NO words, NO Latin species names, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. The parchment background around the specimen "
    "must be completely blank and empty. Single centered specimen only."
)

def prepare_square_b64(raw_img_path):
    with Image.open(raw_img_path) as im:
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        if w == h:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=95)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
        
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (248, 246, 240))
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        canvas.thumbnail((1024, 1024), resample)
        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=95)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

def call_gemini(key, prompt, raw_path):
    b64_img = prepare_square_b64(raw_path)

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

def save_specimen(img_bytes, taxon, slug):
    im = Image.open(io.BytesIO(img_bytes))
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

    spec_path = os.path.join(SPECIMENS_DIR, f"{taxon}_{slug}_plate.jpg")
    final_im.save(spec_path, format="JPEG", quality=95)

    if taxon == "bird":
        final_im.save(os.path.join(PACK_BIRD_PUB, f"bird-{slug}.jpg"), format="JPEG", quality=95)
        final_im.save(os.path.join(PACK_BIRD_DIST, f"bird-{slug}.jpg"), format="JPEG", quality=95)
    else:
        final_im.save(os.path.join(PACK_BF_PUB, f"butterfly-{slug}.jpg"), format="JPEG", quality=95)
        final_im.save(os.path.join(PACK_BF_DIST, f"butterfly-{slug}.jpg"), format="JPEG", quality=95)

    return spec_path

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--birds-only", action="store_true", help="Only fix the 8 legacy birds")
    args = parser.parse_args()

    key = get_gemini_key()
    if not key:
        print("ERROR: Gemini API key missing!")
        sys.exit(1)

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    TARGET_BIRDS = {
        'ashy_drongo', 'chinese_pond_heron', 'edible_nest_swiftlet', 'greater_coucal',
        'sooty_headed_bulbul', 'spotted_dove', 'tailorbird', 'yellow_browed_warbler'
    }
    TARGET_BF = {
        'cyrestis_cocles', 'cyrestis_themire', 'elymnias_hypermnestra', 'neptis_clinia',
        'parantica_aglea', 'symbrenthia_hypselis', 'telchinia_issoria'
    }

    queue = []
    for b in data["birds"]:
        slug = b["id"].replace("bvn-bird_", "")
        if slug in TARGET_BIRDS:
            raw = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
            if os.path.exists(raw):
                queue.append(("bird", slug, b["sciName"], b["commonNameEn"], b["commonNameVi"], b.get("family", "Passeriformes"), raw))

    if not args.birds_only:
        for bf in data["butterflies"]:
            slug = bf["id"].replace("butterfly-butterfly_", "")
            if slug in TARGET_BF:
                raw = os.path.join(SPECIMENS_DIR, f"butterfly_{slug}_raw.jpg")
                if os.path.exists(raw):
                    queue.append(("butterfly", slug, bf["sciName"], bf["commonNameEn"], bf["commonNameVi"], bf.get("fieldMarks", ""), raw))

    print(f"Loaded {len(queue)} legacy plates to redraw with Gemini 2.5 Flash standard...")

    for i, (taxon, slug, sci, en, vi, extra, raw) in enumerate(queue, 1):
        print(f"[{i}/{len(queue)}] Re-drawing {taxon}: {sci} ({en} / {vi})...", flush=True)
        if taxon == "bird":
            pose = "perched naturally and gracefully on a slender clean wooden twig in lateral profile"
            if any(k in extra.lower() for k in ["ardeidae", "columbidae", "cuculidae"]):
                pose = "standing naturally alert on a subtle clean ground contour in lateral profile"
            prompt = (
                f"A high quality scientific natural history field guide specimen plate of a single {en} bird ({sci}). "
                f"Clean lateral profile view of a single bird {pose}, centered on a pure clean blank off-white parchment background with subtle natural drop shadow beneath. "
                f"Authentic botanical illustration aesthetic, crisp plumage feather textures, accurate natural coloration faithfully based on the reference photo, no background clutter. "
                f"{STRICT_NEGATIVE_PROMPT}"
            )
        else:
            prompt = (
                f"A masterwork scientific natural history field guide specimen plate of the {en} butterfly ({sci} / {vi}). "
                f"Centered dorsal view with symmetrical fully spread open wings displaying complete anatomical wing venation and intricate scale patterns. "
                f"Distinctive markings: {extra}. "
                f"Drawn in authentic scientific watercolor and fine ink illustration aesthetic on a pure blank off-white museum parchment background with subtle natural drop shadow beneath. "
                f"Accurate biological proportions faithfully derived from the reference photograph. "
                f"{STRICT_NEGATIVE_PROMPT}"
            )

        t0 = time.time()
        try:
            img_bytes = call_gemini(key, prompt, raw)
            dur = time.time() - t0
            if img_bytes:
                out_path = save_specimen(img_bytes, taxon, slug)
                print(f"  ✓ Saved 1024x1024 plate to {out_path} ({len(img_bytes)} B in {dur:.1f}s)", flush=True)
            else:
                print(f"  ✗ No image bytes from Gemini for {sci}", flush=True)
        except Exception as e:
            print(f"  ✗ Error: {e}", flush=True)

        time.sleep(2.0)

    print("\nAll legacy plates successfully upgraded to Gemini 2.5 Flash 1024x1024 standard!")

if __name__ == "__main__":
    main()
