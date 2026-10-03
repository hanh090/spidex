#!/usr/bin/env python3
"""Replace NoDerivatives-licensed plates with the pack's archetype drawing.

Plates are redrawn from source photos, i.e. derivatives, which a CC ND licence
does not permit. Each species whose only images are ND gets the archetype the
pack already uses for its family (falling back to the general drawing), the
same entry species without a plate carry.

    python3 scripts/replace_nd_plates.py public/packs/bird-th public/packs/butterfly-th
"""
import collections
import json
import sys
from pathlib import Path

ARCHETYPE_CREDIT = "Spidex archetype drawing - species plate pending"


def is_nd(image: dict) -> bool:
    return "ND" in (image.get("license") or "").upper().split("-")


def main(pack_dirs: list[str]) -> int:
    for d in map(Path, pack_dirs):
        path = d / "species.ndjson"
        manifest = json.loads((d / "pack.json").read_text())
        aspect = manifest["traitSchema"]["aspects"]["required"][0]
        records = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]

        # family -> archetype file this pack already uses for that family
        by_family: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for r in records:
            for im in r.get("images", []):
                if "archetype" in im.get("fullUrl", ""):
                    by_family[r.get("family", "")][im["fullUrl"]] += 1
        general = next(
            (f"img/{p.name}" for p in sorted((d / "img").glob("*archetype-general.svg"))), None
        )

        replaced = dropped = 0
        for r in records:
            images = r.get("images", [])
            kept = [im for im in images if not is_nd(im)]
            if len(kept) == len(images):
                continue
            dropped += len(images) - len(kept)
            if not kept:
                fam = by_family.get(r.get("family", ""))
                url = fam.most_common(1)[0][0] if fam else general
                kept = [{
                    "id": f"{r['id']}-1",
                    "aspect": aspect,
                    "credit": ARCHETYPE_CREDIT,
                    "license": "CC-BY-SA-4.0",
                    "thumbUrl": url,
                    "fullUrl": url,
                }]
                replaced += 1
            r["images"] = kept

        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n")
        print(f"{d.name}: dropped {dropped} ND images, {replaced} species now show an archetype")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
