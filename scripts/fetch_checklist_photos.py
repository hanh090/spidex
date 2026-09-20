#!/usr/bin/env python3
"""Download checklist reference photos into public/museum_specimens/.

Reads an ingested checklist JSON (scripts/checklist_ingest.py output) or the
Vietnam master butterfly checklist, downloads each species' best reference
photo, and records what was fetched in a JSONL manifest. The manifest is the
pipeline's source of truth: generate_plates_batch.py consumes it, and
feed_th_plates_into_packs.py reads license/attribution back out of it for pack
provenance.

Manifest line schema:
    {"pack": "bird-th", "sciName": "...", "slug": "spilopelia_chinensis",
     "prefix": "bird", "raw": "public/museum_specimens/bird_spilopelia_chinensis_raw.jpg",
     "photoUrl": "...", "license": "cc-by", "attribution": "(c) ...",
     "photoId": 123, "status": "downloaded" | "failed" | "no-photo"}

Usage:
    python3 scripts/fetch_checklist_photos.py \
        --checklist data/checklists/bird-th_checklist.json --pack bird-th
    python3 scripts/fetch_checklist_photos.py \
        --checklist data/checklists/vietnam_butterflies_master_checklist.json \
        --pack butterfly-vn --limit 10
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
MANIFEST = os.path.join(PROJECT_ROOT, "data/plate_manifest.jsonl")

USER_AGENT = "Spidex-Scientific-Checklist/1.0 (biodiversity-bot)"

# Pack id -> (museum_specimens filename prefix, checklist field layout)
PACK_PREFIX = {
    "bird-th": "bird",
    "butterfly-th": "butterfly",
    "bird-vn": "bird",
    "butterfly-vn": "butterfly",
}


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def pick_photo(species):
    """Return (url, license, attribution, photo_id) for the best reference.

    Ingested checklists carry `photos: [{url, license, attribution, id}]`.
    The VN master checklists carry `referencePhotoUrl` + `photoLicense` +
    `photoCredit` instead. Remote URLs are upgraded medium->large where the
    iNaturalist CDN pattern allows it.
    """
    photos = species.get("photos") or []
    if photos:
        p = photos[0]
        url = p.get("url") or ""
        lic = p.get("license") or ""
        credit = p.get("attribution") or ""
        pid = p.get("id")
    else:
        url = species.get("referencePhotoUrl") or ""
        lic = species.get("photoLicense") or ""
        credit = species.get("photoCredit") or ""
        pid = None

    if not url or not url.startswith("http"):
        return None
    url = re.sub(r"/medium\.(jpe?g|png)", r"/large.\1", url)
    return url, lic, credit, pid


def download_one(entry, delay=0.0):
    url, lic, credit, pid = entry["photo"]
    dest = os.path.join(SPECIMENS_DIR, f"{entry['prefix']}_{entry['slug']}_raw.jpg")
    if os.path.exists(dest) and os.path.getsize(dest) > 5000:
        return {**entry, "status": "downloaded", "raw": os.path.relpath(dest, PROJECT_ROOT),
                "license": lic, "attribution": credit, "photoId": pid, "photoUrl": url}
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            blob = resp.read()
    except Exception as exc:
        return {**entry, "status": "failed", "error": str(exc)[:200], "photoUrl": url}
    if len(blob) < 5000:
        return {**entry, "status": "failed", "error": f"tiny response {len(blob)}B", "photoUrl": url}
    tmp = dest + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(blob)
    os.replace(tmp, dest)
    if delay:
        time.sleep(delay)
    return {**entry, "status": "downloaded", "raw": os.path.relpath(dest, PROJECT_ROOT),
            "license": lic, "attribution": credit, "photoId": pid, "photoUrl": url}


def main():
    ap = argparse.ArgumentParser(description="Fetch checklist reference photos.")
    ap.add_argument("--checklist", required=True)
    ap.add_argument("--pack", required=True, choices=sorted(PACK_PREFIX))
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--limit", type=int, default=0, help="Cap species processed (0 = all).")
    ap.add_argument("--slugs", default="", help="Comma-separated sci-name slugs to restrict to.")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--only-missing-raw", action="store_true",
                    help="Skip species whose raw file already exists.")
    args = ap.parse_args()

    prefix = PACK_PREFIX[args.pack]
    with open(args.checklist, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    species = data["species"] if isinstance(data, dict) else data

    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}
    entries = []
    for sp in species:
        sci = sp.get("sciName", "").strip()
        slug = slugify(sci)
        if wanted and slug not in wanted:
            continue
        raw_path = os.path.join(SPECIMENS_DIR, f"{prefix}_{slug}_raw.jpg")
        if args.only_missing_raw and os.path.exists(raw_path) and os.path.getsize(raw_path) > 5000:
            continue
        photo = pick_photo(sp)
        entries.append({"pack": args.pack, "sciName": sci, "slug": slug,
                        "prefix": prefix, "photo": photo})

    if args.limit:
        entries = entries[: args.limit]

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {}
        for e in entries:
            if not e["photo"]:
                results.append({k: v for k, v in e.items() if k != "photo"} | {"status": "no-photo"})
                continue
            futs[pool.submit(download_one, e)] = e
        done = 0
        for fut in as_completed(futs):
            results.append(fut.result())
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(futs)} fetched", flush=True)

    # Merge into the manifest: one line per (pack, slug), latest write wins.
    seen = {}
    if os.path.exists(args.manifest):
        with open(args.manifest, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    rec = json.loads(line)
                    seen[(rec.get("pack"), rec.get("slug"))] = rec
    for r in results:
        key = (r["pack"], r["slug"])
        prior = seen.get(key, {})
        prior.update(r)  # new fields win; keep prior 'model'/'plate' if present
        seen[key] = prior

    tmp = args.manifest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for rec in seen.values():
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    os.replace(tmp, args.manifest)

    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"{args.pack}: {counts}  (manifest -> {os.path.relpath(args.manifest, PROJECT_ROOT)})")
    failed = [r for r in results if r["status"] == "failed"]
    for r in failed[:10]:
        print(f"  FAILED {r['sciName']}: {r.get('error','')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
