#!/usr/bin/env python3
"""
Fetch bird-voice metadata from xeno-canto for every species in a checklist.

Each xeno-canto recording carries its own Creative Commons licence, and this
script keeps it: the output record stores the recordist, the licence (short
code and URL), the recording type, duration and the playable file URL. Only
metadata is downloaded — audio streams from xeno-canto's CDN at playback, so
packs stay small and nothing is redistributed.

    XENO_CANTO_API_KEY=... python3 scripts/fetch_bird_voices.py \
        data/checklists/bird-vn_checklist.json \
        --out data/voices/bird-vn_voices.json

Options:
    --per-species N    recordings to keep per species (default 2)
    --min-quality E    worst acceptable quality grade: A..E (default C)
    --prefer TYPE      preferred recording type, substring match (default song)
    --delay SECONDS    pause between API calls (default 1.0 — be polite)
    --resume           keep sciNames already present in the output file

Get a free API key at https://xeno-canto.org/account (required since Oct 2025).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://xeno-canto.org/api/3/recordings"
QUALITY_ORDER = ["A", "B", "C", "D", "E"]

# Allowlisted CC licences only — the project deliberately keeps non-commercial
# licences (the app's store listing is free), but anything outside the CC
# family still does not ship.
ALLOWED_LIC = re.compile(r"^https?://creativecommons\.org/(licenses|publicdomain)/", re.I)


def lic_code(url: str) -> str:
    m = re.search(r"creativecommons\.org/(licenses|publicdomain)/([^/]+)/([\d.]+)?", url or "")
    if not m:
        return "CC"
    code = m.group(2).upper()
    ver = m.group(3) or ""
    label = "CC0" if code == "ZERO" else f"CC {code.upper()}"
    return f"{label} {ver}".strip()


def duration_sec(length: str):
    try:
        parts = [int(p) for p in (length or "").split(":")]
        return parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3 else \
            parts[0] * 60 + parts[1] if len(parts) == 2 else None
    except (ValueError, IndexError):
        return None


def query_voices(sci_name: str, key: str, min_quality: str) -> list[dict]:
    # v3 quality comparisons are strict: "C or better" is expressed as >D.
    # min_quality E (accept everything) needs no filter at all.
    q = f'sp:"{sci_name}"'
    if min_quality != "E":
        worse = chr(ord(min_quality) + 1)
        q += f' q:">{worse}"'
    url = f"{API}?query={urllib.parse.quote(q)}&key={urllib.parse.quote(key)}"
    req = urllib.request.Request(url, headers={"User-Agent": "spidex-voice-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read())
    return data.get("recordings", [])


def pick(recs: list[dict], per_species: int, prefer: str) -> list[dict]:
    def score(r):
        q = QUALITY_ORDER.index(r.get("q", "E")) if r.get("q", "E") in QUALITY_ORDER else 99
        type_hit = 0 if prefer in (r.get("type") or "").lower() else 1
        return (q, type_hit)

    out = []
    for r in sorted(recs, key=score):
        lic = r.get("lic") or ""
        if not ALLOWED_LIC.match(lic):
            continue
        if not r.get("file") or not r.get("rec"):
            continue
        out.append({
            "id": f"xc{r.get('id')}",
            "url": r["file"] if r["file"].startswith("http") else f"https:{r['file']}",
            "credit": r["rec"],
            "license": lic_code(lic),
            "licenseUrl": lic if lic.startswith("http") else f"https:{lic}",
            "type": (r.get("type") or "").split(",")[0].strip() or None,
            "durationSec": duration_sec(r.get("length") or ""),
            "source": "xeno-canto",
            "sourceUrl": f"https://xeno-canto.org/{r.get('id')}",
        })
        if len(out) >= per_species:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("checklist", help="checklist JSON, e.g. data/checklists/bird-vn_checklist.json")
    ap.add_argument("--out", required=True, help="output path, e.g. data/voices/bird-vn_voices.json")
    ap.add_argument("--per-species", type=int, default=2)
    ap.add_argument("--min-quality", default="C", choices=QUALITY_ORDER)
    ap.add_argument("--prefer", default="song")
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--key-env", default="XENO_CANTO_API_KEY")
    args = ap.parse_args()

    key = os.environ.get(args.key_env, "").strip()
    if not key:
        print(f"error: ${args.key_env} is not set — get one at https://xeno-canto.org/account", file=sys.stderr)
        return 2

    checklist = json.loads(Path(args.checklist).read_text())
    species = checklist.get("species", checklist if isinstance(checklist, list) else [])

    out_path = Path(args.out)
    voices: dict[str, list[dict]] = {}
    if args.resume and out_path.exists():
        voices = json.loads(out_path.read_text())

    todo = [s for s in species if not (args.resume and s.get("sciName") in voices)]
    print(f"{len(species)} species, {len(todo)} to fetch (resume={'on' if args.resume else 'off'})")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    for i, sp in enumerate(todo):
        name = sp.get("sciName") or sp.get("canonicalName")
        if not name:
            continue
        try:
            recs = query_voices(name, key, args.min_quality)
            voices[name] = pick(recs, args.per_species, args.prefer)
            mark = f"{len(voices[name])} rec" if voices[name] else "—"
        except Exception as e:
            voices[name] = []
            mark = f"error: {e}"
        print(f"  [{i + 1}/{len(todo)}] {name}: {mark}")
        # Persist as we go — a network drop mid-run must not lose an hour.
        out_path.write_text(json.dumps(voices, indent=1, ensure_ascii=False, sort_keys=True))
        time.sleep(args.delay)

    have = sum(1 for v in voices.values() if v)
    print(f"done: {have}/{len(voices)} species have voices → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
