#!/usr/bin/env python3
"""
Build public/packs/index.json — the published pack catalogue.

Every directory under public/packs/ that contains a valid pack.json is a pack.
The index records them in display order: an existing index's order is kept for
packs it already names, and new packs append at the end. `featured` carries
forward; on first run it defaults to the two national checklists.

Usage:
    python3 scripts/build_pack_index.py
    python3 scripts/build_pack_index.py --featured bird-vn butterfly-vn
"""
import argparse
import json
import sys
from pathlib import Path

PACKS_DIR = Path(__file__).resolve().parent.parent / "public" / "packs"
INDEX_PATH = PACKS_DIR / "index.json"
DEFAULT_FEATURED = ["bird-vn", "butterfly-vn"]

REQUIRED_MANIFEST_KEYS = {"id", "name", "version", "speciesCount"}


def discover_packs() -> list[str]:
    packs = []
    for entry in sorted(PACKS_DIR.iterdir()):
        manifest_path = entry / "pack.json"
        if not entry.is_dir() or not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError) as e:
            print(f"  ! {entry.name}: unreadable pack.json ({e}) — skipped", file=sys.stderr)
            continue
        missing = REQUIRED_MANIFEST_KEYS - manifest.keys()
        if missing:
            print(f"  ! {entry.name}: manifest missing {sorted(missing)} — skipped", file=sys.stderr)
            continue
        if manifest["id"] != entry.name:
            print(f"  ! {entry.name}: manifest id is {manifest['id']!r} — skipped", file=sys.stderr)
            continue
        packs.append(entry.name)
    return packs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--featured", nargs="*", help="Pack ids to feature on first run")
    args = ap.parse_args()

    found = discover_packs()
    if not found:
        print("no packs found under public/packs/", file=sys.stderr)
        return 1

    previous = {}
    if INDEX_PATH.exists():
        try:
            previous = json.loads(INDEX_PATH.read_text())
        except json.JSONDecodeError:
            pass

    # Existing order first, new discoveries appended in sorted order.
    ordered = [p for p in previous.get("packs", []) if p in found]
    ordered += [p for p in found if p not in ordered]

    featured = args.featured or [f for f in previous.get("featured", []) if f in found]
    if not featured:
        featured = [f for f in DEFAULT_FEATURED if f in found]

    index = {"version": 1, "featured": featured, "packs": ordered}
    INDEX_PATH.write_text(json.dumps(index, indent=2) + "\n")
    print(f"{INDEX_PATH.relative_to(PACKS_DIR.parent.parent)}: {len(ordered)} packs, featured={featured}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
