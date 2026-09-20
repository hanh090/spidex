#!/usr/bin/env python3
"""Feed generated specimen plates into the Thailand / VN species packs.

Generalizes feed_plates_into_packs.py for the checklist packs:

- If public/museum_specimens/{prefix}_{slug}_plate.jpg exists for a species,
  copy it into the pack's img/ dir and rewrite images[] as a single dorsal /
  profile JPEG entry (the Vietnam pack convention).
- If no plate exists, repoint images[] at the taxon archetype SVG so nothing
  404s — the Thailand packs were compiled pointing at per-species SVGs that
  were never drawn.
- Every record gets provenance.plate stamped with the generating model (from
  the manifest), or a fallback marker, so a future enhancement pass can query
  for what to redraw:

      "provenance": {"plate": {"model": "microsoft/mai-image-2.6-flash", ...}}
      "provenance": {"plate": {"model": "legacy-museum-plate", ...}}   # pre-manifest
      "provenance": {"plate": {"model": "archetype-fallback", "placeholder": true}}

Usage:
    python3 scripts/feed_th_plates_into_packs.py --pack bird-th --dry-run
    python3 scripts/feed_th_plates_into_packs.py --pack butterfly-th
"""
import argparse
import json
import os
import re
import shutil
import sys
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")
MANIFEST = os.path.join(PROJECT_ROOT, "data/plate_manifest.jsonl")

PACK_PREFIX = {"bird-th": "bird", "butterfly-th": "butterfly", "butterfly-vn": "butterfly"}
PACK_ID_PREFIX = {"bird-th": "bir", "butterfly-th": "but", "butterfly-vn": "butterfly"}

# pack -> (record-id prefix, trace aspects) matching trace_pack_drawings.py
TRACE_CONF = {
    "bird-th": ("bir", ["p"]),
    "butterfly-th": ("but", ["d", "v"]),
    "butterfly-vn": ("bf", ["d"]),
}
ASPECT_NAME = {"p": "profile", "d": "dorsal", "v": "ventral"}

# Family -> archetype SVG, mirroring infer_butterfly_archetype() in
# compile_full_master_packs.py, extended for the bird archetypes present in
# the bird-th img/ dir.
def bird_archetype(family, sci_name):
    f = (family or "").lower()
    s = (sci_name or "").lower()
    if any(k in f for k in ["accipitridae", "falconidae", "pandionidae", "strigidae", "tytonidae"]):
        return "img/bird-archetype-raptor.svg" if "strigidae" not in f and "tytonidae" not in f else "img/bird-archetype-owl.svg"
    if "columbidae" in f:
        return "img/bird-archetype-pigeon.svg"
    if "alcedinidae" in f:
        return "img/bird-archetype-kingfisher.svg"
    if "phasianidae" in f or "anatidae" in f or "gruidae" in f:
        return "img/bird-archetype-gamebird.svg"
    if "corvidae" in f:
        return "img/bird-archetype-corvid.svg"
    if "nectariniidae" in f:
        return "img/bird-archetype-sunbird.svg"
    if "passeridae" in f or "estrildidae" in f or "ploceidae" in f:
        return "img/bird-archetype-sparrow.svg"
    if any(k in s for k in ["heron", "egret", "stork", "crane"]) or any(
        k in f for k in ["ardeidae", "ciconiidae", "threskiornithidae"]
    ):
        return "img/bird-archetype-general.svg"
    return "img/bird-archetype-general.svg"


def butterfly_archetype(family, genus):
    fam = (family or "").lower()
    g = (genus or "").lower()
    if "graphium" in g:
        return "img/bf-archetype-graphium.svg"
    if "papilionidae" in fam or g in ["troides", "papilio", "atrophaneura"]:
        return "img/bf-archetype-papilionid.svg"
    if "pieridae" in fam or g in ["delias", "catopsilia", "eurema", "pieris", "appias", "cepora"]:
        return "img/bf-archetype-pierid.svg"
    if "lycaenidae" in fam:
        return "img/bf-archetype-lycaenid.svg"
    if "hesperiidae" in fam:
        return "img/bf-archetype-hesperiid.svg"
    if "riodinidae" in fam:
        return "img/bf-archetype-riodinid.svg"
    if "nymphalidae" in fam:
        return "img/bf-archetype-nymphalid.svg"
    return "img/bf-archetype-general.svg"


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def load_manifest(path):
    by_slug = {}
    if not os.path.exists(path):
        return by_slug
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rec = json.loads(line)
                by_slug[(rec.get("pack"), rec.get("slug"))] = rec
    return by_slug


def main():
    ap = argparse.ArgumentParser(description="Feed museum plates into a species pack.")
    ap.add_argument("--pack", required=True, choices=sorted(PACK_PREFIX))
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--slugs", default="", help="Comma-separated sci-name slugs to restrict to.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    prefix = PACK_PREFIX[args.pack]
    pack_dir = os.path.join(PROJECT_ROOT, "public/packs", args.pack)
    img_dir = os.path.join(pack_dir, "img")
    ndjson_path = os.path.join(pack_dir, "species.ndjson")
    manifest = load_manifest(args.manifest)
    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}

    rows = []
    with open(ndjson_path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))

    stats = {"plated": 0, "traced": 0, "fallback": 0, "skipped": 0}
    for rec in rows:
        sci = rec.get("sciName", "")
        slug = slugify(sci)
        if wanted and slug not in wanted:
            stats["skipped"] += 1
            continue

        genus = sci.split()[0] if " " in sci else ""
        plate_src = os.path.join(SPECIMENS_DIR, f"{prefix}_{slug}_plate.jpg")
        mrec = manifest.get((args.pack, slug)) or {}

        if os.path.exists(plate_src) and os.path.getsize(plate_src) > 50000:
            img_name = f"{prefix}-{slug}.jpg"
            dest = os.path.join(img_dir, img_name)
            if not args.dry_run:
                shutil.copyfile(plate_src, dest)

            model = mrec.get("model") or "legacy-museum-plate"
            ref_lic = mrec.get("license") or ""
            if not ref_lic and "all rights reserved" in (mrec.get("attribution") or "").lower():
                ref_lic = "all-rights-reserved"
            # The plate's own licence: the reference photo's CC licence when one
            # was recorded, otherwise the pack's default plate licence. Never
            # claim a CC licence for a reference that is all-rights-reserved.
            lic = ref_lic.upper() if ref_lic.startswith("cc") else "CC-BY-SA-4.0"
            credit = (
                f"Spidex specimen plate, redrawn from {mrec['attribution']}"
                if mrec.get("attribution")
                else "Spidex Natural History Specimen Plate (Redrawn from Observation)"
            )
            rec["images"] = [{
                "id": f"{rec['id']}-1",
                "aspect": "profile" if prefix == "bird" else "dorsal",
                "credit": credit,
                "license": lic,
                "thumbUrl": f"img/{img_name}",
                "fullUrl": f"img/{img_name}",
            }]
            rec.setdefault("provenance", {})["plate"] = {
                "model": model,
                "referenceLicense": ref_lic or None,
                "referenceSource": "iNaturalist" if mrec.get("photoUrl") else mrec.get("referenceSource"),
                "referencePhotoUrl": mrec.get("photoUrl"),
                "placeholder": False,
            }
            stats["plated"] += 1
        else:
            # Second choice: a potrace-traced per-species drawing of the real
            # reference photo, produced locally by trace_pack_drawings.py.
            id_prefix, aspects = TRACE_CONF[args.pack]
            dash = re.sub(r"_+", "-", slug)
            traced = [a for a in aspects
                      if os.path.exists(os.path.join(img_dir, f"{id_prefix}-{dash}-{a}.svg"))]
            if traced:
                rec["images"] = [{
                    "id": f"{rec['id']}-{a}",
                    "aspect": ASPECT_NAME[a],
                    "credit": (
                        "Spidex traced specimen drawing"
                        + (f", from {mrec['attribution']}" if mrec.get("attribution") else "")
                    ),
                    "license": (mrec.get("license") or "cc-by-sa").upper()
                               if (mrec.get("license") or "").startswith("cc")
                               else "CC-BY-SA-4.0",
                    "thumbUrl": f"img/{id_prefix}-{dash}-{a}.svg",
                    "fullUrl": f"img/{id_prefix}-{dash}-{a}.svg",
                } for a in traced]
                rec.setdefault("provenance", {})["plate"] = {
                    "model": "potrace-trace",
                    "referenceLicense": mrec.get("license") or None,
                    "referenceSource": "iNaturalist" if mrec.get("photoUrl") else None,
                    "referencePhotoUrl": mrec.get("photoUrl"),
                    "placeholder": True,
                }
                stats["traced"] += 1
                continue
            arch = (
                bird_archetype(rec.get("family"), sci)
                if prefix == "bird"
                else butterfly_archetype(rec.get("family"), genus)
            )
            rec["images"] = [{
                "id": f"{rec['id']}-1",
                "aspect": "profile" if prefix == "bird" else "dorsal",
                "credit": "Spidex archetype drawing - species plate pending",
                "license": "CC-BY-SA-4.0",
                "thumbUrl": arch,
                "fullUrl": arch,
            }]
            rec.setdefault("provenance", {})["plate"] = {
                "model": "archetype-fallback",
                "referenceLicense": None,
                "referenceSource": None,
                "referencePhotoUrl": mrec.get("photoUrl"),
                "placeholder": True,
            }
            stats["fallback"] += 1

    print(f"{args.pack}: plated={stats['plated']} traced={stats['traced']} "
          f"fallback={stats['fallback']} skipped={stats['skipped']}"
          + ("  [dry run]" if args.dry_run else ""))
    if args.dry_run:
        return 0

    backup = f"{ndjson_path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copyfile(ndjson_path, backup)
    tmp = ndjson_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, ndjson_path)
    print(f"  wrote {ndjson_path} (backup {os.path.basename(backup)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
