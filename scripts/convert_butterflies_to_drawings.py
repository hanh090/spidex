#!/usr/bin/env python3
"""
Convert butterfly observation photos into high-quality scientific specimen drawings using Google Gemini 2.5 Flash Image.
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
DATA_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
PACK_IMG_PUB = os.path.join(PROJECT_ROOT, "public/packs/butterfly-vn/img")
PACK_IMG_DIST = os.path.join(PROJECT_ROOT, "dist/packs/butterfly-vn/img")

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
    "CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, "
    "NO contact shadow, NO dark halo beneath wings or body. The parchment background around the butterfly "
    "must be completely flat, empty, and uniformly solid warm off-white antique paper. "
    "Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. Single centered butterfly specimen only."
)

def build_butterfly_prompt(sci_name, common_en, common_vi, field_marks):
    prompt = (
        f"A masterwork scientific natural history field guide specimen plate of the {common_en} butterfly ({sci_name} / {common_vi}). "
        f"Centered dorsal view with symmetrical fully spread open wings displaying complete anatomical wing venation and intricate scale patterns. "
        f"Distinctive markings: {field_marks}. "
        f"Large, prominent specimen occupying 80% to 85% of the frame with generous natural wingspan, centered on a pure solid flat blank off-white museum parchment background. "
        f"Drawn in authentic 19th-century scientific watercolor and fine ink illustration aesthetic with crisp lines and vivid natural colors. "
        f"Accurate biological proportions faithfully derived from the reference photograph. "
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
    
    spec_path = os.path.join(SPECIMENS_DIR, f"butterfly_{slug}_plate.jpg")
    pub_pack_path = os.path.join(PACK_IMG_PUB, f"butterfly-{slug}.jpg")
    dist_pack_path = os.path.join(PACK_IMG_DIST, f"butterfly-{slug}.jpg")
    
    os.makedirs(SPECIMENS_DIR, exist_ok=True)
    os.makedirs(PACK_IMG_PUB, exist_ok=True)
    os.makedirs(PACK_IMG_DIST, exist_ok=True)
    
    final_im.save(spec_path, format="JPEG", quality=95)
    final_im.save(pub_pack_path, format="JPEG", quality=95)
    final_im.save(dist_pack_path, format="JPEG", quality=95)
    
    return spec_path

def main():
    parser = argparse.ArgumentParser(description="Convert butterfly photos into scientific specimen drawings using Gemini 2.5 Flash.")
    parser.add_argument("--limit", type=int, default=10, help="Number of butterflies to draw (default: 10).")
    parser.add_argument("--all", action="store_true", help="Redraw all butterflies in dataset.")
    parser.add_argument("--slugs", type=str, default="", help="Comma-separated list of butterfly slugs to redraw specifically.")
    args = parser.parse_args()

    key = get_gemini_key()
    if not key:
        print("ERROR: Gemini API key not found!")
        sys.exit(1)
    
    print(f"Using Gemini API Key: {key[:6]}...{key[-4:]}")

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    butterflies = data["butterflies"]
    target_slugs = [s.strip() for s in args.slugs.split(",") if s.strip()] if args.slugs else []

    OLD_GPT5_BF = {
        "butterfly-butterfly_lexias_pardalis",
        "butterfly-butterfly_junonia_orithya",
        "butterfly-butterfly_penthema_darlisa",
        "butterfly-butterfly_junonia_hierta",
        "butterfly-butterfly_papilio_memnon",
        "butterfly-butterfly_papilio_demoleus",
        "butterfly-butterfly_papilio_paris",
        "butterfly-butterfly_troides_aeacus",
        "butterfly-butterfly_hebomoia_glaucippe",
        "butterfly-butterfly_appias_albina",
    }

    candidates = []
    for bf in butterflies:
        slug = bf["id"].replace("butterfly-", "").replace("butterfly_", "")
        raw_path = os.path.join(PROJECT_ROOT, "public", bf.get("rawUrl", f"museum_specimens/butterfly_{slug}_raw.jpg"))
        
        if not os.path.exists(raw_path):
            raw_path = os.path.join(SPECIMENS_DIR, f"butterfly_{slug}_raw.jpg")
            
        if not os.path.exists(raw_path):
            continue
            
        is_target = slug in target_slugs if target_slugs else (not bf.get("plateReady") or args.all)
        if is_target:
            candidates.append({
                "id": bf["id"],
                "sciName": bf["sciName"],
                "commonNameEn": bf["commonNameEn"],
                "commonNameVi": bf["commonNameVi"],
                "fieldMarks": bf.get("fieldMarks", ""),
                "slug": slug,
                "rawPath": raw_path
            })

    if target_slugs and args.limit == 10:
        pass
    elif args.limit > 0:
        candidates = candidates[:args.limit]

    print(f"\nProcessing {len(candidates)} butterfly specimens with Gemini 2.5 Flash Image...\n", flush=True)

    success_count = 0
    t0 = time.time()

    for i, item in enumerate(candidates, 1):
        sci = item["sciName"]
        en = item["commonNameEn"]
        vi = item["commonNameVi"]
        slug = item["slug"]
        raw = item["rawPath"]
        
        print(f"[{i}/{len(candidates)}] Drawing: {sci} ({en} / {vi}) [slug: {slug}]...", flush=True)
        prompt = build_butterfly_prompt(sci, en, vi, item["fieldMarks"])
        
        call_start = time.time()
        try:
            img_bytes = call_gemini(key, prompt, raw)
            elapsed = time.time() - call_start
            if img_bytes:
                saved = save_standard_plate(img_bytes, slug)
                success_count += 1
                print(f"  ✓ Saved 1024x1024 plate to {saved} ({len(img_bytes)} B from Gemini in {elapsed:.1f}s)", flush=True)
                
                for bf in butterflies:
                    if bf["id"] == item["id"]:
                        bf["plateReady"] = True
                        bf["plateUrl"] = f"museum_specimens/butterfly_{slug}_plate.jpg"
                        bf["modelEngine"] = "gemini-flash"
                        break
                
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            else:
                print(f"  ✗ No image bytes returned by Gemini for {sci}", flush=True)
        except Exception as e:
            print(f"  ✗ Error calling Gemini: {e}", flush=True)
        
        time.sleep(2.0)

    total_time = time.time() - t0
    print(f"\n==========================================")
    print(f"Completed batch of {success_count}/{len(candidates)} butterflies in {total_time:.1f}s!")

if __name__ == "__main__":
    main()
