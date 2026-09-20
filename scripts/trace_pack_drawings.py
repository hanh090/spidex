#!/usr/bin/env python3
"""Trace downloaded reference photos into per-species SVG drawings (free path).

Uses the same specimen_to_drawing pipeline that produced butterfly-sg:
raw photo -> Difference-of-Gaussians line extraction -> potrace -> SVG
(+ webp plate and thumbnail). Runs entirely locally, no API key.

Consumes data/plate_manifest.jsonl rows that have a raw photo but no generated
plate, and writes into the pack's img/ dir under the exact filenames the pack
records were compiled for:

    bird-th      img/bir-<slug>-p.svg          (profile)
    butterfly-th img/but-<slug>-d.svg + -v.svg (dorsal + ventral)
    butterfly-vn img/bf-<slug>-d.svg           (dorsal)

Marks the manifest row's trace status so feed_th_plates_into_packs.py can tag
provenance.plate.model = "potrace-trace" — the enhancement query for a future
painted-plate upgrade pass.

Usage:
    python3 scripts/trace_pack_drawings.py --pack bird-th
    python3 scripts/trace_pack_drawings.py --pack butterfly-th --limit 10 --dry-run
"""
import argparse
import importlib.util
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public", "museum_specimens")
MANIFEST = os.path.join(PROJECT_ROOT, "data", "plate_manifest.jsonl")
DRAWING_SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "specimen_to_drawing.py")

# pack -> (record-id prefix, aspects to render)
PACK_CONF = {
    "bird-th": ("bir", ["p"]),
    "butterfly-th": ("but", ["d", "v"]),
    "butterfly-vn": ("bf", ["d"]),
}


def load_drawing():
    spec = importlib.util.spec_from_file_location("specimen_to_drawing", DRAWING_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def dash_slug(underscore_slug):
    return re.sub(r"_+", "-", underscore_slug)


def load_manifest(path):
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def save_manifest(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description="Trace raw photos into pack SVG drawings.")
    ap.add_argument("--pack", required=True, choices=sorted(PACK_CONF))
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--slugs", default="")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    id_prefix, aspects = PACK_CONF[args.pack]
    img_dir = os.path.join(PROJECT_ROOT, "public", "packs", args.pack, "img")
    os.makedirs(img_dir, exist_ok=True)

    rows = load_manifest(args.manifest)
    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}

    candidates = []
    for rec in rows:
        if rec.get("pack") != args.pack or not rec.get("raw"):
            continue
        if wanted and rec["slug"] not in wanted:
            continue
        if not os.path.exists(os.path.join(PROJECT_ROOT, rec["raw"])):
            continue
        plate = os.path.join(SPECIMENS_DIR, f"{rec['prefix']}_{rec['slug']}_plate.jpg")
        if os.path.exists(plate) and os.path.getsize(plate) > 50000:
            continue  # painted plate exists — trace would be a downgrade
        base = f"{id_prefix}-{dash_slug(rec['slug'])}"
        pending = [a for a in aspects
                   if not os.path.exists(os.path.join(img_dir, f"{base}-{a}.svg"))]
        if pending:
            candidates.append((rec, base, pending))

    if args.limit:
        candidates = candidates[: args.limit]

    print(f"{args.pack}: {len(candidates)} species to trace "
          f"({sum(len(p) for _, _, p in candidates)} aspect files)")
    if args.dry_run:
        for rec, base, pending in candidates[:30]:
            print(f"  {base} -> {[f'{base}-{a}.svg' for a in pending]}")
        return 0

    draw = load_drawing()

    def worker(rec, base, pending):
        raw_path = os.path.join(PROJECT_ROOT, rec["raw"])
        made = []
        try:
            for asp in pending:
                out = draw.process_specimen_to_drawing(raw_path, img_dir, base, asp)
                made.append(out["svg"])
            rec["traceStatus"] = "traced"
            rec["traceModel"] = "potrace-trace"
            rec["traceFiles"] = [os.path.relpath(p, img_dir) for p in made]
            return True, rec, None
        except Exception as exc:
            rec["traceStatus"] = "trace-failed"
            rec["traceError"] = str(exc)[:300]
            return False, rec, exc

    done = ok = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(worker, rec, base, pending) for rec, base, pending in candidates]
        for fut in as_completed(futs):
            success, rec, exc = fut.result()
            done += 1
            ok += success
            if not success:
                print(f"[{done}/{len(candidates)}] {rec['slug']}: FAIL {exc}", flush=True)
            elif done % 50 == 0 or done == len(candidates):
                print(f"[{done}/{len(candidates)}] traced", flush=True)
            if done % 100 == 0:
                save_manifest(args.manifest, rows)

    save_manifest(args.manifest, rows)
    print(f"\n{ok}/{len(candidates)} species traced into {img_dir}")
    return 0 if ok == len(candidates) else 1


if __name__ == "__main__":
    sys.exit(main())
