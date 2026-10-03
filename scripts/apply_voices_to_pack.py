#!/usr/bin/env python3
"""
Merge fetched bird voices into a compiled pack's species.ndjson.

Matching is by scientific name — the only key that means the same thing in
the checklist, in xeno-canto, and in the pack. Species with no match keep no
`sounds` key; records that already have sounds are overwritten, so the script
is idempotent and safe to re-run after a re-fetch.

    python3 scripts/apply_voices_to_pack.py public/packs/bird-vn data/voices/bird-vn_voices.json
    python3 scripts/apply_voices_to_pack.py public/packs/bird-vn data/voices/bird-vn_voices.json --bump
"""
import argparse
import json
import re
import sys
from pathlib import Path

# Same commercial-safe allowlist as fetch_bird_voices.py — re-applying an old
# voices file must strip NC sounds already stored in it.
SAFE_LIC = re.compile(
    r"^https?://creativecommons\.org/(licenses/(by|by-sa|by-nd)/|publicdomain/)", re.I
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pack_dir", help="pack directory, e.g. public/packs/bird-vn")
    ap.add_argument("voices", help="voices JSON from fetch_bird_voices.py")
    ap.add_argument("--bump", action="store_true", help="bump pack.json version (publishes as an update)")
    args = ap.parse_args()

    pack_dir = Path(args.pack_dir)
    ndjson_path = pack_dir / "species.ndjson"
    voices = json.loads(Path(args.voices).read_text())

    lines = ndjson_path.read_text().splitlines()
    matched = skipped = 0
    out = []
    for line in lines:
        if not line.strip():
            out.append(line)
            continue
        rec = json.loads(line)
        found = [s for s in voices.get(rec.get("sciName", ""), [])
                 if SAFE_LIC.match(s.get("licenseUrl") or "")]
        if found:
            # Optional fields are absent, never null: the pack schema rejects
            # null and one bad field fails the whole pack.
            rec["sounds"] = [{k: v for k, v in snd.items() if v is not None} for snd in found]
            matched += 1
        else:
            rec.pop("sounds", None)
            skipped += 1
        out.append(json.dumps(rec, ensure_ascii=False))

    ndjson_path.write_text("\n".join(out) + "\n")

    if args.bump:
        manifest_path = pack_dir / "pack.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["version"] = int(manifest.get("version", 1)) + 1
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print(f"pack.json → v{manifest['version']}")

    print(f"{matched} species gained voices, {skipped} unchanged → {ndjson_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
