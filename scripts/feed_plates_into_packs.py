#!/usr/bin/env python3
"""Feed generated specimen plates into the shipped species packs.

Matches on scientific name first, then falls back to English common name so
taxonomic synonyms (iNaturalist vs pack checklist) still land. Only records
that match are touched; unmatched species are reported, never invented.
"""
import argparse
import json
import os
import shutil
import time

DATA = "data/vietnam_top100_common.json"
PACKS = [("butterflies", "butterfly-vn", "bf"), ("birds", "bird-vn", "bird")]

# Verified taxonomic synonyms: iNaturalist name -> name used by the pack
# checklist. Each was confirmed present in the pack under the mapped name.
SYNONYMS = {
    "butorides atricapilla": "Butorides striata",   # Little Heron split
    "cinnyris ornatus": "Cinnyris jugularis",       # Ornate/Olive-backed Sunbird split
}


def norm(s):
    return (s or "").strip().lower()


def load_pack(pack):
    path = f"public/packs/{pack}/species.ndjson"
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return path, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(DATA, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    grand = {"matched": 0, "copied": 0, "unmatched": []}

    for group, pack, prefix in PACKS:
        path, rows = load_pack(pack)
        by_sci = {norm(r["sciName"]): r for r in rows}
        by_common = {}
        for r in rows:
            c = norm((r.get("commonNames") or {}).get("en"))
            if c and c not in by_common:
                by_common[c] = r

        img_dir = f"public/packs/{pack}/img"
        os.makedirs(img_dir, exist_ok=True)

        matched = copied = 0
        for entry in data[group]:
            syn = SYNONYMS.get(norm(entry["sciName"]))
            rec = (by_sci.get(norm(entry["sciName"]))
                   or (by_sci.get(norm(syn)) if syn else None)
                   or by_common.get(norm(entry["commonNameEn"])))
            if not rec:
                grand["unmatched"].append(f"{pack}: {entry['sciName']} ({entry['commonNameEn']})")
                continue
            matched += 1

            src = os.path.join("public/museum_specimens", os.path.basename(entry["plateUrl"]))
            if not os.path.exists(src):
                continue
            slug = norm(rec["sciName"]).replace(" ", "_")
            img_name = f"{prefix}-{slug}.jpg"
            dest = os.path.join(img_dir, img_name)

            placeholder = entry.get("plateSource") == "placeholder"
            # Credit the photographer whose observation the plate was redrawn from.
            if placeholder:
                credit = "Spidex placeholder - plate pending"
                lic = "CC-BY-SA-4.0"
            else:
                who = entry.get("attribution") or entry.get("observer") or "iNaturalist contributor"
                credit = f"Spidex specimen plate, redrawn from {who}"
                lic = (entry.get("license") or "cc-by").upper()

            if not args.dry_run:
                shutil.copyfile(src, dest)
            copied += 1

            rec["images"] = [{
                "id": f"{rec['id']}-1",
                "aspect": "dorsal" if group == "butterflies" else "profile",
                "credit": credit,
                "license": lic,
                "thumbUrl": f"img/{img_name}",
                "fullUrl": f"img/{img_name}",
            }]
            rec.setdefault("provenance", {})
            rec["provenance"]["plate"] = {
                "model": entry.get("plateSource", ""),
                "referenceLicense": entry.get("license"),
                "referenceSource": entry.get("photoSource"),
                "observationRank": entry.get("observations"),
                "placeholder": placeholder,
            }

        if not args.dry_run:
            backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
            shutil.copyfile(path, backup)
            with open(path, "w", encoding="utf-8") as fh:
                for r in rows:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"{pack}: matched={matched} images={copied}  (backup {os.path.basename(backup)})")
        else:
            print(f"{pack}: matched={matched} images={copied}  [dry run]")

        grand["matched"] += matched
        grand["copied"] += copied

    print(f"\ntotal matched {grand['matched']}/100, images written {grand['copied']}")
    if grand["unmatched"]:
        print(f"unmatched ({len(grand['unmatched'])}):")
        for u in grand["unmatched"]:
            print("  ", u)


if __name__ == "__main__":
    main()
