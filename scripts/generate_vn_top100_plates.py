#!/usr/bin/env python3
"""Generate specimen plates for the Vietnam top-100 set.

Reuses the spidex:specimen-plate skill for prompt, API call and canvas
normalisation so the plates are identical to single-species runs. Resumable:
existing plates are skipped, so an interrupted run can simply be re-invoked.
"""
import argparse
import importlib.util
import json
import os
import shutil
import sys
import time

SKILL = ".agents/skills/spidex-specimen-plate/scripts/generate_specimen_plate.py"
DATA = "data/vietnam_top100_common.json"
PLATE_DIR = "public/museum_specimens"
PLACEHOLDER = os.path.join(PLATE_DIR, "_placeholder_plate.jpg")
MODEL = "microsoft/mai-image-2.6-flash"


def load_skill():
    spec = importlib.util.spec_from_file_location("specimen_plate", SKILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=4.00,
                    help="Hard USD cap for this run; stops before exceeding it.")
    ap.add_argument("--limit", type=int, default=0, help="Only process N species (0 = all).")
    ap.add_argument("--force", action="store_true",
                    help="Redraw even where a plate exists (e.g. plates from an older prompt).")
    args = ap.parse_args()

    sp = load_skill()
    key = sp.get_openrouter_key()
    if not key:
        sys.exit("No OpenRouter key found.")

    with open(DATA, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    queue = [(g, e) for g in ("butterflies", "birds") for e in data[g]]
    if args.limit:
        queue = queue[:args.limit]

    spent = 0.0
    done = skipped = placed = failed = 0
    started = time.time()

    for idx, (group, entry) in enumerate(queue, 1):
        plate_path = os.path.join(PLATE_DIR, os.path.basename(entry["plateUrl"]))
        label = f"[{idx}/{len(queue)}] {entry['commonNameEn']} ({entry['sciName']})"

        if not args.force and os.path.exists(plate_path) and os.path.getsize(plate_path) > 10000:
            entry["plateReady"] = True
            skipped += 1
            continue

        # No commercially reusable photo: drop in the logo placeholder and move on.
        if entry.get("placeholder"):
            shutil.copyfile(PLACEHOLDER, plate_path)
            entry["plateReady"] = True
            entry["plateSource"] = "placeholder"
            placed += 1
            print(f"{label}\n  [PLACEHOLDER] no open-licence photo")
            continue

        raw_path = os.path.join(PLATE_DIR, os.path.basename(entry["rawUrl"]))
        if not os.path.exists(raw_path):
            entry["plateError"] = "missing reference photo"
            failed += 1
            print(f"{label}\n  [SKIP] reference photo missing")
            continue

        if spent + 0.03 > args.budget:
            print(f"\n[STOP] budget cap ${args.budget:.2f} reached (spent ${spent:.4f})")
            break

        prompt = sp.build_prompt(entry["taxon"], entry["sciName"], entry["commonNameEn"],
                                 entry.get("commonNameVi", ""), entry.get("fieldMarks", ""))
        t0 = time.time()
        try:
            img = sp.call_openrouter(key, prompt, raw_path, MODEL)
        except Exception as exc:
            entry["plateError"] = str(exc)[:200]
            failed += 1
            print(f"{label}\n  [ERROR] {str(exc)[:120]}")
            continue

        if not img:
            entry["plateError"] = "no image returned"
            failed += 1
            print(f"{label}\n  [ERROR] no image returned")
            continue

        sp.save_specimen_plate(img, plate_path)
        entry["plateReady"] = True
        entry["plateSource"] = MODEL
        entry["plateSeconds"] = round(time.time() - t0, 1)
        done += 1
        # call_openrouter prints per-call cost; track the flat MAI rate for the guard.
        spent += 0.0229
        print(f"{label}\n  [OK] {entry['plateSeconds']}s  running ${spent:.4f}")

        with open(DATA, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)

    data["stats"]["plateReady"] = sum(1 for g in ("butterflies", "birds")
                                      for e in data[g] if e.get("plateReady"))
    with open(DATA, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)

    print("\n" + "=" * 52)
    print(f"generated={done} placeholder={placed} skipped={skipped} failed={failed}")
    print(f"approx spend ${spent:.4f} | elapsed {(time.time()-started)/60:.1f} min")
    print(f"plateReady total: {data['stats']['plateReady']}/100")


if __name__ == "__main__":
    main()
