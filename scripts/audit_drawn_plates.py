#!/usr/bin/env python3
"""
Audits all drawn specimen plates in public/museum_specimens:
- Verifies image integrity (valid JPEG, no corruption)
- Verifies resolution (1024x1024 standard)
- Checks parchment background consistency (off-white border sampling)
- Matches against Master Checklists and production game packs.
"""
import os
import glob
import json
from PIL import Image

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
CHECKLIST_FILE = os.path.join(PROJECT_ROOT, "data/checklists/vietnam_birds_master_checklist.json")
V50_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")

def check_image(path):
    issues = []
    try:
        size = os.path.getsize(path)
        if size < 50000:
            issues.append(f"Suspiciously small file size: {size} bytes")

        with Image.open(path) as im:
            if im.format != "JPEG":
                issues.append(f"Invalid format: {im.format} (expected JPEG)")
            if im.size != (1024, 1024):
                issues.append(f"Non-standard dimensions: {im.size} (expected 1024x1024)")
            
            # Sample border pixels (corners and edges) to verify clean background
            corners = [
                im.getpixel((20, 20)),
                im.getpixel((1004, 20)),
                im.getpixel((20, 1004)),
                im.getpixel((1004, 1004)),
                im.getpixel((512, 20)),
                im.getpixel((512, 1004))
            ]
            for c in corners:
                r, g, b = c[:3]
                # Off-white / light parchment should have high luminance and low saturation
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                if lum < 180:
                    issues.append(f"Border pixel too dark (lum={lum:.1f}, rgb={c[:3]}), might have background artifact")
                    break
    except Exception as e:
        issues.append(f"Corrupted or unreadable image: {str(e)}")

    return issues

def main():
    bird_plates = sorted(glob.glob(os.path.join(SPECIMENS_DIR, "bird_*_plate.jpg")))
    bf_plates = sorted(glob.glob(os.path.join(SPECIMENS_DIR, "butterfly_*_plate.jpg")))
    
    print("=" * 60)
    print("🔬 AUDIT REPORT: SPIDEX NATURAL HISTORY SPECIMEN PLATES")
    print(f"Total Bird Plates Found:      {len(bird_plates)}")
    print(f"Total Butterfly Plates Found: {len(bf_plates)}")
    print(f"Total Specimen Plates:        {len(bird_plates) + len(bf_plates)}")
    print("=" * 60)

    failed_birds = 0
    for p in bird_plates:
        issues = check_image(p)
        name = os.path.basename(p)
        if issues:
            failed_birds += 1
            print(f"  ❌ {name}: {', '.join(issues)}")

    failed_bf = 0
    for p in bf_plates:
        issues = check_image(p)
        name = os.path.basename(p)
        if issues:
            failed_bf += 1
            print(f"  ❌ {name}: {', '.join(issues)}")

    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
        master = json.load(f)["species"]
    
    with open(V50_FILE, "r", encoding="utf-8") as f:
        v50 = json.load(f)

    master_drawn = sum(1 for s in master if s.get("hasMuseumPlate"))
    v50_birds_ready = sum(1 for b in v50["birds"] if b.get("plateReady"))
    v50_bf_ready = sum(1 for bf in v50["butterflies"] if bf.get("plateReady"))

    print("\n--- Integrity Results ---")
    print(f"Bird Plates Passed:      {len(bird_plates) - failed_birds} / {len(bird_plates)} ({failed_birds} issues)")
    print(f"Butterfly Plates Passed: {len(bf_plates) - failed_bf} / {len(bf_plates)} ({failed_bf} issues)")
    print(f"V50 Curated Birds:       {v50_birds_ready} / 50 ({(v50_birds_ready/50)*100:.0f}%)")
    print(f"V50 Curated Butterflies: {v50_bf_ready} / 50 ({(v50_bf_ready/50)*100:.0f}%)")
    print(f"Master Birds Checklist:  {len(bird_plates)} / {len(master)} ({(len(bird_plates)/len(master))*100:.1f}%)")
    print("=" * 60)

if __name__ == "__main__":
    main()
