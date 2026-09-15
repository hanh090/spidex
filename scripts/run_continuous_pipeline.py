#!/usr/bin/env python3
"""
Autonomous continuous pipeline for Birds of Vietnam:
1. Downloads real observation photos from iNaturalist & Wikimedia Commons.
2. Converts raw photos into scientific specimen plates using Google Gemini 2.5 Flash Image.
3. Automatically recompiles packs and regenerates museum showcase after each cycle.
Runs continuously until all candidate species in the checklist are fully processed.
"""
import os
import sys
import json
import time
import subprocess
import argparse

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
CHECKLIST_FILE = os.path.join(PROJECT_ROOT, "data/checklists/vietnam_birds_master_checklist.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")

def get_stats():
    with open(CHECKLIST_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    species = data["species"]
    
    has_raw = 0
    has_plate = 0
    
    import re
    def slugify(text):
        return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')
        
    for sp in species:
        sci = sp["sciName"].strip()
        slug = slugify(sci)
        raw_p = os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")
        plate_p = os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")
        
        if os.path.exists(raw_p) and os.path.getsize(raw_p) > 5000:
            has_raw += 1
        if os.path.exists(plate_p) and os.path.getsize(plate_p) > 5000:
            has_plate += 1
            
    return len(species), has_raw, has_plate

def run_cmd(cmd, desc):
    print(f"\n>>> [{time.strftime('%H:%M:%S')}] {desc}...", flush=True)
    ret = subprocess.run(cmd, shell=True, cwd=PROJECT_ROOT)
    return ret.returncode == 0

def main():
    parser = argparse.ArgumentParser(description="Autonomous continuous bird specimen pipeline.")
    parser.add_argument("--download-batch", type=int, default=50, help="Species to download per cycle (default: 50)")
    parser.add_argument("--draw-batch", type=int, default=15, help="Species to draw per cycle (default: 15)")
    parser.add_argument("--max-cycles", type=int, default=0, help="Max cycles to run (default: 0 = continuous until done)")
    parser.add_argument("--skip-download", action="store_true", help="Skip download step")
    args = parser.parse_args()

    total_species, initial_raw, initial_plate = get_stats()
    print("=" * 60)
    print("🦅 SPIDEX CONTINUOUS AVIAN SPECIMEN PIPELINE")
    print(f"Total Species in Master Checklist: {total_species}")
    print(f"Starting Raw Photos: {initial_raw} / {total_species}")
    print(f"Starting Drawn Plates: {initial_plate} / {total_species}")
    print("=" * 60, flush=True)

    cycle = 1
    no_progress_count = 0

    while True:
        if args.max_cycles > 0 and cycle > args.max_cycles:
            print(f"\nReached max cycles ({args.max_cycles}). Stopping pipeline.")
            break

        print(f"\n==================================================")
        print(f"--- CYCLE #{cycle} ---")
        print(f"==================================================", flush=True)

        _, before_raw, before_plate = get_stats()

        # Step 1: Download photos
        if not args.skip_download and before_raw < total_species:
            dl_cmd = f"python3 scripts/download_real_bird_images.py --limit {args.download_batch} --workers 4"
            run_cmd(dl_cmd, f"Downloading real observation photos (batch: {args.download_batch})")

        # Step 2: Draw specimen plates with Gemini
        _, mid_raw, mid_plate = get_stats()
        if mid_plate < mid_raw:
            draw_cmd = f"python3 scripts/convert_birds_to_drawings.py --limit {args.draw_batch}"
            run_cmd(draw_cmd, f"Drawing scientific specimen plates with Gemini 2.5 Flash (batch: {args.draw_batch})")

        # Step 3: Recompile packs and showcase
        run_cmd("python3 scripts/compile_full_master_packs.py", "Compiling production packs")
        run_cmd("python3 scripts/generate_showcase_html.py", "Regenerating museum showcase HTML")

        # Step 4: Progress check
        _, after_raw, after_plate = get_stats()
        new_raw = after_raw - before_raw
        new_plates = after_plate - before_plate
        
        print(f"\nCycle #{cycle} Summary:")
        print(f"  Raw photos on disk: {after_raw}/{total_species} (+{new_raw} this cycle)")
        print(f"  Plates on disk:     {after_plate}/{total_species} (+{new_plates} this cycle)")

        if after_raw == total_species and after_plate == total_species:
            print("\n🎉 MISSION COMPLETE! All 962 Birds of Vietnam have authentic photos and scientific plates!")
            break

        if new_raw == 0 and new_plates == 0:
            no_progress_count += 1
            if no_progress_count >= 3:
                print("\nNo new photos or drawings completed after 3 consecutive cycles. Pausing pipeline.")
                break
        else:
            no_progress_count = 0

        cycle += 1
        time.sleep(3.0)

if __name__ == "__main__":
    main()
