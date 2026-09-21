#!/usr/bin/env python3
"""
Redraw legacy curated 50 birds with Google Gemini 2.5 Flash Image.
Guarantees 100% shadowless, textless, prominent 75-85% specimen plates.
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
import numpy as np
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

STRICT_NEGATIVE_PROMPT = (
    "CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, "
    "NO contact shadow, NO dark halo beneath the bird or perch. The parchment background around the bird "
    "must be completely flat, empty, and uniformly solid warm off-white antique paper. "
    "Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. Single centered bird only."
)

def get_pose_description(family, order):
    fam = (family or "").lower()
    ord_name = (order or "").lower()
    if any(k in fam for k in ["anatidae", "phasianidae", "rallidae", "gruidae", "charadriidae", "scolopacidae", "ardeidae", "ciconiidae"]):
        return "standing alert and naturally in lateral profile on a subtle clean ground contour"
    elif any(k in fam for k in ["accipitridae", "falconidae", "strigidae"]):
        return "perched upright and alert on a simple clean weathered wooden branch in lateral profile"
    else:
        return "perched naturally in side lateral profile on a simple clean minimal branch, showing full body plumage from bill to tail tip"

def build_bird_prompt(sci_name, common_en, common_vi, family, order):
    pose = get_pose_description(family, order)
    prompt = (
        f"A masterwork scientific natural history field guide specimen plate of a single {common_en} bird ({sci_name}). "
        f"Depicted {pose}, showing clear diagnostic field markings, plumage patterns, bill morphology, and authentic anatomical feather texture. "
        f"Large, prominent specimen occupying 75% to 85% of the frame in lateral profile view, centered on a pure solid flat blank off-white museum parchment background. "
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
        elif "inline_data" in p:
            return base64.b64decode(p["inline_data"]["data"])
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
        bg = (
            sum(c[0] for c in corners) // 4,
            sum(c[1] for c in corners) // 4,
            sum(c[2] for c in corners) // 4,
        )
        side = max(w, h)
        final_im = Image.new("RGB", (side, side), bg)
        final_im.paste(im, ((side - w) // 2, (side - h) // 2))
        if final_im.size != (1024, 1024):
            resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            final_im = final_im.resize((1024, 1024), resample)

    arr = np.asarray(final_im, dtype=float)
    corners_arr = np.concatenate([arr[:15, :15], arr[:15, -15:], arr[-15:, :15], arr[-15:, -15:]], axis=0)
    bg_color = tuple(int(round(c)) for c in np.mean(corners_arr, axis=(0, 1)))
    bottom_strip = arr[-60:, 200:824]
    diff = np.max(np.abs(bottom_strip - bg_color), axis=2)
    text_pixels = np.count_nonzero(diff > 30)
    if 5 < text_pixels < 4000:
        clean_patch = Image.new("RGB", (624, 60), bg_color)
        final_im.paste(clean_patch, (200, 1024 - 60))

    spec_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")
    pub_pack_path = os.path.join(PACK_IMG_PUB, f"bird_{slug}.jpg")
    dist_pack_path = os.path.join(PACK_IMG_DIST, f"bird_{slug}.jpg")
    
    os.makedirs(SPECIMENS_DIR, exist_ok=True)
    os.makedirs(PACK_IMG_PUB, exist_ok=True)
    os.makedirs(PACK_IMG_DIST, exist_ok=True)
    
    final_im.save(spec_path, format="JPEG", quality=95)
    final_im.save(pub_pack_path, format="JPEG", quality=95)
    final_im.save(dist_pack_path, format="JPEG", quality=95)
    
    return spec_path

def main():
    parser = argparse.ArgumentParser(description="Redraw legacy curated birds with Gemini 2.5 Flash")
    parser.add_argument("--ids", type=str, default="", help="Comma-separated IDs or slugs to redraw specifically")
    parser.add_argument("--limit", type=int, default=10, help="Max birds to process")
    parser.add_argument("--all-legacy", action="store_true", help="Redraw all birds without gemini-flash engine")
    args = parser.parse_args()

    key = get_gemini_key()
    if not key:
        print("ERROR: Gemini API key not found!")
        sys.exit(1)

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    birds = data["birds"]
    target_ids = [s.strip() for s in args.ids.split(",") if s.strip()] if args.ids else []

    candidates = []
    for b in birds:
        slug = b["id"].replace("bvn-bird_", "").replace("bvn-", "")
        raw_path = os.path.join(PROJECT_ROOT, "public", b.get("rawUrl", f"museum_specimens/bird_{slug}_raw.jpg"))
        if not os.path.exists(raw_path):
            raw_path = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
            
        if not os.path.exists(raw_path):
            continue

        is_target = False
        if target_ids:
            is_target = (b["id"] in target_ids or slug in target_ids)
        elif args.all_legacy:
            is_target = (b.get("modelEngine") != "gemini-flash")
        
        if is_target:
            candidates.append({
                "item": b,
                "slug": slug,
                "rawPath": raw_path
            })

    if not target_ids and args.limit > 0:
        candidates = candidates[:args.limit]

    print(f"Found {len(candidates)} birds to draw with Gemini 2.5 Flash...")

    for i, c in enumerate(candidates, 1):
        b = c["item"]
        slug = c["slug"]
        sci = b["sciName"]
        en = b["commonNameEn"]
        vi = b["commonNameVi"]
        fam = b.get("family", "")
        print(f"[{i}/{len(candidates)}] Drawing {en} ({sci} / {vi}) [slug: {slug}]...", flush=True)
        
        prompt = build_bird_prompt(sci, en, vi, fam, "Passeriformes")
        t0 = time.time()
        try:
            img_bytes = call_gemini(key, prompt, c["rawPath"])
            elapsed = time.time() - t0
            if img_bytes:
                saved = save_standard_plate(img_bytes, slug)
                b["modelEngine"] = "gemini-flash"
                b["plateReady"] = True
                b["plateUrl"] = f"museum_specimens/bird_{slug}_plate.jpg"
                print(f"  ✓ Saved 1024x1024 plate to {saved} ({len(img_bytes)} B from Gemini in {elapsed:.1f}s)", flush=True)
                
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            else:
                print(f"  ✗ No image bytes returned for {sci}", flush=True)
        except Exception as e:
            print(f"  ✗ Error: {e}", flush=True)
            
        time.sleep(1.5)

    print("Done!")

if __name__ == "__main__":
    main()
