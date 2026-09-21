#!/usr/bin/env python3
"""Batch specimen plate generation driven by the plate manifest.

Consumes data/plate_manifest.jsonl rows produced by fetch_checklist_photos.py
(status == "downloaded"), calls the spidex-specimen-plate generator
(--backend mai by default), writes {prefix}_{slug}_plate.jpg next to the raw,
and stamps each manifest row with the generating model so packs can carry a
provenance tag and future upgrade passes can find plates to re-enhance.

Resumable: rows already marked "plated" with an existing plate file are skipped.
Failures are marked "plate-failed" and retried on the next run unless
--skip-failed is passed.

Usage:
    python3 scripts/generate_plates_batch.py --pack bird-th --limit 6
    python3 scripts/generate_plates_batch.py --pack butterfly-th --workers 6
    python3 scripts/generate_plates_batch.py --pack bird-th --dry-run
"""
import argparse
import importlib.util
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
MANIFEST = os.path.join(PROJECT_ROOT, "data/plate_manifest.jsonl")

SKILL_SCRIPT = os.path.join(
    PROJECT_ROOT, ".agents/skills/spidex-specimen-plate/scripts/generate_specimen_plate.py"
)


def load_generator():
    spec = importlib.util.spec_from_file_location("generate_specimen_plate", SKILL_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_manifest(path):
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def save_manifest(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def generate_one(gen, key, model, rec, taxon, backend="mai", common_vi=""):
    raw_path = os.path.join(PROJECT_ROOT, rec["raw"])
    plate_path = os.path.join(SPECIMENS_DIR, f"{rec['prefix']}_{rec['slug']}_plate.jpg")
    common_en = (rec.get("commonNameEn") or rec["sciName"])
    prompt = gen.build_prompt(taxon, rec["sciName"], common_en, common_vi,
                              rec.get("fieldMarks") or "")
    if backend == "gemini":
        img_bytes = gen.call_gemini(key, prompt, raw_path)
    else:
        img_bytes = gen.call_openrouter(key, prompt, raw_path, model=model)
    if not img_bytes:
        raise RuntimeError("empty image response")
    gen.save_specimen_plate(img_bytes, plate_path)
    return plate_path


def main():
    ap = argparse.ArgumentParser(description="Batch-generate specimen plates from the manifest.")
    ap.add_argument("--pack", required=True)
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--backend", default="mai", choices=["mai", "gemini"],
                    help="mai = OpenRouter image API, gemini = Gemini 2.5 Flash Image.")
    ap.add_argument("--model", default=None,
                    help="OpenRouter model slug; default routes per taxon (MAI flash).")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--slugs", default="")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--skip-failed", action="store_true",
                    help="Do not retry rows previously marked plate-failed.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gen = load_generator()
    taxon = "bird" if args.pack.startswith("bird") else "butterfly"
    model = args.model or ("gemini-2.5-flash-image" if args.backend == "gemini"
                           else gen.model_for_taxon(taxon))

    rows = load_manifest(args.manifest)
    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}

    def plate_exists(rec):
        p = os.path.join(SPECIMENS_DIR, f"{rec['prefix']}_{rec['slug']}_plate.jpg")
        return os.path.exists(p) and os.path.getsize(p) > 50000

    candidates = []
    for rec in rows:
        if rec.get("pack") != args.pack:
            continue
        if wanted and rec["slug"] not in wanted:
            continue
        if plate_exists(rec):
            if rec.get("status") != "plated":
                rec["status"] = "plated"
                # A plate we didn't generate this run is a legacy asset, not
                # this run's model — keep the tag honest for upgrade passes.
                rec.setdefault("model", "legacy-museum-plate")
            continue
        if rec.get("status") == "plate-failed" and args.skip_failed:
            continue
        if rec.get("status") not in ("downloaded", "plate-failed") or not rec.get("raw"):
            continue
        if not os.path.exists(os.path.join(PROJECT_ROOT, rec["raw"])):
            rec["status"] = "raw-missing"
            continue
        candidates.append(rec)

    if args.limit:
        candidates = candidates[: args.limit]

    print(f"{args.pack}: {len(candidates)} plates to generate via {model}")
    if args.dry_run:
        for rec in candidates[:40]:
            print(f"  {rec['slug']}  <-  {rec['raw']}")
        if len(candidates) > 40:
            print(f"  ... and {len(candidates) - 40} more")
        save_manifest(args.manifest, rows)
        return 0

    key = gen.get_gemini_key() if args.backend == "gemini" else gen.get_openrouter_key()
    if not key:
        print(f"ERROR: no {'Gemini' if args.backend == 'gemini' else 'OpenRouter'} API key resolvable",
              file=sys.stderr)
        return 1

    done = ok = 0
    t0 = time.time()
    lock_rows = rows  # same objects; mutations land in the manifest

    def worker(rec):
        last_exc = None
        # Transient failures (429/5xx/timeouts) get two retries with backoff;
        # a persistent 4xx fails fast on the first pass.
        for attempt in range(3):
            try:
                plate = generate_one(gen, key, model, rec, taxon, backend=args.backend)
                rec["status"] = "plated"
                rec["model"] = model
                rec["plate"] = os.path.relpath(plate, PROJECT_ROOT)
                rec.pop("error", None)
                return True, rec, None
            except Exception as exc:
                last_exc = exc
                msg = str(exc)
                transient = any(k in msg for k in ("429", "500", "502", "503", "timeout", "Timeout"))
                if not transient or attempt == 2:
                    break
                time.sleep(5 * (attempt + 1))
        rec["status"] = "plate-failed"
        rec["model"] = model
        rec["error"] = str(last_exc)[:300]
        return False, rec, last_exc

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(worker, rec) for rec in candidates]
        for fut in as_completed(futs):
            success, rec, exc = fut.result()
            done += 1
            ok += success
            tag = "ok" if success else f"FAIL {exc}"
            print(f"[{done}/{len(candidates)}] {rec['slug']}: {tag}", flush=True)
            if done % 20 == 0:
                save_manifest(args.manifest, lock_rows)

    save_manifest(args.manifest, lock_rows)
    print(f"\n{ok}/{len(candidates)} plates generated in {time.time() - t0:.0f}s via {model}")
    return 0 if ok == len(candidates) else 1


if __name__ == "__main__":
    sys.exit(main())
